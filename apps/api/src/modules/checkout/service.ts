import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import { withIdempotency } from '../../shared/db/idempotency.ts';
import { createRequestContext, SYSTEM_ACTOR, type RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import type { FeeDefinition, TournamentRecord } from '../tournaments/index.ts';
import type { RegistrationsService } from '../registrations/index.ts';
import type { LedgerService, AccountRef } from '../ledger/index.ts';
import type { HoldsService } from '../holds/index.ts';
import type { PaymentProvider, VerifiedCallback } from '../payments/index.ts';
import { CHECKOUT_COLLECTIONS } from './collections.ts';
import { isCheckoutTerminal, type CheckoutRecord } from './state.ts';

/**
 * Paid tournament registration checkout (DRAGON-12).
 *
 * Server-recalculates the fee, reserves a seat + Dragon Coin hold, collects the
 * Toman portion through the mock provider, then activates the registration and posts
 * the fee effects atomically. Only the mock provider and approved ledger are used;
 * there is no live provider, Dragon Coin refund, or cash-out. Gated by OD-007.
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export interface CheckoutConfigView {
  paidTournamentsEnabled: boolean;
  ttlSeconds: number;
}

/** Server-computed fee split (exact integers): rial (Toman) and Dragon Coin portions. */
export function computeFee(fee: FeeDefinition): { irr: number; drc: number } {
  let irr = 0;
  let drc = 0;
  for (const component of fee.components) {
    if (component.assetCode === 'IRR') irr += component.amountInteger;
    else if (component.assetCode === 'DRC') drc += component.amountInteger;
  }
  return { irr, drc };
}

export class CheckoutService {
  readonly #database: Database;
  readonly #config: CheckoutConfigView;
  readonly #tournaments: { getById(id: string): Promise<TournamentRecord | null> };
  readonly #registrations: RegistrationsService;
  readonly #ledger: LedgerService;
  readonly #holds: HoldsService;
  readonly #provider: PaymentProvider;

  constructor(
    database: Database,
    config: CheckoutConfigView,
    tournaments: { getById(id: string): Promise<TournamentRecord | null> },
    registrations: RegistrationsService,
    ledger: LedgerService,
    holds: HoldsService,
    provider: PaymentProvider
  ) {
    this.#database = database;
    this.#config = config;
    this.#tournaments = tournaments;
    this.#registrations = registrations;
    this.#ledger = ledger;
    this.#holds = holds;
    this.#provider = provider;
  }

  get provider(): PaymentProvider {
    return this.#provider;
  }
  get #db(): Db {
    return this.#database.db;
  }
  #checkouts(db: Db = this.#db) {
    return db.collection<CheckoutRecord>(CHECKOUT_COLLECTIONS.checkouts);
  }
  #cashClearing: AccountRef = { kind: 'system', accountType: 'cash_clearing' };
  #feeHolding: AccountRef = { kind: 'system', accountType: 'tournament_fee_holding' };

  // --- Reads ---

  async getCheckout(accountId: EntityId, checkoutId: EntityId): Promise<CheckoutRecord | null> {
    return this.#checkouts().findOne({ _id: checkoutId, accountId });
  }

  async listCheckouts(accountId: EntityId, query: { cursor?: string; limit?: number } = {}): Promise<Page<CheckoutRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { accountId };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    const rows = await this.#checkouts().find(filter).sort({ createdAt: -1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as CheckoutRecord), nextCursor: page.nextCursor };
  }

  // --- Start ---

  async startCheckout(context: RequestContext, accountId: EntityId, tournamentId: EntityId, input: { idempotencyKey: string; teamId?: string; answers?: Array<{ key: string; value: string }> }): Promise<CheckoutRecord> {
    if (!this.#config.paidTournamentsEnabled) throw new ConflictError('PAID_TOURNAMENTS_DISABLED', 'Paid tournament registration is not available yet.');
    const tournament = await this.#tournaments.getById(tournamentId);
    if (tournament === null || tournament.state !== 'published') throw new NotFoundError('Unknown tournament.');
    const prepared = await this.#registrations.preparePaidRegistration(context, accountId, tournamentId, { idempotencyKey: input.idempotencyKey, ...(input.teamId === undefined ? {} : { teamId: input.teamId }), ...(input.answers === undefined ? {} : { answers: input.answers }) });
    const { irr, drc } = computeFee(tournament.fee);
    if (irr <= 0 && drc <= 0) throw new ValidationError('This tournament has no fee.', [{ field: 'fee', code: 'FREE_TOURNAMENT', message: 'Register directly; no checkout is needed.' }]);

    const businessRef = `checkout:${tournamentId}:${prepared.subjectId}`;
    const userAccountId = drc > 0 ? ((await this.#ledger.ensureAccounts([this.#holds.userAccountRef(accountId)])).values().next().value as { _id: EntityId })._id : null;

    const outcome = await withIdempotency(this.#db, { scope: `checkout_start:${accountId}`, key: input.idempotencyKey, request: { tournamentId, subjectId: prepared.subjectId } }, async () => {
      try {
        return await runUnitOfWork(this.#database, context, async (uow) => {
          const registration = await this.#registrations.reservePaidRegistrationWithin(uow, prepared);
          let holdId: EntityId | null = null;
          if (drc > 0) {
            const hold = await this.#holds.reserveHoldWithin(uow, context, accountId, userAccountId as EntityId, { purpose: 'tournament_checkout', amount: drc, businessRef: `checkout_hold:${businessRef}`, domainRef: tournamentId, ttlSeconds: this.#config.ttlSeconds });
            holdId = hold._id;
          }
          const checkoutId = newId();
          const providerRequestId = irr > 0 ? (await this.#provider.createRequest({ purchaseId: checkoutId, businessRef, rialAmount: irr, correlationId: context.correlationId })).providerRequestId : null;
          const now = utcNow();
          const checkout: CheckoutRecord = {
            _id: checkoutId,
            tournamentId,
            accountId,
            subjectId: prepared.subjectId,
            registrationId: registration._id,
            feeVersion: tournament.version,
            irrAmount: irr,
            drcAmount: drc,
            provider: this.#provider.name,
            providerRequestId,
            holdId,
            irrPaid: false,
            drcCaptured: false,
            businessRef,
            feeTransactionId: null,
            state: irr > 0 ? 'awaiting_payment' : 'awaiting_confirmation',
            correlationId: context.correlationId,
            metadata: {},
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(Date.now() + this.#config.ttlSeconds * 1000).toISOString(),
            completedAt: null,
            version: 1
          };
          await this.#checkouts(uow.db).insertOne(checkout, { session: uow.session });
          uow.audit({ action: 'checkout.started', resourceType: 'registration_checkout', resourceId: checkoutId, after: { tournamentId, irrAmount: irr, drcAmount: drc } });
          uow.publish({ eventName: 'checkout.started', eventVersion: 1, aggregateId: checkoutId, payload: { tournamentId, accountId } });
          return checkout;
        });
      } catch (error) {
        if (isDuplicateKey(error)) throw new ConflictError('CHECKOUT_EXISTS', 'A checkout or active registration already exists for this participant.');
        throw error;
      }
    });
    return outcome.result;
  }

  // --- Completion (activation) ---

  /** Owner-confirmed completion for a Dragon-Coin-only checkout (no Toman portion). */
  async confirmDragonCoin(context: RequestContext, accountId: EntityId, checkoutId: EntityId): Promise<CheckoutRecord> {
    const checkout = await this.#checkouts().findOne({ _id: checkoutId, accountId });
    if (checkout === null) throw new NotFoundError('Unknown checkout.');
    if (checkout.irrAmount > 0) throw new ConflictError('PAYMENT_REQUIRED', 'This checkout requires a Toman payment.');
    if (checkout.state === 'activated') return checkout;
    if (isCheckoutTerminal(checkout.state)) throw new ConflictError('CHECKOUT_NOT_ACTIVE', 'This checkout can no longer be completed.');
    return this.#complete(context, checkout);
  }

  /** Processes a verified provider callback for the Toman fee portion. */
  async handleFeeCallback(rawCallback: Parameters<PaymentProvider['verifyCallback']>[0]): Promise<CheckoutRecord> {
    const verified: VerifiedCallback = this.#provider.verifyCallback(rawCallback);
    const checkout = await this.#checkouts().findOne({ _id: verified.purchaseId });
    if (checkout === null) throw new NotFoundError('Unknown checkout.');
    if (verified.provider !== checkout.provider || verified.providerRequestId !== checkout.providerRequestId) throw new ConflictError('CALLBACK_VERIFICATION_FAILED', 'The callback does not match the checkout.');
    if (verified.asset !== 'IRR' || verified.rialAmount !== checkout.irrAmount) throw new ConflictError('CALLBACK_AMOUNT_MISMATCH', 'The paid amount does not match the checkout fee.');

    const ctx = createRequestContext(newId(), SYSTEM_ACTOR);
    if (verified.eventType === 'success') {
      if (checkout.state === 'activated') return checkout;
      if (isCheckoutTerminal(checkout.state)) throw new ConflictError('CHECKOUT_NOT_ACTIVE', 'This checkout can no longer be completed.');
      return this.#complete(ctx, checkout);
    }
    return this.#settle(ctx, checkout, verified.eventType === 'cancelled' ? 'cancelled' : 'failed', `provider ${verified.eventType}`);
  }

  async #complete(context: RequestContext, checkout: CheckoutRecord): Promise<CheckoutRecord> {
    // Resolve every account before opening the transaction (creation is non-transactional).
    const refs: AccountRef[] = [];
    if (checkout.drcAmount > 0) refs.push(this.#holds.userAccountRef(checkout.accountId), this.#holds.captureDestinationRef('tournament_checkout'));
    if (checkout.irrAmount > 0) refs.push(this.#cashClearing, this.#feeHolding);
    const resolved = await this.#ledger.ensureAccounts(refs);
    const hold = checkout.holdId !== null ? await this.#holds.getHoldById(checkout.holdId) : null;

    try {
      return await runUnitOfWork(this.#database, context, async (uow) => {
        const fresh = (await this.#checkouts(uow.db).findOne({ _id: checkout._id }, { session: uow.session })) as CheckoutRecord;
        if (fresh.state === 'activated') return fresh;
        if (isCheckoutTerminal(fresh.state)) throw new ConflictError('CHECKOUT_NOT_ACTIVE', 'This checkout can no longer be completed.');

        // Capture the Dragon Coin hold (user → treasury) if there is a coin portion.
        if (hold !== null) await this.#holds.captureFullWithin(uow, context, hold, resolved, 'tournament entry fee');
        // Record the collected Toman fee (cash clearing → fee holding) if there is a Toman portion.
        let feeTransactionId: EntityId | null = null;
        if (checkout.irrAmount > 0) {
          const posted = await this.#ledger.writeWithin(
            uow,
            context,
            { type: 'cash_fee_collection', businessRef: `checkout_fee:${checkout._id}`, idempotencyKey: `checkout_fee:${checkout._id}`, description: 'tournament fee', entries: [{ account: this.#cashClearing, amount: -checkout.irrAmount }, { account: this.#feeHolding, amount: checkout.irrAmount }], metadata: { checkoutId: checkout._id } },
            resolved
          );
          feeTransactionId = posted.transaction._id;
        }
        // Activate the reserved registration atomically with the fee effects.
        await this.#registrations.activatePaidRegistrationWithin(uow, checkout.registrationId);

        const now = utcNow();
        const updated = await this.#checkouts(uow.db).updateOne(
          { _id: checkout._id, state: { $in: ['awaiting_payment', 'awaiting_confirmation'] }, version: fresh.version },
          { $set: { state: 'activated', irrPaid: checkout.irrAmount > 0, drcCaptured: checkout.drcAmount > 0, feeTransactionId, completedAt: now, updatedAt: now }, $inc: { version: 1 } },
          { session: uow.session }
        );
        if (updated.matchedCount === 0) throw new ConflictError('CHECKOUT_NOT_ACTIVE', 'The checkout changed while activating. Retry.');
        uow.audit({ action: 'checkout.activated', resourceType: 'registration_checkout', resourceId: checkout._id, after: { registrationId: checkout.registrationId, feeTransactionId } });
        uow.publish({ eventName: 'checkout.activated', eventVersion: 1, aggregateId: checkout._id, payload: { tournamentId: checkout.tournamentId, accountId: checkout.accountId, registrationId: checkout.registrationId } });
        return { ...checkout, state: 'activated', irrPaid: checkout.irrAmount > 0, drcCaptured: checkout.drcAmount > 0, feeTransactionId, completedAt: now, version: checkout.version + 1, updatedAt: now };
      });
    } catch (error) {
      // A duplicate ledger business reference means completion already landed concurrently.
      if (this.#ledger.mapDuplicateKey(error) !== null || isDuplicateKey(error)) return (await this.#checkouts().findOne({ _id: checkout._id })) as CheckoutRecord;
      throw error;
    }
  }

  // --- Cancellation / expiry / failure ---

  async cancelCheckout(context: RequestContext, accountId: EntityId, checkoutId: EntityId, reason: string): Promise<CheckoutRecord> {
    const checkout = await this.#checkouts().findOne({ _id: checkoutId, accountId });
    if (checkout === null) throw new NotFoundError('Unknown checkout.');
    if (checkout.state === 'cancelled') return checkout;
    if (isCheckoutTerminal(checkout.state)) throw new ConflictError('CHECKOUT_NOT_ACTIVE', 'This checkout can no longer be cancelled.');
    return this.#settle(context, checkout, 'cancelled', reason);
  }

  async #settle(context: RequestContext, checkout: CheckoutRecord, terminal: 'cancelled' | 'expired' | 'failed', reason: string): Promise<CheckoutRecord> {
    const hold = checkout.holdId !== null ? await this.#holds.getHoldById(checkout.holdId) : null;
    return runUnitOfWork(this.#database, context, async (uow) => {
      const fresh = (await this.#checkouts(uow.db).findOne({ _id: checkout._id }, { session: uow.session })) as CheckoutRecord;
      if (fresh.state === terminal) return fresh;
      if (isCheckoutTerminal(fresh.state)) throw new ConflictError('CHECKOUT_NOT_ACTIVE', 'This checkout is already settled.');
      // Release the Dragon Coin reservation (no journal) and cancel the reserved seat.
      if (hold !== null) await this.#holds.releaseFullWithin(uow, hold, reason);
      await this.#registrations.cancelPaidRegistrationWithin(uow, checkout.registrationId, reason);
      const now = utcNow();
      const updated = await this.#checkouts(uow.db).updateOne(
        { _id: checkout._id, state: { $in: ['awaiting_payment', 'awaiting_confirmation'] }, version: fresh.version },
        { $set: { state: terminal, completedAt: now, updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (updated.matchedCount === 0) throw new ConflictError('CHECKOUT_NOT_ACTIVE', 'The checkout changed while settling. Retry.');
      uow.audit({ action: `checkout.${terminal}`, resourceType: 'registration_checkout', resourceId: checkout._id, reason });
      uow.publish({ eventName: `checkout.${terminal}`, eventVersion: 1, aggregateId: checkout._id, payload: { tournamentId: checkout.tournamentId, accountId: checkout.accountId } });
      return { ...checkout, state: terminal, completedAt: now, version: checkout.version + 1, updatedAt: now };
    });
  }

  /** Bounded, deterministic expiry of overdue awaiting checkouts (releases seat + hold). */
  async expireDueCheckouts(context: RequestContext, options: { limit?: number } = {}): Promise<{ expired: number }> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 100));
    const now = utcNow();
    const due = await this.#checkouts().find({ state: { $in: ['awaiting_payment', 'awaiting_confirmation'] }, expiresAt: { $lt: now } }).sort({ expiresAt: 1 }).limit(limit).toArray();
    let expired = 0;
    for (const checkout of due) {
      try {
        const settled = await this.#settle(context, checkout, 'expired', 'checkout expired');
        if (settled.state === 'expired') expired += 1;
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
      }
    }
    return { expired };
  }
}
