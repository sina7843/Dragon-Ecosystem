import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork, type UnitOfWork } from '../../shared/db/unit-of-work.ts';
import { withIdempotency } from '../../shared/db/idempotency.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import type { LedgerService } from '../ledger/index.ts';
import type { AccountRef, PostCommand, LedgerAccountRecord } from '../ledger/index.ts';
import { HOLDS_COLLECTIONS } from './collections.ts';
import { HOLD_PURPOSES, TRANSFER_TYPES, isHoldPurpose, type HoldPurpose, type TransferType } from './purposes.ts';
import { canHoldTransition, isHoldOpen, type HoldRecord } from './state.ts';

/**
 * Dragon Coin holds (DRAGON-11c).
 *
 * A hold reserves available balance (`availableBalance = ledgerBalance − heldAmount`)
 * without touching the ledger balance. Capture converts part or all of a hold into
 * an immutable ledger transfer committed in the same transaction as the hold update;
 * release and expiry return reserved availability with no journal. Amounts always
 * conserve: originalAmount = capturedAmount + releasedAmount + remainingAmount.
 *
 * Concurrency authorities (not read-before-write): the ledger `reserveHeld` atomic
 * `$expr` guard (exactly one holder consumes the final available balance), the
 * unique hold businessRef index, the per-capture ledger businessRef, and optimistic
 * hold-version guards. Gated purposes/transfers are fail-closed.
 */

const DEFAULT_HOLD_TTL_SECONDS = 3600;
export const MAX_EXPIRY_BATCH = 100;
const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export interface HoldSummary {
  ledgerBalance: number;
  heldAmount: number;
  availableBalance: number;
}

export class HoldsService {
  readonly #database: Database;
  readonly #ledger: LedgerService;

  constructor(database: Database, ledger: LedgerService) {
    this.#database = database;
    this.#ledger = ledger;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #holds(db: Db = this.#db) {
    return db.collection<HoldRecord>(HOLDS_COLLECTIONS.holds);
  }
  #userRef(ownerId: EntityId): AccountRef {
    return { kind: 'user', ownerId, accountType: 'user_dragon_coin' };
  }

  // --- Reads ---

  async getSummary(ownerId: EntityId): Promise<HoldSummary> {
    return this.#ledger.getAvailability(this.#userRef(ownerId));
  }

  async getHold(ownerId: EntityId, holdId: EntityId): Promise<HoldRecord | null> {
    return this.#holds().findOne({ _id: holdId, ownerId });
  }

  async listHolds(ownerId: EntityId, query: { cursor?: string; limit?: number } = {}): Promise<Page<HoldRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { ownerId };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    }
    const rows = await this.#holds().find(filter).sort({ createdAt: -1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as HoldRecord), nextCursor: page.nextCursor };
  }

  // --- Create ---

  /** Creates a hold that atomically reserves available balance. Idempotent per (owner, key). */
  async createHold(context: RequestContext, ownerId: EntityId, input: { purpose: string; amount: number; businessRef: string; idempotencyKey: string; domainRef?: string; ttlSeconds?: number; metadata?: Readonly<Record<string, string | number | boolean>> }): Promise<HoldRecord> {
    if (!isHoldPurpose(input.purpose)) throw new ValidationError('The hold purpose is not valid.', [{ field: 'purpose', code: 'INVALID_HOLD_PURPOSE', message: 'Unknown hold purpose.' }]);
    const policy = HOLD_PURPOSES[input.purpose];
    if (!policy.enabled) throw new ConflictError('HOLD_PURPOSE_DISABLED', 'This hold purpose is not enabled.');
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new ValidationError('The hold amount is not valid.', [{ field: 'amount', code: 'UNSAFE_INTEGER', message: 'Use a positive whole amount.' }]);
    if (input.businessRef.trim() === '') throw new ValidationError('A business reference is required.', [{ field: 'businessRef', code: 'INVALID_BUSINESS_REFERENCE', message: 'Provide a business reference.' }]);

    const account = (await this.#ledger.ensureAccounts([this.#userRef(ownerId)])).values().next().value as { _id: EntityId };
    const purpose = input.purpose;
    const outcome = await withIdempotency(this.#db, { scope: `hold_create:${ownerId}`, key: input.idempotencyKey, request: { purpose, amount: input.amount, businessRef: input.businessRef } }, async () => {
      try {
        return await runUnitOfWork(this.#database, context, async (uow) => {
          const reserved = await this.#ledger.reserveHeld(uow, account._id, input.amount);
          if (!reserved) throw new ConflictError('INSUFFICIENT_AVAILABLE_BALANCE', 'The available balance is not enough for this hold.');
          const now = utcNow();
          const hold: HoldRecord = {
            _id: newId(),
            ownerId,
            ledgerAccountId: account._id,
            assetCode: 'DRC',
            scale: 0,
            originalAmount: input.amount,
            remainingAmount: input.amount,
            capturedAmount: 0,
            releasedAmount: 0,
            purpose,
            businessRef: input.businessRef,
            domainRef: input.domainRef ?? null,
            state: 'active',
            captureTransactionIds: [],
            captureCount: 0,
            actorId: context.actor.accountId ?? 'system',
            correlationId: context.correlationId,
            metadata: input.metadata ?? {},
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(Date.now() + (input.ttlSeconds ?? DEFAULT_HOLD_TTL_SECONDS) * 1000).toISOString(),
            terminalAt: null,
            version: 1
          };
          await this.#holds(uow.db).insertOne(hold, { session: uow.session });
          uow.audit({ action: 'hold.created', resourceType: 'dragon_coin_hold', resourceId: hold._id, after: { ownerId, purpose, amount: input.amount, businessRef: input.businessRef } });
          uow.publish({ eventName: 'hold.created', eventVersion: 1, aggregateId: hold._id, payload: { ownerId, purpose, amount: input.amount } });
          return hold;
        });
      } catch (error) {
        if (isDuplicateKey(error)) throw new ConflictError('HOLD_ALREADY_EXISTS', 'A hold already exists for this business reference.');
        throw error;
      }
    });
    return outcome.result;
  }

  // --- Capture ---

  /** Captures part or all of a hold into an immutable ledger transfer. Idempotent per key. */
  async captureHold(context: RequestContext, holdId: EntityId, input: { amount: number; idempotencyKey: string; reason?: string }): Promise<HoldRecord> {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new ValidationError('The capture amount is not valid.', [{ field: 'amount', code: 'UNSAFE_INTEGER', message: 'Use a positive whole amount.' }]);
    const hold = await this.#holds().findOne({ _id: holdId });
    if (hold === null) throw new NotFoundError('Unknown hold.');
    const policy = HOLD_PURPOSES[hold.purpose];
    if (!policy.enabled) throw new ConflictError('HOLD_PURPOSE_DISABLED', 'This hold purpose is not enabled.');
    const destRef: AccountRef = { kind: 'system', accountType: policy.captureDestination };
    const resolved = await this.#ledger.ensureAccounts([this.#userRef(hold.ownerId), destRef]);

    const outcome = await withIdempotency(this.#db, { scope: `hold_capture:${holdId}`, key: input.idempotencyKey, request: { amount: input.amount } }, async () => {
      try {
        return await runUnitOfWork(this.#database, context, async (uow) => {
          const fresh = (await this.#holds(uow.db).findOne({ _id: holdId }, { session: uow.session })) as HoldRecord;
          if (!isHoldOpen(fresh.state)) throw new ConflictError('HOLD_NOT_ACTIVE', 'This hold can no longer be captured.');
          if (input.amount > fresh.remainingAmount) throw new ConflictError('CAPTURE_EXCEEDS_REMAINING', 'The capture amount exceeds the remaining hold.');
          if (input.amount < fresh.remainingAmount && !policy.partialCaptureAllowed) throw new ConflictError('PARTIAL_CAPTURE_NOT_ALLOWED', 'Partial capture is not allowed for this hold.');

          const captureSeq = fresh.captureCount + 1;
          const command: PostCommand = {
            type: 'dragon_coin_transfer',
            businessRef: `dragon_coin_hold_capture:${holdId}:${String(captureSeq)}`,
            idempotencyKey: `dragon_coin_hold_capture:${holdId}:${String(captureSeq)}`,
            description: input.reason ?? 'hold capture',
            entries: [
              { account: this.#userRef(hold.ownerId), amount: -input.amount },
              { account: destRef, amount: input.amount }
            ],
            metadata: { holdId }
          };
          const posted = await this.#ledger.writeWithin(uow, context, command, resolved);
          // The captured funds have left the balance; release their reservation so
          // available balance is unchanged by the capture.
          await this.#ledger.releaseHeld(uow, fresh.ledgerAccountId, input.amount);

          const remaining = fresh.remainingAmount - input.amount;
          const now = utcNow();
          const nextState: HoldRecord['state'] = remaining === 0 ? 'captured' : 'partially_captured';
          const updated = await this.#holds(uow.db).updateOne(
            { _id: holdId, version: fresh.version, captureCount: fresh.captureCount },
            { $set: { remainingAmount: remaining, capturedAmount: fresh.capturedAmount + input.amount, state: nextState, updatedAt: now, terminalAt: remaining === 0 ? now : null }, $inc: { version: 1, captureCount: 1 }, $push: { captureTransactionIds: posted.transaction._id } },
            { session: uow.session }
          );
          if (updated.matchedCount === 0) throw new ConflictError('STALE_HOLD_VERSION', 'The hold changed while capturing. Reload and retry.');
          uow.audit({ action: 'hold.captured', resourceType: 'dragon_coin_hold', resourceId: holdId, after: { amount: input.amount, state: nextState, ledgerTransactionId: posted.transaction._id }, reason: input.reason ?? null });
          uow.publish({ eventName: 'hold.captured', eventVersion: 1, aggregateId: holdId, payload: { ownerId: hold.ownerId, amount: input.amount } });
          return { ...fresh, remainingAmount: remaining, capturedAmount: fresh.capturedAmount + input.amount, state: nextState, captureCount: captureSeq, captureTransactionIds: [...fresh.captureTransactionIds, posted.transaction._id], version: fresh.version + 1, updatedAt: now, terminalAt: remaining === 0 ? now : fresh.terminalAt };
        });
      } catch (error) {
        if (this.#ledger.mapDuplicateKey(error) !== null || isDuplicateKey(error)) throw new ConflictError('LEDGER_CREDIT_CONFLICT', 'This capture was already applied. Reload and retry.');
        throw error;
      }
    });
    return outcome.result;
  }

  // --- Release / cancel ---

  /** Releases remaining (or a partial amount) reservation without any journal. Idempotent per key. */
  async releaseHold(context: RequestContext, holdId: EntityId, input: { amount?: number; reason: string; idempotencyKey: string }): Promise<HoldRecord> {
    if (input.reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    const hold = await this.#holds().findOne({ _id: holdId });
    if (hold === null) throw new NotFoundError('Unknown hold.');

    const outcome = await withIdempotency(this.#db, { scope: `hold_release:${holdId}`, key: input.idempotencyKey, request: { amount: input.amount ?? null } }, async () => {
      return runUnitOfWork(this.#database, context, async (uow) => {
        const fresh = (await this.#holds(uow.db).findOne({ _id: holdId }, { session: uow.session })) as HoldRecord;
        if (!isHoldOpen(fresh.state)) throw new ConflictError('HOLD_NOT_ACTIVE', 'This hold can no longer be released.');
        const amount = input.amount ?? fresh.remainingAmount;
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError('The release amount is not valid.', [{ field: 'amount', code: 'UNSAFE_INTEGER', message: 'Use a positive whole amount.' }]);
        if (amount > fresh.remainingAmount) throw new ConflictError('RELEASE_EXCEEDS_REMAINING', 'The release amount exceeds the remaining hold.');
        return this.#applyRelease(uow, fresh, amount, 'released', input.reason);
      });
    });
    return outcome.result;
  }

  /** Shared release/expiry application: unreserves availability and advances the hold. */
  async #applyRelease(uow: UnitOfWork, fresh: HoldRecord, amount: number, terminalReason: 'released' | 'expired', reason: string): Promise<HoldRecord> {
    await this.#ledger.releaseHeld(uow, fresh.ledgerAccountId, amount);
    const remaining = fresh.remainingAmount - amount;
    const now = utcNow();
    // Fully released → terminal (released/expired); a partial release of a still-open
    // hold keeps it open (active or partially_captured, based on capture history).
    const nextState: HoldRecord['state'] = remaining === 0 ? terminalReason : fresh.capturedAmount > 0 ? 'partially_captured' : 'active';
    if (!canHoldTransition(fresh.state, nextState) && nextState !== fresh.state) throw new ConflictError('HOLD_NOT_ACTIVE', 'This hold can no longer change.');
    const updated = await this.#holds(uow.db).updateOne(
      { _id: fresh._id, version: fresh.version },
      { $set: { remainingAmount: remaining, releasedAmount: fresh.releasedAmount + amount, state: nextState, updatedAt: now, terminalAt: remaining === 0 ? now : fresh.terminalAt }, $inc: { version: 1 } },
      { session: uow.session }
    );
    if (updated.matchedCount === 0) throw new ConflictError('STALE_HOLD_VERSION', 'The hold changed while releasing. Reload and retry.');
    uow.audit({ action: `hold.${terminalReason}`, resourceType: 'dragon_coin_hold', resourceId: fresh._id, after: { amount, state: nextState }, reason });
    uow.publish({ eventName: `hold.${terminalReason}`, eventVersion: 1, aggregateId: fresh._id, payload: { ownerId: fresh.ownerId, amount } });
    return { ...fresh, remainingAmount: remaining, releasedAmount: fresh.releasedAmount + amount, state: nextState, version: fresh.version + 1, updatedAt: now, terminalAt: remaining === 0 ? now : fresh.terminalAt };
  }

  // --- Expiry (bounded, deterministic) ---

  /**
   * Expires overdue open holds, releasing their remaining reservation. Bounded and
   * paginated (never scans all holds); each hold's version guard makes duplicate or
   * concurrent expiry safe. Uses the server clock, never a client-supplied time.
   */
  async expireDueHolds(context: RequestContext, options: { limit?: number } = {}): Promise<{ expired: number }> {
    const limit = Math.min(MAX_EXPIRY_BATCH, Math.max(1, options.limit ?? MAX_EXPIRY_BATCH));
    const now = utcNow();
    const due = await this.#holds().find({ state: { $in: ['active', 'partially_captured'] }, expiresAt: { $lt: now } }).sort({ expiresAt: 1 }).limit(limit).toArray();
    let expired = 0;
    for (const hold of due) {
      try {
        await runUnitOfWork(this.#database, context, async (uow) => {
          const fresh = await this.#holds(uow.db).findOne({ _id: hold._id }, { session: uow.session });
          if (fresh === null || !isHoldOpen(fresh.state) || Date.parse(fresh.expiresAt) >= Date.now()) return;
          await this.#applyRelease(uow, fresh, fresh.remainingAmount, 'expired', 'hold expired');
          expired += 1;
        });
      } catch (error) {
        // A concurrent capture/release settled this hold first; skip it, do not fail the batch.
        if (!(error instanceof ConflictError)) throw error;
      }
    }
    return { expired };
  }

  // --- Gated transfers (fail-closed) ---

  /** Typed transfer execution. Every transfer type is gated in this slice; a gated type is refused with no effect. */
  executeTransfer(_context: RequestContext, type: string): Promise<never> {
    if (type in TRANSFER_TYPES) {
      const policy = TRANSFER_TYPES[type as TransferType];
      if (!policy.enabled) return Promise.reject(new ConflictError('TRANSFER_FEATURE_DISABLED', 'This transfer type is not enabled.'));
    }
    return Promise.reject(new ValidationError('The transfer type is not supported.', [{ field: 'type', code: 'UNSUPPORTED_TRANSFER_TYPE', message: 'Unknown transfer type.' }]));
  }

  // --- Within-transaction helpers (DRAGON-12): let the paid checkout reserve, capture,
  // and release a hold atomically together with the registration and payment ledger. ---

  userAccountRef(ownerId: EntityId): AccountRef {
    return this.#userRef(ownerId);
  }
  captureDestinationRef(purpose: HoldPurpose): AccountRef {
    return { kind: 'system', accountType: HOLD_PURPOSES[purpose].captureDestination };
  }

  /** Reserves availability and inserts a hold inside the caller's transaction (account resolved beforehand). */
  async reserveHoldWithin(uow: UnitOfWork, context: RequestContext, ownerId: EntityId, ledgerAccountId: EntityId, input: { purpose: HoldPurpose; amount: number; businessRef: string; domainRef?: string; ttlSeconds?: number }): Promise<HoldRecord> {
    if (!HOLD_PURPOSES[input.purpose].enabled) throw new ConflictError('HOLD_PURPOSE_DISABLED', 'This hold purpose is not enabled.');
    const reserved = await this.#ledger.reserveHeld(uow, ledgerAccountId, input.amount);
    if (!reserved) throw new ConflictError('INSUFFICIENT_AVAILABLE_BALANCE', 'The available balance is not enough for this hold.');
    const now = utcNow();
    const hold: HoldRecord = {
      _id: newId(), ownerId, ledgerAccountId, assetCode: 'DRC', scale: 0,
      originalAmount: input.amount, remainingAmount: input.amount, capturedAmount: 0, releasedAmount: 0,
      purpose: input.purpose, businessRef: input.businessRef, domainRef: input.domainRef ?? null,
      state: 'active', captureTransactionIds: [], captureCount: 0,
      actorId: context.actor.accountId ?? 'system', correlationId: context.correlationId, metadata: {},
      createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + (input.ttlSeconds ?? DEFAULT_HOLD_TTL_SECONDS) * 1000).toISOString(), terminalAt: null, version: 1
    };
    await this.#holds(uow.db).insertOne(hold, { session: uow.session });
    uow.audit({ action: 'hold.created', resourceType: 'dragon_coin_hold', resourceId: hold._id, after: { ownerId, purpose: input.purpose, amount: input.amount, businessRef: input.businessRef } });
    uow.publish({ eventName: 'hold.created', eventVersion: 1, aggregateId: hold._id, payload: { ownerId, purpose: input.purpose, amount: input.amount } });
    return hold;
  }

  /** Fully captures a hold into a ledger transfer inside the caller's transaction (accounts resolved beforehand). */
  async captureFullWithin(uow: UnitOfWork, context: RequestContext, hold: HoldRecord, resolved: Map<string, LedgerAccountRecord>, reason: string): Promise<HoldRecord> {
    if (!isHoldOpen(hold.state)) throw new ConflictError('HOLD_NOT_ACTIVE', 'This hold can no longer be captured.');
    const amount = hold.remainingAmount;
    const command: PostCommand = {
      type: 'dragon_coin_transfer',
      businessRef: `dragon_coin_hold_capture:${hold._id}:${String(hold.captureCount + 1)}`,
      idempotencyKey: `dragon_coin_hold_capture:${hold._id}:${String(hold.captureCount + 1)}`,
      description: reason,
      entries: [
        { account: this.#userRef(hold.ownerId), amount: -amount },
        { account: this.captureDestinationRef(hold.purpose), amount }
      ],
      metadata: { holdId: hold._id }
    };
    const posted = await this.#ledger.writeWithin(uow, context, command, resolved);
    await this.#ledger.releaseHeld(uow, hold.ledgerAccountId, amount);
    const now = utcNow();
    const updated = await this.#holds(uow.db).updateOne(
      { _id: hold._id, version: hold.version, state: { $in: ['active', 'partially_captured'] } },
      { $set: { capturedAmount: hold.capturedAmount + amount, remainingAmount: 0, state: 'captured', updatedAt: now, terminalAt: now }, $inc: { version: 1, captureCount: 1 }, $push: { captureTransactionIds: posted.transaction._id } },
      { session: uow.session }
    );
    if (updated.matchedCount === 0) throw new ConflictError('STALE_HOLD_VERSION', 'The hold changed while capturing. Retry.');
    uow.audit({ action: 'hold.captured', resourceType: 'dragon_coin_hold', resourceId: hold._id, after: { amount, state: 'captured', ledgerTransactionId: posted.transaction._id }, reason });
    return { ...hold, capturedAmount: hold.capturedAmount + amount, remainingAmount: 0, state: 'captured', captureCount: hold.captureCount + 1, captureTransactionIds: [...hold.captureTransactionIds, posted.transaction._id], version: hold.version + 1, updatedAt: now, terminalAt: now };
  }

  /** Fully releases a hold's remaining reservation inside the caller's transaction (idempotent once terminal). */
  async releaseFullWithin(uow: UnitOfWork, hold: HoldRecord, reason: string): Promise<HoldRecord> {
    if (!isHoldOpen(hold.state)) return hold;
    const amount = hold.remainingAmount;
    await this.#ledger.releaseHeld(uow, hold.ledgerAccountId, amount);
    const now = utcNow();
    const updated = await this.#holds(uow.db).updateOne(
      { _id: hold._id, version: hold.version },
      { $set: { releasedAmount: hold.releasedAmount + amount, remainingAmount: 0, state: 'released', updatedAt: now, terminalAt: now }, $inc: { version: 1 } },
      { session: uow.session }
    );
    if (updated.matchedCount === 0) throw new ConflictError('STALE_HOLD_VERSION', 'The hold changed while releasing. Retry.');
    uow.audit({ action: 'hold.released', resourceType: 'dragon_coin_hold', resourceId: hold._id, after: { amount, state: 'released' }, reason });
    return { ...hold, releasedAmount: hold.releasedAmount + amount, remainingAmount: 0, state: 'released', version: hold.version + 1, updatedAt: now, terminalAt: now };
  }

  async getHoldById(holdId: EntityId): Promise<HoldRecord | null> {
    return this.#holds().findOne({ _id: holdId });
  }
}
