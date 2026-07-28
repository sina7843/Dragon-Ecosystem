import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork, type UnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { withIdempotency } from '../../shared/db/idempotency.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import type { TournamentRecord } from '../tournaments/index.ts';
import { COMPETITIONS_COLLECTIONS } from './collections.ts';
import { generateRoundRobin, generateSingleElimination, seedOrder, type Bracket, type EngineMatch } from './engine.ts';
import { generateDoubleElimination } from './double-elimination.ts';
import { swissPairKey, swissPairRound } from './swiss.ts';
import { buildManual, type ManualGraphSpec } from './manual.ts';
import { validateCompetitionConfig } from './validation.ts';
import { computeStandings, STANDINGS_POLICY_VERSION, type AcceptedMatch } from './standings.ts';
import {
  canRecordResult,
  type BracketVersionRecord,
  type CompetitionFormat,
  type CompetitionRecord,
  type CompetitionState,
  type MatchRecord,
  type ParticipantRef,
  type ResultCorrectionRecord,
  type StandingsSnapshotRecord
} from './state.ts';

/**
 * Competition service (DRAGON-09a + 09b): generates single-elimination,
 * round-robin, double-elimination, Swiss, and manual competitions from a
 * tournament's approved registrations, and records results with deterministic
 * advancement (winner and — for double elimination / manual — loser routing),
 * including structural byes via permanently-empty slots.
 *
 * Database guarantees: one competition per tournament (unique tournamentId); unique
 * logical fixture keys per competition (unique competitionId+key) which also makes
 * concurrent Swiss-round generation collapse to one; results recorded under an
 * optimistic (version, state:ready) guard so concurrent progression yields one
 * success and one conflict and a result is applied at most once. All writes go
 * through runUnitOfWork (transactional audit + outbox).
 */

const DUPLICATE_KEY = 11000;

/**
 * Upper bound on a whole-bracket read. A 1000-entrant double elimination is under 2000
 * matches, so this clears the largest field the platform allows (MAX_CAPACITY) with room
 * to spare while still refusing to load an unbounded collection.
 */
const MAX_MATCHES_PER_COMPETITION = 4000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export interface TournamentAccess {
  getById(id: EntityId): Promise<TournamentRecord | null>;
}
export interface RegistrationAccess {
  listApprovedParticipants(tournamentId: EntityId): Promise<ParticipantRef[]>;
}

export interface GenerateOptions {
  seed?: string;
  legs?: number;
  /** Swiss: number of rounds to run (default ceil(log2(participants))). */
  targetRounds?: number;
  /** Manual: the validated declarative competition graph. */
  manualGraph?: ManualGraphSpec;
}

export class CompetitionsService {
  readonly #database: Database;
  readonly #tournaments: TournamentAccess;
  readonly #registrations: RegistrationAccess;

  constructor(database: Database, tournaments: TournamentAccess, registrations: RegistrationAccess) {
    this.#database = database;
    this.#tournaments = tournaments;
    this.#registrations = registrations;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #competitions(db: Db = this.#db) {
    return db.collection<CompetitionRecord>(COMPETITIONS_COLLECTIONS.competitions);
  }
  #matches(db: Db = this.#db) {
    return db.collection<MatchRecord>(COMPETITIONS_COLLECTIONS.matches);
  }
  #standings(db: Db = this.#db) {
    return db.collection<StandingsSnapshotRecord>(COMPETITIONS_COLLECTIONS.standings);
  }
  #corrections(db: Db = this.#db) {
    return db.collection<ResultCorrectionRecord>(COMPETITIONS_COLLECTIONS.corrections);
  }
  #versions(db: Db = this.#db) {
    return db.collection<BracketVersionRecord>(COMPETITIONS_COLLECTIONS.versions);
  }

  // --- Generation ---

  async generate(context: RequestContext, tournamentId: EntityId, options: GenerateOptions = {}): Promise<CompetitionRecord> {
    const tournament = await this.#tournaments.getById(tournamentId);
    if (tournament === null || tournament.state !== 'published') throw new NotFoundError('Unknown tournament.');

    const participants = await this.#registrations.listApprovedParticipants(tournamentId);
    const participantIds = participants.map((p) => p.registrationId);
    const { format, legs } = validateCompetitionConfig({ format: tournament.format, participantIds, ...(options.legs === undefined ? {} : { legs: options.legs }) });

    const seed = options.seed ?? tournamentId;
    const seeded = seedOrder(participantIds, seed);
    const orderedParticipants = seeded.map((id) => participants.find((p) => p.registrationId === id) as ParticipantRef);
    const built = this.#buildBracketFor(format, seeded, { legs, targetRounds: options.targetRounds, manualGraph: options.manualGraph });

    const now = utcNow();
    const competition: CompetitionRecord = {
      _id: newId(),
      tournamentId,
      format,
      seed,
      legs,
      participantCount: participantIds.length,
      participants: orderedParticipants,
      state: 'generated',
      swiss: built.swiss,
      lockState: 'open',
      lockVersion: 0,
      standingsVersion: 0,
      activeVersion: 1,
      manualGraph: format === 'manual' ? options.manualGraph ?? null : null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    const refByRegistration = new Map(participants.map((p) => [p.registrationId, p]));
    const matchDocs = this.#buildMatchDocs(built.bracket.matches, competition, tournamentId, format, refByRegistration, now);

    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#competitions(uow.db).insertOne(competition, { session: uow.session });
        await this.#matches(uow.db).insertMany(matchDocs, { session: uow.session });
        await this.#createVersion(uow, competition, 1, 'generation', null, null, now);
        await this.#recalculate(uow, competition._id, now);
        uow.audit({ action: 'competition.generated', resourceType: 'competition', resourceId: competition._id, after: { tournamentId, format, participantCount: competition.participantCount, matchCount: matchDocs.length } });
        uow.publish({ eventName: 'competition.generated', eventVersion: 1, aggregateId: competition._id, payload: { tournamentId, format, participantCount: competition.participantCount } });
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictError('COMPETITION_EXISTS', 'A competition has already been generated for this tournament.');
      throw error;
    }
    return competition;
  }

  /** Shared bracket construction for generation and regeneration. */
  #buildBracketFor(format: CompetitionFormat, seeded: readonly string[], opts: { legs: number; targetRounds?: number | undefined; manualGraph?: ManualGraphSpec | undefined }): { bracket: Bracket; swiss: CompetitionRecord['swiss'] } {
    if (format === 'single_elimination') return { bracket: generateSingleElimination(seeded), swiss: null };
    if (format === 'round_robin') return { bracket: generateRoundRobin(seeded, opts.legs), swiss: null };
    if (format === 'double_elimination') return { bracket: generateDoubleElimination(seeded), swiss: null };
    if (format === 'swiss') {
      const targetRounds = this.#swissTargetRounds(opts.targetRounds, seeded.length);
      const result = swissPairRound({ order: seeded, wins: new Map(), priorPairs: new Set(), byeCounts: new Map() });
      return { bracket: { format: 'swiss', rounds: targetRounds, matches: this.#swissRoundMatches(1, result.pairs, result.bye) }, swiss: { targetRounds, currentRound: 1 } };
    }
    if (opts.manualGraph === undefined) throw new ValidationError('A custom competition requires a graph.', [{ field: 'graph', code: 'MANUAL_GRAPH_REQUIRED', message: 'Provide the competition graph.' }]);
    return { bracket: buildManual(opts.manualGraph, seeded), swiss: null };
  }

  #createVersion(uow: UnitOfWork, competition: CompetitionRecord, versionNumber: number, origin: BracketVersionRecord['origin'], reason: string | null, rolledBackFrom: number | null, now: string): Promise<unknown> {
    return this.#versions(uow.db).insertOne(
      {
        _id: newId(),
        competitionId: competition._id,
        tournamentId: competition.tournamentId,
        versionNumber,
        state: 'active',
        origin,
        rolledBackFrom,
        reason,
        seed: competition.seed,
        participantsSnapshot: competition.participants,
        matchesSnapshot: [],
        completedResultCount: 0,
        participantCount: competition.participantCount,
        actorId: uow.context.actor.accountId ?? 'system',
        createdAt: now,
        supersededAt: null
      },
      { session: uow.session }
    );
  }

  #swissTargetRounds(requested: number | undefined, count: number): number {
    const fallback = Math.max(1, Math.ceil(Math.log2(count)));
    if (requested === undefined) return fallback;
    if (!Number.isInteger(requested) || requested < 1 || requested > count - 1) {
      throw new ValidationError('The number of Swiss rounds is not valid.', [{ field: 'targetRounds', code: 'INVALID_ROUNDS', message: `Use between 1 and ${String(count - 1)} rounds.` }]);
    }
    return requested;
  }

  /** Builds the persisted engine matches for one generation batch (all keys are within the batch). */
  #buildMatchDocs(engineMatches: readonly EngineMatch[], competition: CompetitionRecord, tournamentId: string, format: CompetitionFormat, refByRegistration: Map<string, ParticipantRef>, now: string): MatchRecord[] {
    const idByKey = new Map(engineMatches.map((m) => [m.key, newId()]));
    return engineMatches.map((m) => {
      const slotA = m.a === null ? null : refByRegistration.get(m.a) ?? null;
      const slotB = m.b === null ? null : refByRegistration.get(m.b) ?? null;
      const winner = m.winner === null ? null : refByRegistration.get(m.winner) ?? null;
      const state = m.bye ? 'bye' : slotA !== null && slotB !== null ? 'ready' : 'pending';
      return {
        _id: idByKey.get(m.key) as string,
        competitionId: competition._id,
        tournamentId,
        format,
        key: m.key,
        bracket: m.bracket,
        round: m.round,
        index: m.index,
        slotA,
        slotB,
        slotAEmpty: m.aEmpty,
        slotBEmpty: m.bEmpty,
        state,
        winner,
        scoreA: null,
        scoreB: null,
        nextMatchId: m.nextKey === null ? null : idByKey.get(m.nextKey) ?? null,
        nextSlot: m.nextSlot,
        loserNextMatchId: m.loserNextKey === null ? null : idByKey.get(m.loserNextKey) ?? null,
        loserNextSlot: m.loserNextSlot,
        version: 1,
        createdAt: now,
        updatedAt: now
      };
    });
  }

  #swissRoundMatches(roundNumber: number, pairs: ReadonlyArray<[string, string]>, bye: string | null): EngineMatch[] {
    const matches: EngineMatch[] = pairs.map(([a, b], i) => ({
      key: `s${String(roundNumber)}m${String(i)}`,
      bracket: 'swiss',
      round: roundNumber,
      index: i,
      a,
      b,
      aEmpty: false,
      bEmpty: false,
      nextKey: null,
      nextSlot: null,
      loserNextKey: null,
      loserNextSlot: null,
      bye: false,
      winner: null
    }));
    if (bye !== null) {
      // A Swiss bye is a walkover with no fabricated opponent (the empty side).
      matches.push({
        key: `s${String(roundNumber)}bye`,
        bracket: 'swiss',
        round: roundNumber,
        index: pairs.length,
        a: bye,
        b: null,
        aEmpty: false,
        bEmpty: true,
        nextKey: null,
        nextSlot: null,
        loserNextKey: null,
        loserNextSlot: null,
        bye: true,
        winner: bye
      });
    }
    return matches;
  }

  /**
   * Generates the next Swiss round from accepted results (BRACKET-004). Refuses
   * while the current round is incomplete; the unique key index makes a concurrent
   * attempt for the same round produce exactly one persisted round.
   */
  async generateSwissRound(context: RequestContext, tournamentId: EntityId): Promise<{ round: number; matchCount: number }> {
    const competition = await this.#competitions().findOne({ tournamentId });
    if (competition === null || competition.swiss === null) throw new NotFoundError('No Swiss competition.');
    const current = competition.swiss.currentRound;
    if (current >= competition.swiss.targetRounds) throw new ConflictError('SWISS_COMPLETE', 'All Swiss rounds have been generated.');

    const played = await this.#matches().find({ competitionId: competition._id }).toArray();
    const incomplete = played.filter((m) => m.round === current && (m.state === 'ready' || m.state === 'pending'));
    if (incomplete.length > 0) throw new ConflictError('SWISS_ROUND_INCOMPLETE', 'Finish the current round before generating the next.');

    const wins = new Map<string, number>();
    const byeCounts = new Map<string, number>();
    const priorPairs = new Set<string>();
    for (const m of played) {
      if (m.winner !== null) wins.set(m.winner.registrationId, (wins.get(m.winner.registrationId) ?? 0) + 1);
      if (m.state === 'bye' && m.winner !== null) byeCounts.set(m.winner.registrationId, (byeCounts.get(m.winner.registrationId) ?? 0) + 1);
      if (m.slotA !== null && m.slotB !== null) priorPairs.add(swissPairKey(m.slotA.registrationId, m.slotB.registrationId));
    }
    const order = competition.participants.map((p) => p.registrationId);
    const result = swissPairRound({ order, wins, priorPairs, byeCounts });
    const nextRound = current + 1;
    const engineMatches = this.#swissRoundMatches(nextRound, result.pairs, result.bye);
    const refByRegistration = new Map(competition.participants.map((p) => [p.registrationId, p]));
    const now = utcNow();
    const matchDocs = this.#buildMatchDocs(engineMatches, competition, tournamentId, 'swiss', refByRegistration, now);

    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#matches(uow.db).insertMany(matchDocs, { session: uow.session });
        const updated = await this.#competitions(uow.db).updateOne(
          { _id: competition._id, 'swiss.currentRound': current },
          { $set: { 'swiss.currentRound': nextRound, state: 'in_progress', updatedAt: now } },
          { session: uow.session }
        );
        if (updated.matchedCount === 0) throw new ConflictError('SWISS_ROUND_STALE', 'The Swiss round advanced already.');
        uow.audit({ action: 'competition.swiss_round', resourceType: 'competition', resourceId: competition._id, after: { round: nextRound, matchCount: matchDocs.length } });
        uow.publish({ eventName: 'competition.swiss_round', eventVersion: 1, aggregateId: competition._id, payload: { tournamentId, round: nextRound } });
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictError('SWISS_ROUND_EXISTS', 'That Swiss round was already generated.');
      throw error;
    }
    return { round: nextRound, matchCount: matchDocs.length };
  }

  // --- Result recording + advancement ---

  async recordResult(
    context: RequestContext,
    tournamentId: EntityId,
    matchId: EntityId,
    input: { winnerSlot: 'a' | 'b'; scoreA?: number; scoreB?: number }
  ): Promise<MatchRecord> {
    const match = await this.#matches().findOne({ _id: matchId, tournamentId });
    if (match === null) throw new NotFoundError('Unknown match.');
    const competition = await this.#competitions().findOne({ _id: match.competitionId });
    if (competition !== null && competition.lockState === 'locked') throw new ConflictError('COMPETITION_LOCKED', 'This competition is finalized; result entry is closed.');

    const winner = input.winnerSlot === 'a' ? match.slotA : match.slotB;
    const loser = input.winnerSlot === 'a' ? match.slotB : match.slotA;

    if (match.state === 'completed') {
      if (winner !== null && match.winner !== null && match.winner.registrationId === winner.registrationId) return match;
      throw new ConflictError('RESULT_ALREADY_RECORDED', 'A different result was already recorded for this match.');
    }
    if (!canRecordResult(match.state)) throw new ConflictError('MATCH_NOT_READY', 'This match is not awaiting a result.');
    if (winner === null || loser === null) throw new ValidationError('The winning slot is empty.', [{ field: 'winnerSlot', code: 'INVALID_WINNER', message: 'Choose a filled slot.' }]);

    return runUnitOfWork(this.#database, context, async (uow) => {
      const now = utcNow();
      // Session-consistent lock re-check: a competition locked concurrently must reject entry.
      const fresh = await this.#competitions(uow.db).findOne({ _id: match.competitionId }, { session: uow.session });
      if (fresh !== null && fresh.lockState === 'locked') throw new ConflictError('COMPETITION_LOCKED', 'This competition is finalized; result entry is closed.');
      const claimed = await this.#matches(uow.db).updateOne(
        { _id: matchId, version: match.version, state: 'ready' },
        { $set: { state: 'completed', winner, scoreA: input.scoreA ?? null, scoreB: input.scoreB ?? null, updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (claimed.matchedCount === 0) throw new ConflictError('RESULT_STALE', 'This match changed. Reload and retry.');

      if (match.nextMatchId !== null && match.nextSlot !== null) await this.#fillCascade(uow, match.nextMatchId, match.nextSlot, winner, now);
      if (match.loserNextMatchId !== null && match.loserNextSlot !== null) await this.#fillCascade(uow, match.loserNextMatchId, match.loserNextSlot, loser, now);

      await this.#competitions(uow.db).updateOne({ _id: match.competitionId, state: 'generated' }, { $set: { state: 'in_progress', updatedAt: now } }, { session: uow.session });
      const remaining = await this.#matches(uow.db).countDocuments({ competitionId: match.competitionId, state: { $in: ['ready', 'pending'] } }, { session: uow.session });
      // A Swiss competition is only complete once its last round is generated too.
      const swiss = await this.#competitions(uow.db).findOne({ _id: match.competitionId }, { session: uow.session });
      const swissMoreRounds = swiss?.swiss !== null && swiss?.swiss !== undefined && swiss.swiss.currentRound < swiss.swiss.targetRounds;
      if (remaining === 0 && !swissMoreRounds) {
        await this.#competitions(uow.db).updateOne({ _id: match.competitionId }, { $set: { state: 'completed', updatedAt: now } }, { session: uow.session });
      }
      await this.#recalculate(uow, match.competitionId, now);

      uow.audit({ action: 'competition.match_completed', resourceType: 'match', resourceId: matchId, before: { state: match.state }, after: { state: 'completed', winner: winner.registrationId } });
      uow.publish({ eventName: 'competition.match_completed', eventVersion: 1, aggregateId: matchId, payload: { tournamentId, competitionId: match.competitionId, winner: winner.registrationId } });

      return { ...match, state: 'completed', winner, scoreA: input.scoreA ?? null, scoreB: input.scoreB ?? null, version: match.version + 1, updatedAt: now };
    });
  }

  /**
   * Fills a downstream slot and cascades structural byes: if the sibling slot is
   * permanently empty, the fixture is a walkover and its winner advances further.
   * The conditional "promote to ready" re-reads the current document, so two
   * sibling results feeding one fixture serialize safely (BRACKET-016).
   */
  async #fillCascade(uow: UnitOfWork, startId: EntityId, startSlot: 'a' | 'b', startRef: ParticipantRef, now: string): Promise<void> {
    const queue: Array<{ id: EntityId; slot: 'a' | 'b'; ref: ParticipantRef }> = [{ id: startId, slot: startSlot, ref: startRef }];
    while (queue.length > 0) {
      const { id, slot, ref } = queue.shift() as { id: EntityId; slot: 'a' | 'b'; ref: ParticipantRef };
      const slotField = slot === 'a' ? 'slotA' : 'slotB';
      const emptyField = slot === 'a' ? 'slotAEmpty' : 'slotBEmpty';
      await this.#matches(uow.db).updateOne({ _id: id }, { $set: { [slotField]: ref, [emptyField]: false, updatedAt: now } }, { session: uow.session });
      // Both slots filled → promote to ready (re-checks the current document).
      await this.#matches(uow.db).updateOne({ _id: id, slotA: { $ne: null }, slotB: { $ne: null }, state: 'pending' }, { $set: { state: 'ready', updatedAt: now } }, { session: uow.session });
      const current = await this.#matches(uow.db).findOne({ _id: id }, { session: uow.session });
      if (current === null || current.state === 'completed' || current.state === 'ready') continue;
      const siblingEmpty = slot === 'a' ? current.slotBEmpty : current.slotAEmpty;
      if (siblingEmpty) {
        // Walkover: advance without a result and without counting a loss.
        await this.#matches(uow.db).updateOne({ _id: id, state: { $nin: ['completed'] } }, { $set: { state: 'completed', winner: ref, updatedAt: now } }, { session: uow.session });
        if (current.nextMatchId !== null && current.nextSlot !== null) queue.push({ id: current.nextMatchId, slot: current.nextSlot, ref });
      }
    }
  }

  // --- Standings projection (BRACKET-015/016) ---

  #toAccepted(m: MatchRecord): AcceptedMatch {
    return {
      round: m.round,
      bracket: m.bracket,
      a: m.slotA?.registrationId ?? null,
      b: m.slotB?.registrationId ?? null,
      winner: m.winner?.registrationId ?? null,
      bye: m.state === 'bye',
      loserNextEliminates: m.loserNextMatchId === null
    };
  }

  /**
   * Recomputes and publishes the current standings projection atomically inside the
   * caller's unit of work. The optimistic standingsVersion guard plus the unique
   * (competitionId, current) index make a concurrent recalculation produce exactly
   * one current projection and prevent a stale projection from overwriting a newer
   * one. Deterministic: identical accepted results yield byte-equivalent rows.
   */
  async #recalculate(uow: UnitOfWork, competitionId: EntityId, now: string): Promise<void> {
    const competition = await this.#competitions(uow.db).findOne({ _id: competitionId }, { session: uow.session });
    if (competition === null) throw new NotFoundError('Unknown competition.');
    const all = await this.#matches(uow.db).find({ competitionId }, { session: uow.session }).sort({ round: 1, index: 1 }).toArray();
    const accepted = all.filter((m) => m.state === 'completed' || m.state === 'bye').map((m) => this.#toAccepted(m));
    const order = competition.participants.map((p) => p.registrationId);
    const projection = computeStandings({ format: competition.format, order, matches: accepted, competitionComplete: competition.state === 'completed' });

    const bumped = await this.#competitions(uow.db).updateOne(
      { _id: competitionId, standingsVersion: competition.standingsVersion },
      { $inc: { standingsVersion: 1 }, $set: { updatedAt: now } },
      { session: uow.session }
    );
    if (bumped.matchedCount === 0) throw new ConflictError('STANDINGS_STALE', 'Standings changed concurrently. Retry.');
    const calculationVersion = competition.standingsVersion + 1;

    await this.#standings(uow.db).updateMany({ competitionId, current: true }, { $set: { current: false } }, { session: uow.session });
    await this.#standings(uow.db).insertOne(
      {
        _id: newId(),
        competitionId,
        tournamentId: competition.tournamentId,
        format: competition.format,
        formatVersion: 1,
        policyVersion: STANDINGS_POLICY_VERSION,
        calculationVersion,
        sourceWatermark: accepted.length,
        status: projection.status,
        current: true,
        rows: projection.rows,
        calculatedAt: now
      },
      { session: uow.session }
    );
  }

  /** Current standings snapshot for a tournament's competition. */
  async getStandings(tournamentId: EntityId): Promise<StandingsSnapshotRecord | null> {
    const competition = await this.#competitions().findOne({ tournamentId });
    if (competition === null) return null;
    return this.#standings().findOne({ competitionId: competition._id, current: true });
  }

  /** Explicit recalculation (BRACKET-016). Idempotent semantics come from the version guard. */
  async recalculate(context: RequestContext, tournamentId: EntityId): Promise<StandingsSnapshotRecord> {
    const competition = await this.#competitions().findOne({ tournamentId });
    if (competition === null) throw new NotFoundError('No competition.');
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#recalculate(uow, competition._id, utcNow());
      uow.audit({ action: 'competition.standings_recalculated', resourceType: 'competition', resourceId: competition._id });
    });
    return this.#standings().findOne({ competitionId: competition._id, current: true }) as Promise<StandingsSnapshotRecord>;
  }

  // --- Result correction + versioning (BRACKET-022, TOURN-022) ---

  async correctResult(
    context: RequestContext,
    tournamentId: EntityId,
    matchId: EntityId,
    input: { expectedVersion: number; winnerSlot: 'a' | 'b'; scoreA?: number; scoreB?: number; reason: string; idempotencyKey: string }
  ): Promise<ResultCorrectionRecord> {
    if (input.reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    const match = await this.#matches().findOne({ _id: matchId, tournamentId });
    if (match === null) throw new NotFoundError('Unknown match.');
    const competition = await this.#competitions().findOne({ _id: match.competitionId });
    if (competition === null) throw new NotFoundError('Unknown competition.');
    if (competition.lockState === 'locked') throw new ConflictError('COMPETITION_LOCKED', 'This competition is finalized; corrections require an explicit unlock.');
    if (match.state !== 'completed') throw new ConflictError('RESULT_NOT_CORRECTABLE', 'Only a completed result can be corrected.');

    const correctedWinner = input.winnerSlot === 'a' ? match.slotA : match.slotB;
    if (correctedWinner === null) throw new ValidationError('The winning slot is empty.', [{ field: 'winnerSlot', code: 'INVALID_WINNER', message: 'Choose a filled slot.' }]);
    // No-op correction (same winner) is not a correction; treat as idempotent success without a new revision.
    if (match.winner !== null && match.winner.registrationId === correctedWinner.registrationId && input.scoreA === (match.scoreA ?? undefined) && input.scoreB === (match.scoreB ?? undefined)) {
      const existing = await this.#corrections().findOne({ matchId }, { sort: { revisionNumber: -1 } });
      if (existing !== null) return existing;
    }

    // Downstream-history boundary: a completed downstream fixture must not be silently rewritten.
    for (const target of [match.nextMatchId, match.loserNextMatchId]) {
      if (target === null) continue;
      const downstream = await this.#matches().findOne({ _id: target });
      if (downstream !== null && downstream.state === 'completed') {
        throw new ConflictError('DOWNSTREAM_HISTORY_CONFLICT', 'A later completed fixture depends on this result; manual operational resolution is required.');
      }
    }

    const outcome = await withIdempotency(
      this.#db,
      { scope: `result_correction:${matchId}`, key: input.idempotencyKey, request: { winnerSlot: input.winnerSlot, scoreA: input.scoreA ?? null, scoreB: input.scoreB ?? null } },
      () => this.#applyCorrection(context, competition, match, correctedWinner, input)
    );
    return outcome.result;
  }

  async #applyCorrection(
    context: RequestContext,
    competition: CompetitionRecord,
    match: MatchRecord,
    correctedWinner: ParticipantRef,
    input: { expectedVersion: number; winnerSlot: 'a' | 'b'; scoreA?: number; scoreB?: number; reason: string }
  ): Promise<ResultCorrectionRecord> {
    const correctedLoser = input.winnerSlot === 'a' ? match.slotB : match.slotA;
    return runUnitOfWork(this.#database, context, async (uow) => {
      const now = utcNow();
      // Re-check the lock and downstream boundary inside the transaction so a
      // concurrent lock or a downstream fixture completing between the outer check
      // and this write cannot slip past (session-consistent, aborts on violation).
      const freshCompetition = await this.#competitions(uow.db).findOne({ _id: competition._id }, { session: uow.session });
      if (freshCompetition !== null && freshCompetition.lockState === 'locked') throw new ConflictError('COMPETITION_LOCKED', 'This competition is finalized; corrections require an explicit unlock.');
      for (const target of [match.nextMatchId, match.loserNextMatchId]) {
        if (target === null) continue;
        const downstream = await this.#matches(uow.db).findOne({ _id: target }, { session: uow.session });
        if (downstream !== null && downstream.state === 'completed') throw new ConflictError('DOWNSTREAM_HISTORY_CONFLICT', 'A later completed fixture depends on this result; manual operational resolution is required.');
      }
      // Optimistic guard: exactly one concurrent correction wins; the loser writes nothing.
      const claimed = await this.#matches(uow.db).updateOne(
        { _id: match._id, version: input.expectedVersion, state: 'completed' },
        { $set: { winner: correctedWinner, scoreA: input.scoreA ?? null, scoreB: input.scoreB ?? null, updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (claimed.matchedCount === 0) throw new ConflictError('RESULT_VERSION_STALE', 'This result changed since you opened it. Reload and retry.');

      // Re-route the (not-yet-completed) downstream fixtures to the corrected outcome.
      if (match.nextMatchId !== null && match.nextSlot !== null) await this.#retarget(uow, match.nextMatchId, match.nextSlot, correctedWinner, now);
      if (match.loserNextMatchId !== null && match.loserNextSlot !== null && correctedLoser !== null) await this.#retarget(uow, match.loserNextMatchId, match.loserNextSlot, correctedLoser, now);

      const priorRevision = await this.#corrections(uow.db).findOne({ matchId: match._id }, { sort: { revisionNumber: -1 }, session: uow.session });
      const revisionNumber = (priorRevision?.revisionNumber ?? 0) + 1;
      const correction: ResultCorrectionRecord = {
        _id: newId(),
        matchId: match._id,
        competitionId: competition._id,
        tournamentId: competition.tournamentId,
        revisionNumber,
        priorWinner: match.winner?.registrationId ?? null,
        priorScoreA: match.scoreA,
        priorScoreB: match.scoreB,
        correctedWinner: correctedWinner.registrationId,
        correctedScoreA: input.scoreA ?? null,
        correctedScoreB: input.scoreB ?? null,
        reason: input.reason,
        actorId: context.actor.accountId ?? 'system',
        correlationId: context.correlationId,
        createdAt: now
      };
      await this.#corrections(uow.db).insertOne(correction, { session: uow.session });
      await this.#recalculate(uow, competition._id, now);

      uow.audit({ action: 'competition.result_corrected', resourceType: 'match', resourceId: match._id, before: { winner: correction.priorWinner }, after: { winner: correction.correctedWinner, revision: revisionNumber }, reason: input.reason });
      uow.publish({ eventName: 'competition.result_corrected', eventVersion: 1, aggregateId: match._id, payload: { competitionId: competition._id, revisionNumber } });
      return correction;
    });
  }

  /** Overwrites a downstream slot when a correction changes who advanced. */
  async #retarget(uow: UnitOfWork, matchId: EntityId, slot: 'a' | 'b', ref: ParticipantRef, now: string): Promise<void> {
    const field = slot === 'a' ? 'slotA' : 'slotB';
    await this.#matches(uow.db).updateOne({ _id: matchId, state: { $ne: 'completed' } }, { $set: { [field]: ref, updatedAt: now } }, { session: uow.session });
  }

  // --- Lock / finalize (BRACKET-012) ---

  async setLockState(context: RequestContext, tournamentId: EntityId, toState: 'open' | 'correction_limited' | 'locked', expectedLockVersion: number): Promise<CompetitionRecord> {
    const competition = await this.#competitions().findOne({ tournamentId });
    if (competition === null) throw new NotFoundError('No competition.');
    return runUnitOfWork(this.#database, context, async (uow) => {
      const now = utcNow();
      const updated = await this.#competitions(uow.db).updateOne(
        { _id: competition._id, lockVersion: expectedLockVersion },
        { $set: { lockState: toState, updatedAt: now }, $inc: { lockVersion: 1 } },
        { session: uow.session }
      );
      if (updated.matchedCount === 0) throw new ConflictError('LOCK_VERSION_STALE', 'The lock state changed. Reload and retry.');
      uow.audit({ action: 'competition.lock_changed', resourceType: 'competition', resourceId: competition._id, before: { lockState: competition.lockState }, after: { lockState: toState } });
      uow.publish({ eventName: 'competition.lock_changed', eventVersion: 1, aggregateId: competition._id, payload: { tournamentId, lockState: toState } });
      return { ...competition, lockState: toState, lockVersion: competition.lockVersion + 1, updatedAt: now };
    });
  }

  // --- Reads ---

  async getCompetition(tournamentId: EntityId): Promise<CompetitionRecord | null> {
    return this.#competitions().findOne({ tournamentId });
  }

  /**
   * The whole bracket in one read, for a caller that genuinely needs it (the demo seeder
   * advancing a competition). Bounded by a tripwire rather than a page size: a partial
   * bracket would let a caller act on a match list it believes is complete. Anything that
   * only needs to *display* matches should use {@link listMatchesPage} (DB-002).
   */
  async listMatches(competitionId: EntityId): Promise<MatchRecord[]> {
    const rows = await this.#matches().find({ competitionId }).sort({ round: 1, index: 1 }).limit(MAX_MATCHES_PER_COMPETITION + 1).toArray();
    if (rows.length > MAX_MATCHES_PER_COMPETITION) {
      throw new ConflictError(
        'COMPETITION_TOO_LARGE',
        `This competition has more than ${String(MAX_MATCHES_PER_COMPETITION)} matches; page through them instead of loading the whole bracket.`
      );
    }
    return rows;
  }

  /** Paginated, (round, index)-ordered match read (load-safe; never loads the whole bracket at once). */
  async listMatchesPage(competitionId: EntityId, query: { cursor?: string; limit?: number }): Promise<Page<MatchRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { competitionId };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      const [round, index] = cursor.sortValue.split(':').map((n) => Number.parseInt(n, 10));
      filter['$or'] = [{ round: { $gt: round } }, { round, index: { $gt: index } }];
    }
    const rows = await this.#matches().find(filter).sort({ round: 1, index: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: `${String(r.round).padStart(6, '0')}:${String(r.index).padStart(6, '0')}`, id: r._id })), limit);
    return {
      items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as MatchRecord),
      nextCursor: page.nextCursor
    };
  }

  // --- Bracket versioning: regenerate / rollback / history (BRACKET-010/013/014) ---

  /** Derives lifecycle state from a match set (fresh or restored). */
  #deriveState(matches: readonly MatchRecord[], swiss: CompetitionRecord['swiss']): CompetitionState {
    const remaining = matches.filter((m) => m.state === 'ready' || m.state === 'pending').length;
    const swissMoreRounds = swiss !== null && swiss.currentRound < swiss.targetRounds;
    if (remaining === 0 && !swissMoreRounds) return 'completed';
    return matches.some((m) => m.state === 'completed') ? 'in_progress' : 'generated';
  }

  /** Snapshots the active version's matches into its immutable record and supersedes it. */
  async #supersedeActive(uow: UnitOfWork, competition: CompetitionRecord, now: string): Promise<void> {
    const matches = await this.#matches(uow.db).find({ competitionId: competition._id }, { session: uow.session }).sort({ round: 1, index: 1 }).toArray();
    const completed = matches.filter((m) => m.state === 'completed').length;
    const superseded = await this.#versions(uow.db).updateOne(
      { competitionId: competition._id, versionNumber: competition.activeVersion, state: 'active' },
      { $set: { state: 'superseded', supersededAt: now, matchesSnapshot: matches, completedResultCount: completed } },
      { session: uow.session }
    );
    // No active version to supersede → another regeneration/rollback won the race.
    if (superseded.matchedCount === 0) throw new ConflictError('VERSION_STALE', 'The bracket changed concurrently. Reload and retry.');
  }

  /** Non-mutating impact preview for a prospective regeneration (BRACKET-013). */
  async regeneratePreview(tournamentId: EntityId, options: { seed?: string } = {}): Promise<{
    format: CompetitionFormat;
    participantCount: number;
    currentCompletedResults: number;
    activeVersion: number;
    nextVersion: number;
    matchCount: number;
    rounds: number;
    locked: boolean;
  }> {
    const competition = await this.#competitions().findOne({ tournamentId });
    if (competition === null) throw new NotFoundError('No competition.');
    const matches = await this.#matches().find({ competitionId: competition._id }).toArray();
    const seeded = seedOrder(competition.participants.map((p) => p.registrationId), options.seed ?? competition.seed);
    const built = this.#buildBracketFor(competition.format, seeded, { legs: competition.legs, targetRounds: competition.swiss?.targetRounds, manualGraph: competition.manualGraph ?? undefined });
    return {
      format: competition.format,
      participantCount: competition.participantCount,
      currentCompletedResults: matches.filter((m) => m.state === 'completed').length,
      activeVersion: competition.activeVersion,
      nextVersion: competition.activeVersion + 1,
      matchCount: built.bracket.matches.length,
      rounds: built.bracket.rounds,
      locked: competition.lockState === 'locked'
    };
  }

  /**
   * Regenerates the bracket structure from the current participants, superseding the
   * active version (its matches — including any recorded results — are snapshotted
   * into immutable history first, never lost silently). Destructive: requires an
   * explicit confirmation and a reason, refuses a locked competition, and guards on
   * the competition version so concurrent regeneration yields one success.
   */
  async regenerate(context: RequestContext, tournamentId: EntityId, input: { expectedVersion: number; reason: string; confirm: boolean; seed?: string }): Promise<CompetitionRecord> {
    if (input.reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    if (input.confirm !== true) throw new ValidationError('Regeneration must be confirmed.', [{ field: 'confirm', code: 'CONFIRMATION_REQUIRED', message: 'Confirm this destructive action.' }]);
    const competition = await this.#competitions().findOne({ tournamentId });
    if (competition === null) throw new NotFoundError('No competition.');
    if (competition.lockState === 'locked') throw new ConflictError('COMPETITION_LOCKED', 'This competition is finalized; unlock it before regenerating.');

    const seed = input.seed ?? competition.seed;
    const seeded = seedOrder(competition.participants.map((p) => p.registrationId), seed);
    const built = this.#buildBracketFor(competition.format, seeded, { legs: competition.legs, targetRounds: competition.swiss?.targetRounds, manualGraph: competition.manualGraph ?? undefined });
    const orderedParticipants = seeded.map((id) => competition.participants.find((p) => p.registrationId === id) as ParticipantRef);
    const newNumber = competition.activeVersion + 1;

    return runUnitOfWork(this.#database, context, async (uow) => {
      const now = utcNow();
      const fresh = await this.#competitions(uow.db).findOne({ _id: competition._id }, { session: uow.session });
      if (fresh !== null && fresh.lockState === 'locked') throw new ConflictError('COMPETITION_LOCKED', 'This competition is finalized; unlock it before regenerating.');

      await this.#supersedeActive(uow, competition, now);
      await this.#matches(uow.db).deleteMany({ competitionId: competition._id }, { session: uow.session });

      const nextCompetition: CompetitionRecord = { ...competition, seed, participants: orderedParticipants, swiss: built.swiss, activeVersion: newNumber, state: this.#deriveState([], built.swiss) };
      const refByRegistration = new Map(competition.participants.map((p) => [p.registrationId, p]));
      const matchDocs = this.#buildMatchDocs(built.bracket.matches, nextCompetition, tournamentId, competition.format, refByRegistration, now);
      const nextState = this.#deriveState(matchDocs, built.swiss);
      await this.#matches(uow.db).insertMany(matchDocs, { session: uow.session });

      const updated = await this.#competitions(uow.db).updateOne(
        { _id: competition._id, version: input.expectedVersion, lockState: { $ne: 'locked' } },
        { $set: { seed, participants: orderedParticipants, swiss: built.swiss, activeVersion: newNumber, state: nextState, updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (updated.matchedCount === 0) throw new ConflictError('COMPETITION_VERSION_STALE', 'This competition changed since you opened it. Reload and retry.');

      await this.#createVersion(uow, { ...nextCompetition, state: nextState }, newNumber, 'regeneration', input.reason.trim(), null, now);
      await this.#recalculate(uow, competition._id, now);

      uow.audit({ action: 'competition.regenerated', resourceType: 'competition', resourceId: competition._id, before: { activeVersion: competition.activeVersion }, after: { activeVersion: newNumber, matchCount: matchDocs.length }, reason: input.reason.trim() });
      uow.publish({ eventName: 'competition.regenerated', eventVersion: 1, aggregateId: competition._id, payload: { tournamentId, activeVersion: newNumber } });
      return { ...nextCompetition, state: nextState, version: competition.version + 1, updatedAt: now };
    });
  }

  /**
   * Rolls the bracket back to a superseded version, restoring its matches (with the
   * results recorded at supersede time) as a new active version. The current active
   * version is snapshotted first, so rollback is itself reversible and no history is
   * lost. Destructive/result-changing: requires confirmation, reason, an unlocked
   * competition, and the competition version guard.
   */
  async rollback(context: RequestContext, tournamentId: EntityId, input: { expectedVersion: number; targetVersion: number; reason: string; confirm: boolean }): Promise<CompetitionRecord> {
    if (input.reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    if (input.confirm !== true) throw new ValidationError('Rollback must be confirmed.', [{ field: 'confirm', code: 'CONFIRMATION_REQUIRED', message: 'Confirm this destructive action.' }]);
    const competition = await this.#competitions().findOne({ tournamentId });
    if (competition === null) throw new NotFoundError('No competition.');
    if (competition.lockState === 'locked') throw new ConflictError('COMPETITION_LOCKED', 'This competition is finalized; unlock it before rolling back.');
    const target = await this.#versions().findOne({ competitionId: competition._id, versionNumber: input.targetVersion });
    if (target === null) throw new NotFoundError('Unknown bracket version.');
    if (target.state !== 'superseded') throw new ConflictError('VERSION_NOT_RESTORABLE', 'Only a superseded version can be restored.');

    const newNumber = competition.activeVersion + 1;
    const restored: MatchRecord[] = target.matchesSnapshot.map((m) => ({ ...m }));
    // Restore the version's seed order too, so public seed labels match the restored
    // bracket (and a later regeneration reseeds from the restored configuration).
    const restoredParticipants = target.participantsSnapshot;
    const restoredSeed = target.seed;
    let swiss = competition.swiss;
    if (swiss !== null) swiss = { targetRounds: swiss.targetRounds, currentRound: restored.reduce((mx, m) => Math.max(mx, m.round), 1) };
    const nextState = this.#deriveState(restored, swiss);
    const restoredCompetition: CompetitionRecord = { ...competition, seed: restoredSeed, participants: restoredParticipants, swiss, activeVersion: newNumber, state: nextState };

    return runUnitOfWork(this.#database, context, async (uow) => {
      const now = utcNow();
      const fresh = await this.#competitions(uow.db).findOne({ _id: competition._id }, { session: uow.session });
      if (fresh !== null && fresh.lockState === 'locked') throw new ConflictError('COMPETITION_LOCKED', 'This competition is finalized; unlock it before rolling back.');

      await this.#supersedeActive(uow, competition, now);
      await this.#matches(uow.db).deleteMany({ competitionId: competition._id }, { session: uow.session });
      if (restored.length > 0) await this.#matches(uow.db).insertMany(restored.map((m) => ({ ...m, updatedAt: now })), { session: uow.session });

      const updated = await this.#competitions(uow.db).updateOne(
        { _id: competition._id, version: input.expectedVersion, lockState: { $ne: 'locked' } },
        { $set: { seed: restoredSeed, participants: restoredParticipants, swiss, activeVersion: newNumber, state: nextState, updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (updated.matchedCount === 0) throw new ConflictError('COMPETITION_VERSION_STALE', 'This competition changed since you opened it. Reload and retry.');

      await this.#createVersion(uow, restoredCompetition, newNumber, 'rollback', input.reason.trim(), input.targetVersion, now);
      await this.#recalculate(uow, competition._id, now);

      uow.audit({ action: 'competition.rolled_back', resourceType: 'competition', resourceId: competition._id, before: { activeVersion: competition.activeVersion }, after: { activeVersion: newNumber, rolledBackFrom: input.targetVersion }, reason: input.reason.trim() });
      uow.publish({ eventName: 'competition.rolled_back', eventVersion: 1, aggregateId: competition._id, payload: { tournamentId, activeVersion: newNumber, rolledBackFrom: input.targetVersion } });
      return { ...restoredCompetition, version: competition.version + 1, updatedAt: now };
    });
  }

  /** Immutable version history (metadata only; match snapshots are omitted from the list). */
  async listVersions(tournamentId: EntityId): Promise<Array<Omit<BracketVersionRecord, 'matchesSnapshot'> & { matchCount: number }>> {
    const competition = await this.#competitions().findOne({ tournamentId });
    if (competition === null) return [];
    const versions = await this.#versions().find({ competitionId: competition._id }).sort({ versionNumber: 1 }).toArray();
    return versions.map(({ matchesSnapshot, ...rest }) => ({ ...rest, matchCount: matchesSnapshot.length }));
  }
}
