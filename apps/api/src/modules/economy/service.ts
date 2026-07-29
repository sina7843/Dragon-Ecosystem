import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit } from '../../shared/pagination.ts';
import { LEDGER_COLLECTIONS, type LedgerService } from '../ledger/index.ts';
import { ECONOMY_COLLECTIONS } from './collections.ts';
import { claimTransferWindow, releaseTransferWindow } from './window.ts';
import {
  decideTransfer,
  DEFAULT_ECONOMY_LIMITS,
  type CoinTransferRecord,
  type EconomyLimits,
  type RewardGrantRecord,
  type RewardRuleRecord,
  type RewardSource
} from './state.ts';

/**
 * Dragon Coin rewards, transfers, and their controls (REWARD-002..008).
 *
 * Invariants:
 * - Every movement is a balanced ledger post. This module holds no balance.
 * - A transfer debits and credits atomically or not at all (REWARD-005): both legs are
 *   one journal inside one transaction, so there is no window where coin exists nowhere.
 * - The same idempotency key never moves value twice.
 * - Limits, windows, and the review threshold are configuration; the behaviour they drive
 *   is fixed (REWARD-007, DEC-049).
 * - Nothing here converts Dragon Coin to money. There is no cash-out path to disable
 *   because none was built (REWARD-006, DEC-024).
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

const NOTE_MAX = 200;

/** Identity lookups the economy module needs; it never reads identity's collections. */
export interface EconomyDirectory {
  /** Resolves a public username to an account id, or null when it is private or unknown. */
  resolveRecipient(username: string): Promise<EntityId | null>;
}

export class EconomyService {
  readonly #database: Database;
  readonly #limits: EconomyLimits;
  readonly #ledger: LedgerService;
  readonly #directory: EconomyDirectory;

  constructor(database: Database, limits: EconomyLimits, ledger: LedgerService, directory: EconomyDirectory) {
    this.#database = database;
    this.#limits = limits;
    this.#ledger = ledger;
    this.#directory = directory;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #transfers(db: Db = this.#db) {
    return db.collection<CoinTransferRecord>(ECONOMY_COLLECTIONS.transfers);
  }
  #rules(db: Db = this.#db) {
    return db.collection<RewardRuleRecord>(ECONOMY_COLLECTIONS.rewardRules);
  }
  #grants(db: Db = this.#db) {
    return db.collection<RewardGrantRecord>(ECONOMY_COLLECTIONS.rewardGrants);
  }

  /**
   * What the economy allows today.
   *
   * `cashRedemption` and `orderBookTrading` are reported as permanently unavailable
   * rather than as flags: DEC-024 forbids redemption outright and DEC-023 defines trading
   * as direct transfer, so neither is a decision waiting to be made.
   */
  configView(): {
    limits: EconomyLimits;
    cashRedemption: 'never';
    orderBookTrading: 'never';
    peerCommerce: 'gated';
    internalTomanWallet: 'disabled';
  } {
    return {
      limits: this.#limits,
      cashRedemption: 'never',
      orderBookTrading: 'never',
      // OD-030 has not settled what a user-to-user purchase means, so buying goods from
      // another user is absent. Plain coin transfer is separately approved (DEC-022/023).
      peerCommerce: 'gated',
      // DEC-050: no general internal Toman wallet exists in any approved scope.
      internalTomanWallet: 'disabled'
    };
  }

  // --- Transfers (REWARD-004, REWARD-005, REWARD-007) ---

  /**
   * Transfers Dragon Coin from one account to another.
   *
   * The order is deliberate: resolve the recipient, apply the limits, then post. A
   * transfer over the review threshold is recorded as `manual_review` and **moves no
   * value** — holding the record without holding the coin would be the worst of both,
   * since the sender could spend it while the review was pending.
   */
  async transfer(
    context: RequestContext,
    senderId: EntityId,
    input: { recipientUsername: string; amount: number; note?: string; idempotencyKey: string }
  ): Promise<CoinTransferRecord> {
    const existing = await this.#transfers().findOne({ senderId, idempotencyKey: input.idempotencyKey });
    if (existing !== null) return existing; // the same key never moves value twice

    const recipientId = await this.#directory.resolveRecipient(input.recipientUsername);
    if (recipientId === null) throw new NotFoundError('Unknown recipient.');

    // The shape checks (self-transfer, amount validity, per-transfer cap) are pure and
    // cheap, so they run first and claim no window budget.
    const shape = decideTransfer(this.#limits, { amount: input.amount, senderId, recipientId }, { count: 0, amount: 0 });
    if (shape.outcome === 'reject') {
      throw new ValidationError(shape.message, [{ field: 'amount', code: shape.code, message: shape.message }]);
    }

    // The rolling window is *claimed*, not read: two concurrent transfers that each read
    // the same pre-race totals would both conclude they fit, which is not a limit.
    const claim = await claimTransferWindow(this.#db, senderId, input.amount, this.#limits);
    if (claim !== 'claimed') {
      const code = claim === 'count_exceeded' ? 'TRANSFER_COUNT_LIMIT' : 'TRANSFER_WINDOW_LIMIT';
      const message = claim === 'count_exceeded' ? 'You have made too many transfers recently.' : 'That would pass the amount you can transfer in this period.';
      throw new ValidationError(message, [{ field: 'amount', code, message }]);
    }

    const decision = shape;

    const now = utcNow();
    const record: CoinTransferRecord = {
      _id: newId(),
      senderId,
      recipientId,
      amount: input.amount,
      note: (input.note ?? '').trim().slice(0, NOTE_MAX),
      state: decision.outcome === 'review' ? 'manual_review' : 'completed',
      ledgerTransactionId: null,
      reviewReason: decision.outcome === 'review' ? decision.reason : null,
      reviewedBy: null,
      reviewedAt: null,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now
    };

    if (decision.outcome === 'review') {
      try {
        await runUnitOfWork(this.#database, context, async (uow) => {
          await this.#transfers(uow.db).insertOne(record, { session: uow.session });
          uow.audit({ action: 'economy.transfer_held', resourceType: 'coin_transfer', resourceId: record._id, after: { amount: record.amount, recipientId }, reason: record.reviewReason ?? 'Held for review.' });
        });
      } catch (error) {
        if (isDuplicateKey(error)) {
          const raced = await this.#transfers().findOne({ senderId, idempotencyKey: input.idempotencyKey });
          // A replay created nothing, so the budget it claimed is handed back.
          if (raced !== null) {
            await releaseTransferWindow(this.#db, senderId, input.amount);
            return raced;
          }
        }
        await releaseTransferWindow(this.#db, senderId, input.amount);
        throw error;
      }
      return record;
    }

    try {
      return await this.#postTransfer(context, record);
    } catch (error) {
      // The ledger refused (most often an insufficient balance), so nothing was recorded
      // and the window budget is handed back rather than silently consumed.
      await releaseTransferWindow(this.#db, senderId, input.amount);
      throw error;
    }
  }

  /**
   * Posts the two legs and records the transfer.
   *
   * Both legs are one journal, so the debit and the credit commit together — there is no
   * intermediate state in which the sender has paid and the recipient has not been paid.
   */
  async #postTransfer(context: RequestContext, record: CoinTransferRecord): Promise<CoinTransferRecord> {
    const senderRef = { kind: 'user' as const, ownerId: record.senderId, accountType: 'user_dragon_coin' as const };
    const recipientRef = { kind: 'user' as const, ownerId: record.recipientId, accountType: 'user_dragon_coin' as const };
    await this.#ledger.ensureAccounts([senderRef, recipientRef]);

    // Derived from the caller's key, not from `record._id`: two concurrent requests under
    // one key generate different record ids, so keying the ledger on the record id would
    // let both post and move the value twice while the API still reported one transfer.
    const ledgerRef = `coin_transfer:${record.senderId}:${record.idempotencyKey}`;
    const posted = await this.#ledger.post(context, {
      type: 'dragon_coin_transfer',
      businessRef: ledgerRef,
      idempotencyKey: ledgerRef,
      description: 'Dragon Coin transfer',
      entries: [
        { account: senderRef, amount: -record.amount },
        { account: recipientRef, amount: record.amount }
      ]
    });

    const now = utcNow();
    const settled: CoinTransferRecord = { ...record, state: 'completed', ledgerTransactionId: posted.transaction._id, updatedAt: now };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#transfers(uow.db).replaceOne({ _id: record._id }, settled, { session: uow.session, upsert: true });
        uow.audit({ action: 'economy.transfer_completed', resourceType: 'coin_transfer', resourceId: record._id, after: { amount: record.amount, recipientId: record.recipientId, ledgerTransactionId: posted.transaction._id }, reason: 'Dragon Coin transfer.' });
        uow.publish({ eventName: 'economy.transfer_completed', eventVersion: 1, aggregateId: record._id, payload: { senderId: record.senderId, recipientId: record.recipientId, amount: record.amount } });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        const raced = await this.#transfers().findOne({ senderId: record.senderId, idempotencyKey: record.idempotencyKey });
        if (raced !== null) return raced;
      }
      throw error;
    }
    return settled;
  }

  /** Releases a held transfer after review, moving the value for the first time. */
  async approveTransfer(context: RequestContext, transferId: EntityId, reviewerId: EntityId, reason: string): Promise<CoinTransferRecord> {
    if (reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Say why the transfer was released.' }]);
    const record = await this.#transfers().findOne({ _id: transferId });
    if (record === null) throw new NotFoundError('Unknown transfer.');
    if (record.state !== 'manual_review') throw new ConflictError('TRANSFER_NOT_IN_REVIEW', 'That transfer is not awaiting review.');
    if (record.senderId === reviewerId) {
      // The person who sent it cannot be the person who clears it.
      throw new ForbiddenError('A transfer cannot be reviewed by the account that sent it.');
    }
    const posted = await this.#postTransfer(context, { ...record, reviewedBy: reviewerId, reviewedAt: utcNow(), reviewReason: reason });
    return posted;
  }

  /** Rejects a held transfer. No value ever moved, so nothing has to be undone. */
  async rejectTransfer(context: RequestContext, transferId: EntityId, reviewerId: EntityId, reason: string): Promise<CoinTransferRecord> {
    if (reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Say why the transfer was rejected.' }]);
    const record = await this.#transfers().findOne({ _id: transferId });
    if (record === null) throw new NotFoundError('Unknown transfer.');
    if (record.state !== 'manual_review') throw new ConflictError('TRANSFER_NOT_IN_REVIEW', 'That transfer is not awaiting review.');
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#transfers(uow.db).updateOne(
        { _id: transferId, state: 'manual_review' },
        { $set: { state: 'rejected', reviewedBy: reviewerId, reviewedAt: now, reviewReason: reason, updatedAt: now } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('TRANSFER_STALE', 'That transfer changed. Reload and retry.');
      uow.audit({ action: 'economy.transfer_rejected', resourceType: 'coin_transfer', resourceId: transferId, before: { state: 'manual_review' }, after: { state: 'rejected' }, reason });
      return { ...record, state: 'rejected' as const, reviewedBy: reviewerId, reviewedAt: now, reviewReason: reason, updatedAt: now };
    });
  }

  async listMyTransfers(accountId: EntityId, limit = 50): Promise<CoinTransferRecord[]> {
    return this.#transfers()
      .find({ $or: [{ senderId: accountId }, { recipientId: accountId }] })
      .sort({ createdAt: -1 })
      .limit(clampLimit(limit))
      .toArray();
  }

  async listTransfersForReview(limit = 50): Promise<CoinTransferRecord[]> {
    return this.#transfers().find({ state: 'manual_review' }).sort({ createdAt: 1 }).limit(clampLimit(limit)).toArray();
  }

  // --- Reward rules and grants (REWARD-002, REWARD-003) ---

  async createRule(
    context: RequestContext,
    actorId: EntityId,
    input: { code: string; source: RewardSource; amount: number; description: string; maxGrants?: number }
  ): Promise<RewardRuleRecord> {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9_]{3,32}$/.test(code)) {
      throw new ValidationError('That rule code is not valid.', [{ field: 'code', code: 'INVALID_CODE', message: 'Use 3-32 uppercase letters, digits, or underscores.' }]);
    }
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new ValidationError('That reward amount is not valid.', [{ field: 'amount', code: 'INVALID_AMOUNT', message: 'Use a whole number of Dragon Coin greater than zero.' }]);
    }
    if (input.description.trim() === '') {
      throw new ValidationError('A description is required.', [{ field: 'description', code: 'REQUIRED', message: 'Say what this reward is for.' }]);
    }
    const now = utcNow();
    const record: RewardRuleRecord = {
      _id: newId(),
      code,
      source: input.source,
      amount: input.amount,
      description: input.description.trim().slice(0, 300),
      state: 'active',
      maxGrants: input.maxGrants ?? null,
      grantCount: 0,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#rules(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'economy.reward_rule_created', resourceType: 'reward_rule', resourceId: record._id, after: { code, amount: record.amount, source: record.source }, reason: record.description });
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictError('REWARD_CODE_TAKEN', 'That reward code already exists.');
      throw error;
    }
    return record;
  }

  /**
   * Issues Dragon Coin to an account under a rule.
   *
   * REWARD-003 requires permission and a reason; the route supplies the first and this
   * requires the second. The grant is unique per (rule, account), so a replayed request
   * cannot issue twice — and because issuance creates coin, that uniqueness is the
   * control that matters most here.
   */
  async grantReward(context: RequestContext, actorId: EntityId, ruleId: EntityId, accountId: EntityId, reason: string): Promise<RewardGrantRecord> {
    if (reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Say why this reward was granted.' }]);
    const rule = await this.#rules().findOne({ _id: ruleId });
    if (rule === null) throw new NotFoundError('Unknown reward rule.');
    if (rule.state !== 'active') throw new ConflictError('REWARD_RULE_DISABLED', 'That reward rule is not active.');
    if (rule.maxGrants !== null && rule.grantCount >= rule.maxGrants) {
      throw new ConflictError('REWARD_RULE_EXHAUSTED', 'That reward rule has reached its grant limit.');
    }
    const already = await this.#grants().findOne({ ruleId, accountId });
    if (already !== null) return already;

    const userRef = { kind: 'user' as const, ownerId: accountId, accountType: 'user_dragon_coin' as const };
    const treasuryRef = { kind: 'system' as const, accountType: 'platform_dragon_coin_treasury' as const };
    await this.#ledger.ensureAccounts([userRef, treasuryRef]);
    const posted = await this.#ledger.post(context, {
      type: 'dragon_coin_issue',
      businessRef: `reward_grant:${ruleId}:${accountId}`,
      idempotencyKey: `reward_grant:${ruleId}:${accountId}`,
      description: `Reward ${rule.code}`,
      entries: [
        { account: userRef, amount: rule.amount },
        { account: treasuryRef, amount: -rule.amount }
      ]
    });

    const record: RewardGrantRecord = {
      _id: newId(),
      ruleId,
      ruleCode: rule.code,
      source: rule.source,
      accountId,
      amount: rule.amount,
      reason: reason.trim().slice(0, 500),
      grantedBy: actorId,
      ledgerTransactionId: posted.transaction._id,
      createdAt: utcNow()
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#grants(uow.db).insertOne(record, { session: uow.session });
        await this.#rules(uow.db).updateOne({ _id: ruleId }, { $inc: { grantCount: 1 }, $set: { updatedAt: utcNow() } }, { session: uow.session });
        // AUDIT: links the acting operator to the ledger transaction (REWARD-003).
        uow.audit({ action: 'economy.reward_granted', resourceType: 'reward_grant', resourceId: record._id, after: { ruleCode: rule.code, accountId, amount: rule.amount, ledgerTransactionId: posted.transaction._id }, reason: record.reason });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        const raced = await this.#grants().findOne({ ruleId, accountId });
        if (raced !== null) return raced;
      }
      throw error;
    }
    return record;
  }

  async listRules(limit = 100): Promise<RewardRuleRecord[]> {
    return this.#rules().find({}).sort({ createdAt: -1 }).limit(clampLimit(limit)).toArray();
  }

  async listGrants(limit = 100): Promise<RewardGrantRecord[]> {
    return this.#grants().find({}).sort({ createdAt: -1 }).limit(clampLimit(limit)).toArray();
  }

  /**
   * Reconciles issued rewards and transfers against the ledger (ANALYTICS-006).
   *
   * Transfers are checked to sum to zero across both legs, which is the property that
   * makes them transfers rather than issuance: coin moves, none is created.
   */
  async reconcile(): Promise<{
    grants: { count: number; amount: number; missingTransactions: number };
    transfers: { completed: number; amount: number; heldForReview: number; rejected: number; missingTransactions: number };
    differences: Array<{ kind: string; detail: string }>;
  }> {
    const [grants, transfers] = await Promise.all([
      this.#grants().find({}).limit(2000).toArray(),
      this.#transfers().find({}).limit(2000).toArray()
    ]);
    const completed = transfers.filter((t) => t.state === 'completed');
    const differences: Array<{ kind: string; detail: string }> = [];

    const grantMissing = grants.filter((g) => g.ledgerTransactionId === null || g.ledgerTransactionId === '').length;
    if (grantMissing > 0) differences.push({ kind: 'grant_without_ledger', detail: `${String(grantMissing)} reward grant(s) have no ledger transaction.` });

    const transferMissing = completed.filter((t) => t.ledgerTransactionId === null).length;
    if (transferMissing > 0) differences.push({ kind: 'transfer_without_ledger', detail: `${String(transferMissing)} completed transfer(s) have no ledger transaction.` });

    // A held or rejected transfer must never carry a ledger transaction: that would mean
    // value moved for a transfer nobody released.
    const movedWhileHeld = transfers.filter((t) => t.state !== 'completed' && t.ledgerTransactionId !== null).length;
    if (movedWhileHeld > 0) differences.push({ kind: 'value_moved_without_release', detail: `${String(movedWhileHeld)} unreleased transfer(s) carry a ledger transaction.` });

    // The other direction, and the one that matters most: a transfer posting the ledger
    // recorded but this module did not. Only checking "record without transaction" would
    // miss value that moved for a transfer nobody can point at.
    const expectedRefs = new Set(transfers.map((t) => `coin_transfer:${t.senderId}:${t.idempotencyKey}`));
    const postedRefs = await this.#db
      .collection<{ businessRef: string }>(LEDGER_COLLECTIONS.transactions)
      .find({ businessRef: { $regex: '^coin_transfer:' } }, { projection: { businessRef: 1 } })
      .limit(5000)
      .toArray();
    const orphans = postedRefs.filter((row) => !expectedRefs.has(row.businessRef)).length;
    if (orphans > 0) differences.push({ kind: 'ledger_transaction_without_transfer', detail: `${String(orphans)} ledger transfer posting(s) have no transfer record.` });

    return {
      grants: { count: grants.length, amount: grants.reduce((total, g) => total + g.amount, 0), missingTransactions: grantMissing },
      transfers: {
        completed: completed.length,
        amount: completed.reduce((total, t) => total + t.amount, 0),
        heldForReview: transfers.filter((t) => t.state === 'manual_review').length,
        rejected: transfers.filter((t) => t.state === 'rejected').length,
        missingTransactions: transferMissing
      },
      differences
    };
  }
}

export { DEFAULT_ECONOMY_LIMITS };
