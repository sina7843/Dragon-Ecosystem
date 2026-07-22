import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import { withIdempotency } from '../../shared/db/idempotency.ts';
import { createRequestContext, SYSTEM_ACTOR, type RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ProviderUnavailableError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import type { LedgerService } from '../ledger/index.ts';
import type { AccountRef, PostCommand } from '../ledger/index.ts';
import { PAYMENTS_COLLECTIONS } from './collections.ts';
import { DRAGON_COIN_PACKAGES, PRICING_VERSION, findPackage, type DragonCoinPackage } from './packages.ts';
import type { PaymentProvider, VerifiedCallback } from './provider.ts';
import { canTransition, isTerminal, type ProviderEventRecord, type PurchaseRecord } from './state.ts';

/**
 * Dragon Coin purchase service (DRAGON-11b).
 *
 * A deterministic mock Toman payment lifecycle that credits Dragon Coin exactly
 * once through the DRAGON-11a ledger. A verified provider callback and the ledger
 * credit commit in one transaction; the ledger business reference
 * `dragon_coin_purchase:<id>` (unique index) is the durable exactly-once authority,
 * independent of provider-callback idempotency. Corrections are compensating ledger
 * transactions, never edits to a posted credit.
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export interface PackageView {
  code: string;
  dragonCoin: number;
  rialAmount: number;
  pricingVersion: number;
}

export interface PaymentsConfigView {
  mockEnabled: boolean;
  purchaseTtlSeconds: number;
}

export class PaymentsService {
  readonly #database: Database;
  readonly #ledger: LedgerService;
  readonly #provider: PaymentProvider;
  readonly #config: PaymentsConfigView;

  constructor(database: Database, ledger: LedgerService, provider: PaymentProvider, config: PaymentsConfigView) {
    this.#database = database;
    this.#ledger = ledger;
    this.#provider = provider;
    this.#config = config;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #purchases(db: Db = this.#db) {
    return db.collection<PurchaseRecord>(PAYMENTS_COLLECTIONS.purchases);
  }
  #events(db: Db = this.#db) {
    return db.collection<ProviderEventRecord>(PAYMENTS_COLLECTIONS.providerEvents);
  }

  #treasuryRef: AccountRef = { kind: 'system', accountType: 'platform_dragon_coin_treasury' };
  #userRef(accountId: EntityId): AccountRef {
    return { kind: 'user', ownerId: accountId, accountType: 'user_dragon_coin' };
  }

  // --- Packages ---

  listPackages(): PackageView[] {
    return DRAGON_COIN_PACKAGES.map((pkg) => this.#packageView(pkg));
  }
  #packageView(pkg: DragonCoinPackage): PackageView {
    return { code: pkg.code, dragonCoin: pkg.dragonCoin, rialAmount: pkg.rial, pricingVersion: PRICING_VERSION };
  }

  // --- Create ---

  /** Creates a purchase for the caller's own account and generates the provider request. */
  async createPurchase(context: RequestContext, accountId: EntityId, input: { packageCode: string; idempotencyKey: string }): Promise<PurchaseRecord> {
    const pkg = findPackage(input.packageCode);
    if (pkg === undefined) throw new ValidationError('The selected package is not available.', [{ field: 'packageCode', code: 'INVALID_PACKAGE', message: 'Unknown purchase package.' }]);
    if (!this.#config.mockEnabled) throw new ProviderUnavailableError('The payment provider is unavailable.');

    const outcome = await withIdempotency(this.#db, { scope: `purchase_create:${accountId}`, key: input.idempotencyKey, request: { packageCode: input.packageCode, pricingVersion: PRICING_VERSION } }, async () => {
      const purchaseId = newId();
      const businessRef = `dragon_coin_purchase:${purchaseId}`;
      const request = await this.#provider.createRequest({ purchaseId, businessRef, rialAmount: pkg.rial, correlationId: context.correlationId });
      const now = utcNow();
      const purchase: PurchaseRecord = {
        _id: purchaseId,
        accountId,
        packageCode: pkg.code,
        dragonCoin: pkg.dragonCoin,
        rialAmount: pkg.rial,
        pricingVersion: PRICING_VERSION,
        provider: this.#provider.name,
        providerRequestId: request.providerRequestId,
        businessRef,
        state: 'payment_pending',
        callbackVerification: 'unverified',
        ledgerTransactionId: null,
        correctionTransactionId: null,
        correctionRef: null,
        correlationId: context.correlationId,
        metadata: {},
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + this.#config.purchaseTtlSeconds * 1000).toISOString(),
        completedAt: null,
        version: 1
      };
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#purchases(uow.db).insertOne(purchase, { session: uow.session });
        uow.audit({ action: 'payment.purchase_created', resourceType: 'dragon_coin_purchase', resourceId: purchaseId, after: { packageCode: pkg.code, rialAmount: pkg.rial, dragonCoin: pkg.dragonCoin } });
        uow.publish({ eventName: 'payment.purchase_created', eventVersion: 1, aggregateId: purchaseId, payload: { accountId, packageCode: pkg.code } });
      });
      return purchase;
    });
    return outcome.result;
  }

  // --- Callback handling (exactly-once credit) ---

  /** The signing provider, exposed so the gated mock-pay control can simulate a callback. */
  get provider(): PaymentProvider {
    return this.#provider;
  }

  /**
   * Processes a verified provider callback: binds it to the server-created purchase,
   * records an immutable receipt, and — for a success — credits Dragon Coin exactly
   * once in the same transaction. Duplicate or concurrent callbacks converge to the
   * existing result; conflicting outcomes are rejected and audited.
   */
  async handleVerifiedCallback(verified: VerifiedCallback): Promise<PurchaseRecord> {
    const purchase = await this.#purchases().findOne({ _id: verified.purchaseId });
    if (purchase === null) throw new NotFoundError('Unknown purchase.');
    // Bind the callback to the server-created purchase — the client-influenced fields must match.
    if (verified.provider !== purchase.provider || verified.providerRequestId !== purchase.providerRequestId) {
      await this.#recordRejected(verified, purchase._id, 'reference_mismatch');
      throw new ConflictError('CALLBACK_VERIFICATION_FAILED', 'The callback does not match the purchase.');
    }
    if (verified.asset !== 'IRR') {
      await this.#recordRejected(verified, purchase._id, 'asset_mismatch');
      throw new ConflictError('CALLBACK_AMOUNT_MISMATCH', 'The callback asset does not match the purchase.');
    }
    if (verified.rialAmount !== purchase.rialAmount) {
      await this.#recordRejected(verified, purchase._id, 'amount_mismatch');
      throw new ConflictError('CALLBACK_AMOUNT_MISMATCH', 'The paid amount does not match the purchase.');
    }

    // Replay of an already-accepted event: return the current purchase, no new effect.
    const existing = await this.#events().findOne({ provider: verified.provider, eventId: verified.eventId });
    if (existing !== null) return purchase;

    const target = verified.eventType === 'success' ? 'succeeded' : verified.eventType === 'failed' ? 'failed' : 'cancelled';
    const resolved = target === 'succeeded' ? await this.#ledger.ensureAccounts([this.#treasuryRef, this.#userRef(purchase.accountId)]) : null;
    const ctx = createRequestContext(newId(), SYSTEM_ACTOR);

    try {
      return await runUnitOfWork(this.#database, ctx, async (uow) => {
        const fresh = (await this.#purchases(uow.db).findOne({ _id: purchase._id }, { session: uow.session })) as PurchaseRecord;
        const now = utcNow();
        const event: ProviderEventRecord = { _id: newId(), purchaseId: purchase._id, provider: verified.provider, providerRequestId: verified.providerRequestId, eventId: verified.eventId, eventType: verified.eventType, verification: 'verified', rejectionReason: null, rialAmount: verified.rialAmount, receivedAt: now };
        // The unique (provider, eventId) index makes a concurrent duplicate collapse to one.
        await this.#events(uow.db).insertOne(event, { session: uow.session });

        const pastExpiry = Date.parse(fresh.expiresAt) < Date.now();

        if (target === 'succeeded') {
          // Documented late-callback rule: a success for an expired (or now-expired) purchase
          // does not credit; the purchase settles as expired and the event is retained.
          if (fresh.state === 'expired' || (fresh.state === 'payment_pending' && pastExpiry)) {
            if (fresh.state === 'payment_pending') await this.#purchases(uow.db).updateOne({ _id: fresh._id, version: fresh.version }, { $set: { state: 'expired', updatedAt: now, completedAt: now }, $inc: { version: 1 } }, { session: uow.session });
            uow.audit({ action: 'payment.late_callback_ignored', resourceType: 'dragon_coin_purchase', resourceId: fresh._id, after: { eventId: verified.eventId } });
            return { ...fresh, state: 'expired' };
          }
          if (fresh.state === 'succeeded') return fresh; // idempotent success from a distinct event id
          if (isTerminal(fresh.state) || !canTransition(fresh.state, 'succeeded')) throw new ConflictError('CONFLICTING_PROVIDER_EVENT', 'A conflicting outcome was already recorded for this purchase.');

          // Exactly-once credit committed together with the success transition.
          const command: PostCommand = {
            type: 'dragon_coin_issue',
            businessRef: fresh.businessRef,
            idempotencyKey: fresh.businessRef,
            description: 'dragon coin purchase',
            entries: [
              { account: this.#treasuryRef, amount: -fresh.dragonCoin },
              { account: this.#userRef(fresh.accountId), amount: fresh.dragonCoin }
            ],
            metadata: { purchaseId: fresh._id }
          };
          const posted = await this.#ledger.writeWithin(uow, ctx, command, resolved as NonNullable<typeof resolved>);
          const updated = await this.#purchases(uow.db).updateOne(
            { _id: fresh._id, state: 'payment_pending', version: fresh.version },
            { $set: { state: 'succeeded', callbackVerification: 'verified', ledgerTransactionId: posted.transaction._id, updatedAt: now, completedAt: now }, $inc: { version: 1 } },
            { session: uow.session }
          );
          if (updated.matchedCount === 0) throw new ConflictError('LEDGER_CREDIT_CONFLICT', 'The purchase changed while crediting. Retry.');
          uow.audit({ action: 'payment.purchase_succeeded', resourceType: 'dragon_coin_purchase', resourceId: fresh._id, after: { dragonCoin: fresh.dragonCoin, ledgerTransactionId: posted.transaction._id } });
          uow.publish({ eventName: 'payment.purchase_succeeded', eventVersion: 1, aggregateId: fresh._id, payload: { accountId: fresh.accountId, dragonCoin: fresh.dragonCoin } });
          return { ...fresh, state: 'succeeded', callbackVerification: 'verified', ledgerTransactionId: posted.transaction._id, completedAt: now, version: fresh.version + 1, updatedAt: now };
        }

        // Failure / cancellation.
        if (fresh.state === target) return fresh;
        if (isTerminal(fresh.state) || !canTransition(fresh.state, target)) throw new ConflictError('CONFLICTING_PROVIDER_EVENT', 'A conflicting outcome was already recorded for this purchase.');
        const updated = await this.#purchases(uow.db).updateOne({ _id: fresh._id, state: fresh.state, version: fresh.version }, { $set: { state: target, callbackVerification: 'verified', updatedAt: now, completedAt: now }, $inc: { version: 1 } }, { session: uow.session });
        if (updated.matchedCount === 0) throw new ConflictError('INVALID_STATE_TRANSITION', 'The purchase state changed. Retry.');
        uow.audit({ action: `payment.purchase_${target}`, resourceType: 'dragon_coin_purchase', resourceId: fresh._id });
        return { ...fresh, state: target, callbackVerification: 'verified', completedAt: now, version: fresh.version + 1, updatedAt: now };
      });
    } catch (error) {
      // A duplicate provider event or ledger business reference means the effect already
      // landed concurrently — converge to the stored result rather than error.
      if (isDuplicateKey(error) || this.#ledger.mapDuplicateKey(error) !== null) {
        return (await this.#purchases().findOne({ _id: purchase._id })) as PurchaseRecord;
      }
      throw error;
    }
  }

  async #recordRejected(verified: VerifiedCallback, purchaseId: EntityId | null, reason: string): Promise<void> {
    try {
      await this.#events().insertOne({ _id: newId(), purchaseId, provider: verified.provider, providerRequestId: verified.providerRequestId, eventId: verified.eventId, eventType: verified.eventType, verification: 'rejected', rejectionReason: reason, rialAmount: verified.rialAmount, receivedAt: utcNow() });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  // --- Correction (finance) ---

  /**
   * Reverses a successful purchase's Dragon Coin credit with a single compensating
   * ledger transaction, committed together with the purchase transition. Rejected if
   * reversal would drive the user's balance below zero (no silent debt).
   */
  async correctPurchase(context: RequestContext, purchaseId: EntityId, input: { expectedVersion: number; reason: string; correctionRef: string }): Promise<PurchaseRecord> {
    if (input.reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    if (input.correctionRef.trim() === '') throw new ValidationError('A correction reference is required.', [{ field: 'correctionRef', code: 'INVALID_CORRECTION_REFERENCE', message: 'Provide a correction reference.' }]);
    const purchase = await this.#purchases().findOne({ _id: purchaseId });
    if (purchase === null) throw new NotFoundError('Unknown purchase.');
    if (purchase.state !== 'succeeded' || purchase.ledgerTransactionId === null) throw new ConflictError('INVALID_STATE_TRANSITION', 'Only a successful purchase can be corrected.');

    const { command, expectedAsset, reversalOf, refs } = await this.#ledger.buildCompensation(purchase.ledgerTransactionId, {
      businessRef: `dragon_coin_purchase_correction:${input.correctionRef}`,
      idempotencyKey: `dragon_coin_purchase_correction:${input.correctionRef}`,
      reason: input.reason
    });
    const resolved = await this.#ledger.ensureAccounts(refs);

    try {
      return await runUnitOfWork(this.#database, context, async (uow) => {
        const now = utcNow();
        const posted = await this.#ledger.writeWithin(uow, context, command, resolved, { expectedAsset, reversalOf });
        const updated = await this.#purchases(uow.db).updateOne(
          { _id: purchase._id, state: 'succeeded', version: input.expectedVersion, correctionRef: null },
          { $set: { state: 'corrected', correctionRef: input.correctionRef, correctionTransactionId: posted.transaction._id, updatedAt: now }, $inc: { version: 1 } },
          { session: uow.session }
        );
        if (updated.matchedCount === 0) throw new ConflictError('CORRECTION_ALREADY_APPLIED', 'This purchase was already corrected or changed. Reload and retry.');
        uow.audit({ action: 'payment.purchase_corrected', resourceType: 'dragon_coin_purchase', resourceId: purchase._id, before: { state: 'succeeded' }, after: { state: 'corrected', correctionTransactionId: posted.transaction._id }, reason: input.reason });
        uow.publish({ eventName: 'payment.purchase_corrected', eventVersion: 1, aggregateId: purchase._id, payload: { accountId: purchase.accountId, correctionRef: input.correctionRef } });
        return { ...purchase, state: 'corrected', correctionRef: input.correctionRef, correctionTransactionId: posted.transaction._id, version: purchase.version + 1, updatedAt: now };
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'INSUFFICIENT_FUNDS') throw new ConflictError('INSUFFICIENT_BALANCE_FOR_CORRECTION', 'The user has already spent these coins; a reversal would create a negative balance. Manual resolution is required.');
      const dup = this.#ledger.mapDuplicateKey(error);
      if (dup !== null || isDuplicateKey(error)) throw new ConflictError('CORRECTION_ALREADY_APPLIED', 'This correction was already applied.');
      throw error;
    }
  }

  // --- Reads ---

  /** Owner-scoped read; lazily settles an overdue pending purchase to expired. */
  async getPurchase(accountId: EntityId, purchaseId: EntityId): Promise<PurchaseRecord | null> {
    const purchase = await this.#purchases().findOne({ _id: purchaseId, accountId });
    if (purchase === null) return null;
    return this.#lazyExpire(purchase);
  }

  async listPurchases(accountId: EntityId, query: { cursor?: string; limit?: number } = {}): Promise<Page<PurchaseRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { accountId };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    }
    const rows = await this.#purchases().find(filter).sort({ createdAt: -1, _id: 1 }).limit(limit + 1).toArray();
    const settled = await Promise.all(rows.map((row) => this.#lazyExpire(row)));
    const page = toPage(settled.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as PurchaseRecord), nextCursor: page.nextCursor };
  }

  async #lazyExpire(purchase: PurchaseRecord): Promise<PurchaseRecord> {
    if (purchase.state !== 'payment_pending' || Date.parse(purchase.expiresAt) >= Date.now()) return purchase;
    const now = utcNow();
    const updated = await this.#purchases().updateOne({ _id: purchase._id, state: 'payment_pending', version: purchase.version }, { $set: { state: 'expired', updatedAt: now, completedAt: now }, $inc: { version: 1 } });
    return updated.matchedCount === 0 ? ((await this.#purchases().findOne({ _id: purchase._id })) as PurchaseRecord) : { ...purchase, state: 'expired', completedAt: now, version: purchase.version + 1, updatedAt: now };
  }

  /** Current Dragon Coin balance for an account (0 when no account has been created yet). */
  async getDragonCoinBalance(accountId: EntityId): Promise<{ balance: number }> {
    const view = await this.#ledger.getBalanceByRef(this.#userRef(accountId));
    return { balance: view?.balance ?? 0 };
  }
}
