import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import type { TournamentRecord } from '../tournaments/index.ts';
import type { LedgerService } from '../ledger/index.ts';
import { LEDGER_COLLECTIONS } from '../ledger/index.ts';
import { PRIZES_COLLECTIONS } from './collections.ts';
import { canEntitlementTransition, type DragonCoinPrizeCredit, type PrizeAllocationRecord, type PrizeEntitlementRecord } from './state.ts';

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
          const entitlement: PrizeEntitlementRecord = { _id: newId(), tournamentId, allocationVersion: version, rank: draft.rank, registrationId: draft.registrationId, accountId: draft.accountId, assetCode: 'IRR', amount: draft.amount, state: 'pending', reason: null, settlementEvidence: null, approvedBy: null, paidBy: null, createdAt: now, updatedAt: now, version: 1 };
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

  async approveEntitlement(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string }): Promise<PrizeEntitlementRecord> {
    return this.#transition(context, entitlementId, 'approved', input.expectedVersion, { reason: input.reason, approvedBy: context.actor.accountId ?? 'system' });
  }
  async payEntitlement(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string; settlementEvidence: string }): Promise<PrizeEntitlementRecord> {
    if (input.settlementEvidence.trim() === '') throw new ValidationError('Settlement evidence is required.', [{ field: 'settlementEvidence', code: 'SETTLEMENT_EVIDENCE_REQUIRED', message: 'Provide settlement evidence.' }]);
    return this.#transition(context, entitlementId, 'paid', input.expectedVersion, { reason: input.reason, settlementEvidence: input.settlementEvidence, paidBy: context.actor.accountId ?? 'system' });
  }
  async failEntitlement(context: RequestContext, entitlementId: EntityId, input: { expectedVersion: number; reason: string }): Promise<PrizeEntitlementRecord> {
    return this.#transition(context, entitlementId, 'failed', input.expectedVersion, { reason: input.reason });
  }

  async #transition(context: RequestContext, entitlementId: EntityId, to: 'approved' | 'paid' | 'failed', expectedVersion: number, fields: { reason: string; settlementEvidence?: string; approvedBy?: string; paidBy?: string }): Promise<PrizeEntitlementRecord> {
    if (fields.reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    const entitlement = await this.#entitlements().findOne({ _id: entitlementId });
    if (entitlement === null) throw new NotFoundError('Unknown entitlement.');
    if (!canEntitlementTransition(entitlement.state, to)) throw new ConflictError('INVALID_ENTITLEMENT_TRANSITION', `Cannot move an entitlement from ${entitlement.state} to ${to}.`);
    return runUnitOfWork(this.#database, context, async (uow) => {
      const now = utcNow();
      const set: Record<string, unknown> = { state: to, reason: fields.reason, updatedAt: now };
      if (fields.settlementEvidence !== undefined) set['settlementEvidence'] = fields.settlementEvidence;
      if (fields.approvedBy !== undefined) set['approvedBy'] = fields.approvedBy;
      if (fields.paidBy !== undefined) set['paidBy'] = fields.paidBy;
      const updated = await this.#entitlements(uow.db).updateOne({ _id: entitlementId, state: entitlement.state, version: expectedVersion }, { $set: set, $inc: { version: 1 } }, { session: uow.session });
      if (updated.matchedCount === 0) throw new ConflictError('STALE_ENTITLEMENT_VERSION', 'The entitlement changed. Reload and retry.');
      uow.audit({ action: `prize.entitlement_${to}`, resourceType: 'prize_entitlement', resourceId: entitlementId, before: { state: entitlement.state }, after: { state: to }, reason: fields.reason });
      uow.publish({ eventName: `prize.entitlement_${to}`, eventVersion: 1, aggregateId: entitlementId, payload: { tournamentId: entitlement.tournamentId, accountId: entitlement.accountId } });
      return { ...entitlement, ...set, version: entitlement.version + 1 } as PrizeEntitlementRecord;
    });
  }

  // --- Reads ---

  async listAccountEntitlements(accountId: EntityId, query: { cursor?: string; limit?: number } = {}): Promise<Page<PrizeEntitlementRecord>> {
    return this.#page({ accountId }, query);
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
