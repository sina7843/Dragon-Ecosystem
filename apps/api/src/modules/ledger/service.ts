import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork, type UnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { withIdempotency } from '../../shared/db/idempotency.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import type { AssetCode } from '../../shared/money.ts';
import { ACCOUNT_TYPES, accountIdentityKey, type AccountRef } from './accounts.ts';
import { LEDGER_COLLECTIONS } from './collections.ts';
import { buildJournal, type Journal, type PostCommand } from './journal.ts';
import type { LedgerAccountRecord, LedgerEntryRecord, LedgerTransactionRecord, PostedTransaction } from './state.ts';

/**
 * Immutable double-entry ledger (DRAGON-11a).
 *
 * A narrow internal service: business modules call typed operations (post,
 * compensate) rather than assemble arbitrary entry arrays from request payloads.
 * Every posting is balanced (signed amounts sum to zero), single-asset, idempotent
 * per (type, businessRef) key, and committed inside one transaction together with
 * the balance projection, audit row, and outbox event. Posted transactions and
 * entries are never updated or deleted; corrections are compensating transactions.
 *
 * Database authorities (not read-before-write): a unique account identity index
 * (one account per role/owner/asset/scale), a unique business-reference index and
 * a unique reversal index (duplicate-posting / duplicate-compensation guards), a
 * unique (transactionId, lineNumber) index, and an atomic balance condition that
 * makes exactly one concurrent spender consume the final available balance.
 */

const DUPLICATE_KEY = 11000;
function duplicateKeyPattern(error: unknown): Record<string, unknown> | null {
  if (typeof error !== 'object' || error === null || (error as { code?: number }).code !== DUPLICATE_KEY) return null;
  return ((error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {}) as Record<string, unknown>;
}

export interface BalanceView {
  accountId: EntityId;
  accountType: LedgerAccountRecord['accountType'];
  assetCode: AssetCode;
  scale: number;
  balance: number;
  heldAmount: number;
  availableBalance: number;
  balanceVersion: number;
  entryCount: number;
  allowsNegative: boolean;
  status: LedgerAccountRecord['status'];
}

export interface CompensateCommand {
  transactionId: EntityId;
  businessRef: string;
  idempotencyKey: string;
  reason: string;
  effectiveAt?: string;
}

export class LedgerService {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #accounts(db: Db = this.#db) {
    return db.collection<LedgerAccountRecord>(LEDGER_COLLECTIONS.accounts);
  }
  #transactions(db: Db = this.#db) {
    return db.collection<LedgerTransactionRecord>(LEDGER_COLLECTIONS.transactions);
  }
  #entries(db: Db = this.#db) {
    return db.collection<LedgerEntryRecord>(LEDGER_COLLECTIONS.entries);
  }

  // --- Account resolution ---

  #assertRefKind(ref: AccountRef): void {
    const policy = ACCOUNT_TYPES[ref.accountType];
    if (ref.kind === 'user' && (policy.ownerKind !== 'user' || ref.ownerId.trim() === '')) {
      throw new ValidationError('The ledger account reference is not valid.', [{ field: 'account', code: 'INVALID_ACCOUNT_RELATIONSHIP', message: 'This account type is not a user-owned account.' }]);
    }
    if (ref.kind === 'system' && policy.ownerKind !== 'system') {
      throw new ValidationError('The ledger account reference is not valid.', [{ field: 'account', code: 'INVALID_ACCOUNT_RELATIONSHIP', message: 'This account type is not a system account.' }]);
    }
  }

  /**
   * Resolves a ref to its canonical account, creating it on first use. The unique
   * identity index makes concurrent creation collapse to one record. Creating the
   * (zero-balance) account outside the posting transaction is harmless — it carries
   * no financial effect until an entry references it.
   */
  async #ensureAccount(ref: AccountRef): Promise<LedgerAccountRecord> {
    const identityKey = accountIdentityKey(ref);
    const found = await this.#accounts().findOne({ identityKey });
    if (found !== null) return found;
    const policy = ACCOUNT_TYPES[ref.accountType];
    const now = utcNow();
    const account: LedgerAccountRecord = {
      _id: newId(),
      accountType: ref.accountType,
      ownerKind: policy.ownerKind,
      ownerId: ref.kind === 'user' ? ref.ownerId : null,
      systemKey: ref.kind === 'system' ? policy.systemKey ?? ref.accountType : null,
      identityKey,
      assetCode: policy.assetCode,
      scale: policy.scale,
      allowsNegative: policy.allowsNegative,
      status: 'active',
      balance: 0,
      heldAmount: 0,
      balanceVersion: 0,
      entryCount: 0,
      createdAt: now,
      updatedAt: now
    };
    try {
      await this.#accounts().insertOne(account);
      return account;
    } catch (error) {
      if (duplicateKeyPattern(error) !== null) {
        const raced = await this.#accounts().findOne({ identityKey });
        if (raced !== null) return raced;
      }
      throw error;
    }
  }

  /** Read-only account lookup by ref; never creates. */
  async getAccount(ref: AccountRef): Promise<LedgerAccountRecord | null> {
    return this.#accounts().findOne({ identityKey: accountIdentityKey(ref) });
  }

  // --- Posting ---

  /** Posts a balanced transaction; idempotent per (type, businessRef, key). */
  async post(context: RequestContext, command: PostCommand): Promise<PostedTransaction> {
    // The 'compensation' type is reserved for compensate(), whose reversal legs are
    // built from a stored transaction. Its 'any' account policy must never be
    // reachable from a caller-supplied entry array, which would bypass the
    // per-type account-relationship rules.
    if (command.type === 'compensation') {
      throw new ValidationError('The ledger transaction is not valid.', [{ field: 'type', code: 'UNSUPPORTED_TRANSACTION_TYPE', message: 'Use compensate() to reverse a transaction.' }]);
    }
    return this.#resolveAndPost(context, command, undefined, null);
  }

  async #resolveAndPost(context: RequestContext, command: PostCommand, expectedAsset: AssetCode | undefined, reversalOf: EntityId | null): Promise<PostedTransaction> {
    const journal = buildJournal(command, expectedAsset);
    const scope = `ledger:${command.type}:${command.businessRef}`;
    try {
      // Account resolution runs inside the idempotency gate so an exact replay short-
      // circuits to the stored result even if a referenced account was later disabled.
      const outcome = await withIdempotency(this.#db, { scope, key: command.idempotencyKey, request: { hash: journal.canonicalHash } }, async () => {
        const resolved = await this.#resolveAccounts(journal);
        return this.#postJournal(context, command, journal, resolved, reversalOf);
      });
      return outcome.result;
    } catch (error) {
      const keyPattern = duplicateKeyPattern(error);
      if (keyPattern !== null) {
        if ('reversalOf' in keyPattern) throw new ConflictError('DUPLICATE_COMPENSATION', 'This transaction has already been compensated.');
        throw new ConflictError('DUPLICATE_BUSINESS_REFERENCE', 'A ledger transaction already exists for this business reference.');
      }
      throw error;
    }
  }

  /** Resolves every leg's account (creating on first use) and validates it against the journal. */
  async #resolveAccounts(journal: Journal): Promise<Map<string, LedgerAccountRecord>> {
    const resolved = new Map<string, LedgerAccountRecord>();
    for (const leg of journal.legs) {
      this.#assertRefKind(leg.account);
      const account = await this.#ensureAccount(leg.account);
      if (account.status !== 'active') throw new ConflictError('ACCOUNT_DISABLED', 'A ledger account for this transaction is disabled.');
      if (account.assetCode !== journal.assetCode || account.scale !== journal.scale) {
        throw new ValidationError('The ledger transaction is not valid.', [{ field: 'account', code: 'MIXED_ASSET', message: 'An account asset or scale does not match the transaction.' }]);
      }
      resolved.set(leg.identityKey, account);
    }
    return resolved;
  }

  async #postJournal(context: RequestContext, command: PostCommand, journal: Journal, resolved: Map<string, LedgerAccountRecord>, reversalOf: EntityId | null): Promise<PostedTransaction> {
    return runUnitOfWork(this.#database, context, async (uow) => this.#writeJournal(uow, context, command, journal, resolved, reversalOf));
  }

  /** Writes one balanced journal (header, entries, balances, audit, outbox) inside a unit of work. */
  async #writeJournal(uow: UnitOfWork, context: RequestContext, command: PostCommand, journal: Journal, resolved: Map<string, LedgerAccountRecord>, reversalOf: EntityId | null): Promise<PostedTransaction> {
    {
      const now = utcNow();
      const transactionId = newId();
      const transaction: LedgerTransactionRecord = {
        _id: transactionId,
        type: command.type,
        assetCode: journal.assetCode,
        scale: journal.scale,
        businessRef: command.businessRef,
        idempotencyScope: `ledger:${command.type}:${command.businessRef}`,
        idempotencyKey: command.idempotencyKey,
        reversalOf,
        actor: context.actor,
        correlationId: context.correlationId,
        description: command.description,
        metadata: command.metadata ?? {},
        status: 'posted',
        effectiveAt: command.effectiveAt ?? now,
        recordedAt: now,
        entryCount: journal.legs.length
      };
      // Insert header (unique businessRef + reversal guards) and all lines atomically.
      await this.#transactions(uow.db).insertOne(transaction, { session: uow.session });
      const entries: LedgerEntryRecord[] = journal.legs.map((leg) => ({
        _id: newId(),
        transactionId,
        accountId: (resolved.get(leg.identityKey) as LedgerAccountRecord)._id,
        amount: leg.amount,
        assetCode: journal.assetCode,
        scale: journal.scale,
        lineNumber: leg.lineNumber,
        reference: leg.reference,
        recordedAt: now
      }));
      await this.#entries(uow.db).insertMany(entries, { session: uow.session });

      // Maintain the balance projection with an atomic overspend guard. A spendable
      // account only moves if it stays at or above zero, so exactly one concurrent
      // spender can consume the final available balance (the loser retries on write
      // conflict and then fails INSUFFICIENT_FUNDS); no read-before-write.
      for (const leg of journal.legs) {
        const account = resolved.get(leg.identityKey) as LedgerAccountRecord;
        const guardsSpend = !account.allowsNegative && leg.amount < 0;
        const filter = guardsSpend
          ? { _id: account._id, status: 'active' as const, balance: { $gte: -leg.amount } }
          : { _id: account._id, status: 'active' as const };
        const updated = await this.#accounts(uow.db).updateOne(filter, { $inc: { balance: leg.amount, entryCount: 1, balanceVersion: 1 }, $set: { updatedAt: now } }, { session: uow.session });
        if (updated.matchedCount === 0) {
          const fresh = await this.#accounts(uow.db).findOne({ _id: account._id }, { session: uow.session });
          if (fresh === null || fresh.status !== 'active') throw new ConflictError('ACCOUNT_DISABLED', 'A ledger account for this transaction is disabled.');
          throw new ConflictError('INSUFFICIENT_FUNDS', 'The account has insufficient balance for this transaction.');
        }
      }

      uow.audit({ action: 'ledger.transaction_posted', resourceType: 'ledger_transaction', resourceId: transactionId, after: { type: command.type, assetCode: journal.assetCode, entryCount: journal.legs.length, businessRef: command.businessRef, reversalOf } });
      uow.publish({ eventName: 'ledger.transaction_posted', eventVersion: 1, aggregateId: transactionId, payload: { type: command.type, assetCode: journal.assetCode, businessRef: command.businessRef, reversalOf } });
      return { transaction, entries };
    }
  }

  // --- Posting within a caller's transaction (DRAGON-11b) ---

  /**
   * Resolves (creating on first use) the accounts for a set of refs, outside any
   * transaction. A caller that owns a transaction resolves accounts first, then
   * posts inside its own unit of work so the ledger effect commits atomically with
   * the caller's domain transition.
   */
  async ensureAccounts(refs: readonly AccountRef[]): Promise<Map<string, LedgerAccountRecord>> {
    const resolved = new Map<string, LedgerAccountRecord>();
    for (const ref of refs) {
      this.#assertRefKind(ref);
      resolved.set(accountIdentityKey(ref), await this.#ensureAccount(ref));
    }
    return resolved;
  }

  /**
   * Posts one balanced journal inside the caller's unit of work using pre-resolved
   * accounts. Exactly-once is the caller's responsibility via the unique businessRef
   * index (a duplicate insert aborts the whole transaction). The 'compensation' type
   * is permitted here only because the caller builds its legs from a stored
   * transaction via buildCompensation(); an arbitrary compensation is still rejected
   * by the account-relationship policy unless every leg is allowed.
   */
  async writeWithin(uow: UnitOfWork, context: RequestContext, command: PostCommand, resolved: Map<string, LedgerAccountRecord>, options: { expectedAsset?: AssetCode; reversalOf?: EntityId | null } = {}): Promise<PostedTransaction> {
    const journal = buildJournal(command, options.expectedAsset);
    for (const leg of journal.legs) {
      const account = resolved.get(leg.identityKey);
      if (account === undefined) throw new ConflictError('LEDGER_CREDIT_CONFLICT', 'A ledger account was not resolved before posting.');
      if (account.status !== 'active') throw new ConflictError('ACCOUNT_DISABLED', 'A ledger account for this transaction is disabled.');
      if (account.assetCode !== journal.assetCode || account.scale !== journal.scale) {
        throw new ValidationError('The ledger transaction is not valid.', [{ field: 'account', code: 'MIXED_ASSET', message: 'An account asset or scale does not match the transaction.' }]);
      }
    }
    return this.#writeJournal(uow, context, command, journal, resolved, options.reversalOf ?? null);
  }

  /**
   * Builds the reversing command for a posted transaction (negated legs against the
   * same accounts) plus the account refs to resolve, so a caller can commit the
   * compensation inside its own transaction. Never rewrites the original.
   */
  async buildCompensation(transactionId: EntityId, options: { businessRef: string; idempotencyKey: string; reason: string; effectiveAt?: string }): Promise<{ command: PostCommand; expectedAsset: AssetCode; reversalOf: EntityId; refs: AccountRef[] }> {
    if (options.reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    const original = await this.#transactions().findOne({ _id: transactionId });
    if (original === null) throw new NotFoundError('Unknown ledger transaction.');
    if (original.reversalOf !== null) throw new ConflictError('CANNOT_COMPENSATE_COMPENSATION', 'A compensating transaction cannot itself be compensated.');
    const originalEntries = await this.#entries().find({ transactionId }).sort({ lineNumber: 1 }).toArray();
    const refs: AccountRef[] = [];
    const entries = await Promise.all(
      originalEntries.map(async (entry) => {
        const account = await this.#accounts().findOne({ _id: entry.accountId });
        if (account === null) throw new ConflictError('RECONCILIATION_MISMATCH', 'A referenced ledger account is missing.');
        const ref: AccountRef = account.ownerKind === 'system' ? { kind: 'system', accountType: account.accountType } : { kind: 'user', ownerId: account.ownerId as string, accountType: account.accountType };
        refs.push(ref);
        return { account: ref, amount: -entry.amount, reference: { reversedEntry: entry._id } };
      })
    );
    const command: PostCommand = {
      type: 'compensation',
      businessRef: options.businessRef,
      idempotencyKey: options.idempotencyKey,
      description: options.reason,
      entries,
      metadata: { reversalOf: transactionId },
      ...(options.effectiveAt === undefined ? {} : { effectiveAt: options.effectiveAt })
    };
    return { command, expectedAsset: original.assetCode, reversalOf: transactionId, refs };
  }

  /** Maps a Mongo duplicate-key error from a caller's transaction to a stable ledger conflict. */
  mapDuplicateKey(error: unknown): ConflictError | null {
    const keyPattern = duplicateKeyPattern(error);
    if (keyPattern === null) return null;
    if ('reversalOf' in keyPattern) return new ConflictError('DUPLICATE_COMPENSATION', 'This transaction has already been compensated.');
    if ('businessRef' in keyPattern) return new ConflictError('DUPLICATE_BUSINESS_REFERENCE', 'A ledger transaction already exists for this business reference.');
    return null;
  }

  /**
   * Reverses a posted transaction with a compensating one (never rewrites history).
   * Each original line is mirrored with a negated amount against the same account;
   * the unique reversal index allows at most one compensation per transaction.
   */
  async compensate(context: RequestContext, command: CompensateCommand): Promise<PostedTransaction> {
    if (command.reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    const original = await this.#transactions().findOne({ _id: command.transactionId });
    if (original === null) throw new NotFoundError('Unknown ledger transaction.');
    if (original.reversalOf !== null) throw new ConflictError('CANNOT_COMPENSATE_COMPENSATION', 'A compensating transaction cannot itself be compensated.');

    const originalEntries = await this.#entries().find({ transactionId: command.transactionId }).sort({ lineNumber: 1 }).toArray();
    const entries = await Promise.all(
      originalEntries.map(async (entry) => {
        const account = await this.#accounts().findOne({ _id: entry.accountId });
        if (account === null) throw new ConflictError('RECONCILIATION_MISMATCH', 'A referenced ledger account is missing.');
        const ref: AccountRef = account.ownerKind === 'system' ? { kind: 'system', accountType: account.accountType } : { kind: 'user', ownerId: account.ownerId as string, accountType: account.accountType };
        return { account: ref, amount: -entry.amount, reference: { reversedEntry: entry._id } };
      })
    );

    const compensation: PostCommand = {
      type: 'compensation',
      businessRef: command.businessRef,
      idempotencyKey: command.idempotencyKey,
      description: command.reason,
      entries,
      metadata: { reversalOf: command.transactionId },
      ...(command.effectiveAt === undefined ? {} : { effectiveAt: command.effectiveAt })
    };
    return this.#resolveAndPost(context, compensation, original.assetCode, command.transactionId);
  }

  // --- Reads ---

  async getBalance(accountId: EntityId): Promise<BalanceView | null> {
    const account = await this.#accounts().findOne({ _id: accountId });
    return account === null ? null : this.#toBalanceView(account);
  }

  async getBalanceByRef(ref: AccountRef): Promise<BalanceView | null> {
    const account = await this.getAccount(ref);
    return account === null ? null : this.#toBalanceView(account);
  }

  #toBalanceView(account: LedgerAccountRecord): BalanceView {
    const heldAmount = account.heldAmount ?? 0;
    return {
      accountId: account._id,
      accountType: account.accountType,
      assetCode: account.assetCode,
      scale: account.scale,
      balance: account.balance,
      heldAmount,
      availableBalance: account.balance - heldAmount,
      balanceVersion: account.balanceVersion,
      entryCount: account.entryCount,
      allowsNegative: account.allowsNegative,
      status: account.status
    };
  }

  // --- Hold reservations (DRAGON-11c) ---

  /** Ledger, held, and available balance for an account (available = balance − heldAmount). */
  async getAvailability(ref: AccountRef): Promise<{ ledgerBalance: number; heldAmount: number; availableBalance: number }> {
    const account = await this.getAccount(ref);
    const ledgerBalance = account?.balance ?? 0;
    const heldAmount = account?.heldAmount ?? 0;
    return { ledgerBalance, heldAmount, availableBalance: ledgerBalance - heldAmount };
  }

  /**
   * Atomically reserves `amount` of available balance on an account inside the
   * caller's transaction. The `$expr` guard compares two fields (balance − held ≥
   * amount) in one conditional update, so concurrent reservations competing for the
   * final available balance yield exactly one winner (the loser retries on write
   * conflict, then fails the guard). Returns false when available balance is
   * insufficient. Never lets total holds exceed the ledger balance.
   */
  async reserveHeld(uow: UnitOfWork, accountId: EntityId, amount: number): Promise<boolean> {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError('The hold amount is not valid.', [{ field: 'amount', code: 'UNSAFE_INTEGER', message: 'Use a positive whole amount.' }]);
    const updated = await this.#accounts(uow.db).updateOne(
      { _id: accountId, status: 'active', $expr: { $gte: [{ $subtract: ['$balance', { $ifNull: ['$heldAmount', 0] }] }, amount] } },
      { $inc: { heldAmount: amount, balanceVersion: 1 }, $set: { updatedAt: utcNow() } },
      { session: uow.session }
    );
    return updated.matchedCount === 1;
  }

  /**
   * Releases `amount` of reserved availability inside the caller's transaction
   * (release/capture/expiry). Strict atomic invariant: the update only applies when
   * the account's current heldAmount is at least `amount`, so the reservation can
   * never underflow. It never clamps or silently repairs — if the projection cannot
   * satisfy the release (a held-balance/projection inconsistency), it throws a stable
   * financial-invariant error and the caller's whole transaction rolls back.
   */
  async releaseHeld(uow: UnitOfWork, accountId: EntityId, amount: number): Promise<void> {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError('The release amount is not valid.', [{ field: 'amount', code: 'UNSAFE_INTEGER', message: 'Use a positive whole amount.' }]);
    const updated = await this.#accounts(uow.db).updateOne(
      { _id: accountId, heldAmount: { $gte: amount } },
      { $inc: { heldAmount: -amount, balanceVersion: 1 }, $set: { updatedAt: utcNow() } },
      { session: uow.session }
    );
    if (updated.matchedCount === 0) throw new ConflictError('HELD_INVARIANT_VIOLATION', 'A hold release would drive the held balance below zero; the held projection is inconsistent.');
  }

  /** Cursor-paginated, stable (recordedAt, id)-ordered entries for one account. */
  async listEntries(accountId: EntityId, query: { cursor?: string; limit?: number } = {}): Promise<Page<LedgerEntryRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { accountId };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ recordedAt: { $gt: cursor.sortValue } }, { recordedAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    }
    const rows = await this.#entries().find(filter).sort({ recordedAt: 1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.recordedAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as LedgerEntryRecord), nextCursor: page.nextCursor };
  }
}
