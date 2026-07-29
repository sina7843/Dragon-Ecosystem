import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import type { TournamentRecord } from '../tournaments/index.ts';
import type { LedgerService } from '../ledger/index.ts';
import { LEDGER_COLLECTIONS } from '../ledger/index.ts';
import { PRIZES_COLLECTIONS } from './collections.ts';
import {
  canEntitlementTransition,
  isOutstandingEntitlement,
  isSettledEntitlement,
  type DragonCoinPrizeCredit,
  type EntitlementState,
  type PrizeAllocationRecord,
  type PrizeEntitlementRecord
} from './state.ts';

/** Fields a lifecycle transition may set, alongside the state change itself. */
interface TransitionFields {
  reason: string;
  settlementEvidence?: string;
  approvedBy?: string;
  paidBy?: string;
  recipientVerifiedBy?: string;
  recipientVerifiedAt?: string;
  reversedBy?: string;
  reversalReason?: string;
  incrementRetry?: boolean;
}

/**
 * Prize allocation and cash entitlement management (DRAGON-12). Dragon Coin prizes
 * credit immediately and idempotently through the ledger; cash prizes become pending
 * entitlements settled manually by finance staff. No cash-out or Dragon Coin refund.
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export interface StandingsAccess {
  getStandings(tournamentId: string): Promise<{ status: string; calculationVersion: number; rows: Array<{ participantId: string; rank: number }> } | null>;
}
export interface RegistrationAccess {
  getById(tournamentId: string, registrationId: string): Promise<{ accountId: string } | null>;
}

export interface AllocationSummary {
  version: number;
  standingsVersion: number;
  dragonCoinCredits: number;
  cashEntitlements: number;
}

export class PrizesService {
  readonly #database: Database;
  readonly #tournaments: { getById(id: string): Promise<TournamentRecord | null> };
  readonly #standings: StandingsAccess;
  readonly #registrations: RegistrationAccess;
  readonly #ledger: LedgerService;

  constructor(database: Database, tournaments: { getById(id: string): Promise<TournamentRecord | null> }, standings: StandingsAccess, registrations: RegistrationAccess, ledger: LedgerService) {
    this.#database = database;
    this.#tournaments = tournaments;
    this.#standings = standings;
    this.#registrations = registrations;
    this.#ledger = ledger;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #allocations(db: Db = this.#db) {
    return db.collection<PrizeAllocationRecord>(PRIZES_COLLECTIONS.allocations);
  }
  #entitlements(db: Db = this.#db) {
    return db.collection<PrizeEntitlementRecord>(PRIZES_COLLECTIONS.entitlements);
  }

  // --- Allocation ---

  /**
   * Allocates prizes from the tournament's final standings. Idempotent per standings
   * version; a standings correction produces a new version that supersedes prior
   * unpaid cash entitlements. Dragon Coin prizes are credited once per participant/rank.
   */
  async allocate(context: RequestContext, tournamentId: EntityId): Promise<AllocationSummary> {
    const tournament = await this.#tournaments.getById(tournamentId);
    if (tournament === null) throw new NotFoundError('Unknown tournament.');
    const standings = await this.#standings.getStandings(tournamentId);
    if (standings === null || standings.status !== 'final') throw new ConflictError('PRIZES_NOT_FINAL', 'Final standings are required before allocating prizes.');
    const standingsVersion = standings.calculationVersion;

    const existing = await this.#allocations().findOne({ tournamentId, standingsVersion });
    if (existing !== null) return this.#summary(existing);

    // Credit Dragon Coin prizes (idempotent per participant/rank) before the record transaction.
    const drcCredits: DragonCoinPrizeCredit[] = [];
    const cashDrafts: Array<{ rank: number; registrationId: string; accountId: string; amount: number }> = [];
    for (const placement of tournament.prizes.placements) {
      const row = standings.rows.find((r) => r.rank === placement.rank);
      if (row === undefined) continue; // no participant reached this placement
      const registration = await this.#registrations.getById(tournamentId, row.participantId);
      if (registration === null) continue;
      const accountId = registration.accountId;
      for (const reward of placement.rewards) {
        if (reward.assetCode === 'DRC') {
          const ledgerTransactionId = await this.#creditDragonCoin(context, tournamentId, placement.rank, accountId, reward.amountInteger);
          drcCredits.push({ rank: placement.rank, registrationId: row.participantId, accountId, amount: reward.amountInteger, ledgerTransactionId });
        } else if (reward.assetCode === 'IRR') {
          cashDrafts.push({ rank: placement.rank, registrationId: row.participantId, accountId, amount: reward.amountInteger });
        }
      }
    }

    const priorVersion = (await this.#allocations().find({ tournamentId }).sort({ version: -1 }).limit(1).toArray())[0]?.version ?? 0;
    const version = priorVersion + 1;
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        const now = utcNow();
        const cashEntitlementIds: EntityId[] = [];
        for (const draft of cashDrafts) {
          const entitlement: PrizeEntitlementRecord = { _id: newId(), tournamentId, allocationVersion: version, rank: draft.rank, registrationId: draft.registrationId, accountId: draft.accountId, assetCode: 'IRR', amount: draft.amount, state: 'pending', reason: null, settlementEvidence: null, approvedBy: null, paidBy: null, recipientVerifiedBy: null, recipientVerifiedAt: null, retryCount: 0, reversedBy: null, reversalReason: null, createdAt: now, updatedAt: now, version: 1 };
          await this.#entitlements(uow.db).insertOne(entitlement, { session: uow.session });
          cashEntitlementIds.push(entitlement._id);
        }
        // Supersede prior unpaid cash entitlements from earlier allocation versions.
        await this.#entitlements(uow.db).updateMany({ tournamentId, allocationVersion: { $lt: version }, state: { $in: ['pending', 'approved'] } }, { $set: { state: 'superseded', updatedAt: now }, $inc: { version: 1 } }, { session: uow.session });
        const allocation: PrizeAllocationRecord = { _id: newId(), tournamentId, version, prizeVersion: tournament.prizes.version, standingsVersion, actorId: context.actor.accountId ?? 'system', drcCredits, cashEntitlementIds, createdAt: now };
        await this.#allocations(uow.db).insertOne(allocation, { session: uow.session });
        uow.audit({ action: 'prize.allocated', resourceType: 'prize_allocation', resourceId: allocation._id, after: { tournamentId, version, dragonCoinCredits: drcCredits.length, cashEntitlements: cashEntitlementIds.length } });
        uow.publish({ eventName: 'prize.allocated', eventVersion: 1, aggregateId: allocation._id, payload: { tournamentId, version } });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        const raced = await this.#allocations().findOne({ tournamentId, standingsVersion });
        if (raced !== null) return this.#summary(raced);
      }
      throw error;
    }
    return { version, standingsVersion, dragonCoinCredits: drcCredits.length, cashEntitlements: cashDrafts.length };
  }

  async #creditDragonCoin(context: RequestContext, tournamentId: string, rank: number, accountId: string, amount: number): Promise<EntityId> {
    const businessRef = `prize_drc:${tournamentId}:${String(rank)}:${accountId}`;
    try {
      const posted = await this.#ledger.post(context, {
        type: 'dragon_coin_issue',
        businessRef,
        idempotencyKey: businessRef,
        description: 'tournament prize',
        entries: [
          { account: { kind: 'system', accountType: 'platform_dragon_coin_treasury' }, amount: -amount },
          { account: { kind: 'user', ownerId: accountId, accountType: 'user_dragon_coin' }, amount }
        ],
        metadata: { tournamentId, rank }
      });
      return posted.transaction._id;
    } catch (error) {
      // Already credited for this participant/rank (idempotent across re-allocations): reuse it.
      if ((error as { code?: string }).code === 'DUPLICATE_BUSINESS_REFERENCE') {
        const existing = await this.#db.collection<{ _id: string }>(LEDGER_COLLECTIONS.transactions).findOne({ businessRef });
        if (existing !== null) return existing._id;
      }
      throw error;
    }
  }

  #summary(allocation: PrizeAllocationRecord): AllocationSummary {
    return { version: allocation.version, standingsVersion: allocation.standingsVersion, dragonCoinCredits: allocation.drcCredits.length, cashEntitlements: allocation.cashEntitlementIds.length };
  }

  // --- Cash entitlement lifecycle (finance) ---

  /**
   * Records that the recipient was verified (PAYOUT-011).
   *
   * Separate from approval on purpose: verifying who is being paid and authorising the
   * payment are different judgements, and settlement below requires both.
   */
  async verifyRecipient(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string }): Promise<PrizeEntitlementRecord> {
    const actorId = context.actor.accountId ?? 'system';
    return this.#transitionOrAnnotate(context, entitlementId, null, input.expectedVersion, {
      reason: input.reason,
      recipientVerifiedBy: actorId,
      recipientVerifiedAt: utcNow()
    });
  }

  /** Flags a payout for manual review; used when an amount crosses the configured threshold. */
  async flagForReview(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string }): Promise<PrizeEntitlementRecord> {
    return this.#transition(context, entitlementId, 'manual_review', input.expectedVersion, { reason: input.reason });
  }

  async approveEntitlement(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string }): Promise<PrizeEntitlementRecord> {
    return this.#transition(context, entitlementId, 'approved', input.expectedVersion, { reason: input.reason, approvedBy: context.actor.accountId ?? 'system' });
  }

  /** Marks settlement as under way, so an in-flight payout is distinguishable from an untouched one. */
  async startProcessing(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string }): Promise<PrizeEntitlementRecord> {
    return this.#transition(context, entitlementId, 'processing', input.expectedVersion, { reason: input.reason });
  }

  async payEntitlement(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string; settlementEvidence: string }): Promise<PrizeEntitlementRecord> {
    if (input.settlementEvidence.trim() === '') throw new ValidationError('Settlement evidence is required.', [{ field: 'settlementEvidence', code: 'SETTLEMENT_EVIDENCE_REQUIRED', message: 'Provide settlement evidence.' }]);
    return this.#transition(context, entitlementId, 'paid', input.expectedVersion, { reason: input.reason, settlementEvidence: input.settlementEvidence, paidBy: context.actor.accountId ?? 'system' });
  }
  async failEntitlement(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string }): Promise<PrizeEntitlementRecord> {
    return this.#transition(context, entitlementId, 'failed', input.expectedVersion, { reason: input.reason });
  }

  /**
   * Returns a failed settlement to `approved` for another attempt (PAYOUT-009).
   *
   * The same entitlement id and amount are reused, so a retry can never become a second
   * payment; the attempt count is incremented so the history shows how many were made.
   */
  async retryEntitlement(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string }): Promise<PrizeEntitlementRecord> {
    // The retrying actor becomes the approver of record: returning a payout to `approved`
    // *is* an approval, and leaving the previous approver in place would let a second
    // person authorise a settlement while the first still carries the accountability.
    return this.#transition(context, entitlementId, 'approved', input.expectedVersion, {
      reason: input.reason,
      approvedBy: context.actor.accountId ?? 'system',
      incrementRetry: true
    });
  }

  async cancelEntitlement(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string }): Promise<PrizeEntitlementRecord> {
    return this.#transition(context, entitlementId, 'cancelled', input.expectedVersion, { reason: input.reason });
  }

  /**
   * Reverses a settled payout (PAYOUT-010).
   *
   * The original allocation and its evidence stay exactly as they were; the reversal is
   * recorded alongside them, so the record shows both that it was paid and that it was
   * undone, rather than pretending the payment never happened.
   */
  async reverseEntitlement(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string }): Promise<PrizeEntitlementRecord> {
    return this.#transition(context, entitlementId, 'reversed', input.expectedVersion, {
      reason: input.reason,
      reversedBy: context.actor.accountId ?? 'system',
      reversalReason: input.reason
    });
  }

  /** Annotates an entitlement without changing its state (recipient verification). */
  async #transitionOrAnnotate(
    context: RequestContext,
    entitlementId: EntityId,
    to: EntitlementState | null,
    expectedVersion: number,
    fields: TransitionFields
  ): Promise<PrizeEntitlementRecord> {
    return this.#transition(context, entitlementId, to, expectedVersion, fields);
  }

  async #transition(context: RequestContext, entitlementId: EntityId, to: EntitlementState | null, expectedVersion: number, fields: TransitionFields): Promise<PrizeEntitlementRecord> {
    if (fields.reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    const entitlement = await this.#entitlements().findOne({ _id: entitlementId });
    if (entitlement === null) throw new NotFoundError('Unknown entitlement.');
    if (to !== null && !canEntitlementTransition(entitlement.state, to)) {
      throw new ConflictError('INVALID_ENTITLEMENT_TRANSITION', `Cannot move an entitlement from ${entitlement.state} to ${to}.`);
    }

    if (to === 'paid') {
      // PAYOUT-006: the actor settling must not be the actor who approved. Permission
      // separation alone does not achieve this — one person can hold both permissions.
      const approver = entitlement.approvedBy;
      const settler = fields.paidBy ?? null;
      // An unapproved entitlement is not payable at all. Without this, a single actor
      // could reach `approved` by a route that never records an approver — fail a pending
      // payout, then retry it — and the comparison below would be vacuously satisfied
      // because there is nobody to compare against.
      if (approver === null) {
        throw new ConflictError('ENTITLEMENT_NOT_APPROVED', 'This payout has no recorded approver. Approve it before recording settlement.');
      }
      if (settler !== null && approver === settler) {
        throw new ForbiddenError('A payout must be settled by someone other than the actor who approved it.');
      }
      // PAYOUT-011: settlement cannot be marked successful while a required check is
      // incomplete. Verifying the recipient is that check.
      if ((entitlement.recipientVerifiedBy ?? null) === null) {
        throw new ConflictError('RECIPIENT_NOT_VERIFIED', 'Verify the recipient before recording settlement.');
      }
    }

    return runUnitOfWork(this.#database, context, async (uow) => {
      const now = utcNow();
      const set: Record<string, unknown> = { reason: fields.reason, updatedAt: now };
      if (to !== null) set['state'] = to;
      if (fields.settlementEvidence !== undefined) set['settlementEvidence'] = fields.settlementEvidence;
      if (fields.approvedBy !== undefined) set['approvedBy'] = fields.approvedBy;
      if (fields.paidBy !== undefined) set['paidBy'] = fields.paidBy;
      if (fields.recipientVerifiedBy !== undefined) set['recipientVerifiedBy'] = fields.recipientVerifiedBy;
      if (fields.recipientVerifiedAt !== undefined) set['recipientVerifiedAt'] = fields.recipientVerifiedAt;
      if (fields.reversedBy !== undefined) set['reversedBy'] = fields.reversedBy;
      if (fields.reversalReason !== undefined) set['reversalReason'] = fields.reversalReason;
      const update: Record<string, unknown> = { $set: set, $inc: { version: 1, ...(fields.incrementRetry === true ? { retryCount: 1 } : {}) } };
      const updated = await this.#entitlements(uow.db).updateOne({ _id: entitlementId, state: entitlement.state, version: expectedVersion }, update, { session: uow.session });
      if (updated.matchedCount === 0) throw new ConflictError('STALE_ENTITLEMENT_VERSION', 'The entitlement changed. Reload and retry.');
      const action = to ?? 'recipient_verified';
      uow.audit({ action: `prize.entitlement_${action}`, resourceType: 'prize_entitlement', resourceId: entitlementId, before: { state: entitlement.state }, after: { state: to ?? entitlement.state }, reason: fields.reason });
      uow.publish({ eventName: `prize.entitlement_${action}`, eventVersion: 1, aggregateId: entitlementId, payload: { tournamentId: entitlement.tournamentId, accountId: entitlement.accountId } });
      return { ...entitlement, ...set, version: entitlement.version + 1 } as PrizeEntitlementRecord;
    });
  }

  // --- Finance reconciliation (PAYOUT-012, ANALYTICS-006) ---

  /**
   * Reconciles prize definition → allocation → ledger → settlement, and names every
   * difference rather than reporting a single reassuring total.
   *
   * Three independent sources are compared: what the allocations say was credited in
   * Dragon Coin, what the ledger actually recorded for those transactions, and what the
   * cash entitlements say is outstanding or settled. A report that only summed one of
   * them could not detect the failure it exists to detect.
   */
  async reconcileFinance(): Promise<{
    allocations: number;
    dragonCoin: { allocatedAmount: number; ledgerAmount: number; missingTransactions: EntityId[] };
    cash: {
      outstandingAmount: number;
      settledAmount: number;
      reversedAmount: number;
      byState: Record<string, { count: number; amount: number }>;
    };
    differences: Array<{ kind: string; detail: string }>;
  }> {
    const allocations = await this.#allocations().find({}).limit(1000).toArray();
    const credits = allocations.flatMap((a) => a.drcCredits);
    const allocatedAmount = credits.reduce((total, credit) => total + credit.amount, 0);

    // The ledger is asked directly rather than trusted from the allocation record: the
    // point of the check is that the two can disagree.
    const transactionIds = credits.map((credit) => credit.ledgerTransactionId);
    const ledgerRows =
      transactionIds.length === 0
        ? []
        : await this.#db
            .collection<{ _id: EntityId }>(LEDGER_COLLECTIONS.transactions)
            .find({ _id: { $in: transactionIds } }, { projection: { _id: 1 } })
            .toArray();
    const present = new Set(ledgerRows.map((row) => row._id));
    const missingTransactions = [...new Set(transactionIds.filter((id) => !present.has(id)))];
    const ledgerAmount = credits.filter((credit) => present.has(credit.ledgerTransactionId)).reduce((total, credit) => total + credit.amount, 0);

    const entitlements = await this.#entitlements().find({}).limit(5000).toArray();
    const byState: Record<string, { count: number; amount: number }> = {};
    let outstandingAmount = 0;
    let settledAmount = 0;
    let reversedAmount = 0;
    for (const entitlement of entitlements) {
      const bucket = byState[entitlement.state] ?? { count: 0, amount: 0 };
      bucket.count += 1;
      bucket.amount += entitlement.amount;
      byState[entitlement.state] = bucket;
      if (isOutstandingEntitlement(entitlement.state)) outstandingAmount += entitlement.amount;
      if (isSettledEntitlement(entitlement.state)) settledAmount += entitlement.amount;
      if (entitlement.state === 'reversed') reversedAmount += entitlement.amount;
    }

    const differences: Array<{ kind: string; detail: string }> = [];
    if (missingTransactions.length > 0) {
      differences.push({ kind: 'ledger_transaction_missing', detail: `${String(missingTransactions.length)} allocated Dragon Coin credit(s) have no ledger transaction.` });
    }
    if (allocatedAmount !== ledgerAmount) {
      differences.push({ kind: 'dragon_coin_amount_mismatch', detail: `Allocated ${String(allocatedAmount)} but the ledger accounts for ${String(ledgerAmount)}.` });
    }
    for (const entitlement of entitlements) {
      // A settled payout without evidence is a hole in the audit trail, not a rounding
      // difference — it is reported as its own kind so it cannot be lost in a total.
      if (isSettledEntitlement(entitlement.state) && (entitlement.settlementEvidence ?? '').trim() === '') {
        differences.push({ kind: 'settlement_evidence_missing', detail: `Entitlement ${entitlement._id} is paid with no evidence.` });
      }
      if (isSettledEntitlement(entitlement.state) && entitlement.approvedBy !== null && entitlement.approvedBy === entitlement.paidBy) {
        differences.push({ kind: 'dual_control_violation', detail: `Entitlement ${entitlement._id} was approved and settled by the same actor.` });
      }
      // A settled payout with no recorded approver is its own violation, not an absence of
      // one: nobody is accountable for authorising it, so the dual-control comparison
      // above has nothing to compare and would pass in silence.
      if (isSettledEntitlement(entitlement.state) && entitlement.approvedBy === null) {
        differences.push({ kind: 'settled_without_approver', detail: `Entitlement ${entitlement._id} is paid with no recorded approver.` });
      }
    }

    return {
      allocations: allocations.length,
      dragonCoin: { allocatedAmount, ledgerAmount, missingTransactions },
      cash: { outstandingAmount, settledAmount, reversedAmount, byState },
      differences
    };
  }

  // --- Reads ---

  async listAccountEntitlements(accountId: EntityId, query: { cursor?: string; limit?: number } = {}): Promise<Page<PrizeEntitlementRecord>> {
    return this.#page({ accountId }, query);
  }
  /**
   * The whole cash-entitlement queue, across tournaments.
   *
   * A finance operator works a queue, not one tournament at a time: the question is
   * "what is waiting on me", and per-tournament listing cannot answer it without knowing
   * every tournament first.
   */
  async listEntitlements(query: { state?: string; cursor?: string; limit?: number } = {}): Promise<Page<PrizeEntitlementRecord>> {
    const filter: Record<string, unknown> = {};
    if (query.state !== undefined && query.state !== '') filter['state'] = query.state;
    return this.#page(filter, query);
  }

  async listTournamentEntitlements(tournamentId: EntityId, query: { state?: string; cursor?: string; limit?: number } = {}): Promise<Page<PrizeEntitlementRecord>> {
    const filter: Record<string, unknown> = { tournamentId };
    if (query.state !== undefined && query.state !== '') filter['state'] = query.state;
    return this.#page(filter, query);
  }

  async #page(baseFilter: Record<string, unknown>, query: { cursor?: string; limit?: number }): Promise<Page<PrizeEntitlementRecord>> {
    const limit = clampLimit(query.limit);
    const filter = { ...baseFilter };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    const rows = await this.#entitlements().find(filter).sort({ createdAt: -1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as PrizeEntitlementRecord), nextCursor: page.nextCursor };
  }
}
