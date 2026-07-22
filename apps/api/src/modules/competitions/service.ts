import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork, type UnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import type { TournamentRecord } from '../tournaments/index.ts';
import { COMPETITIONS_COLLECTIONS } from './collections.ts';
import { generateRoundRobin, generateSingleElimination, seedOrder, type Bracket, type EngineMatch } from './engine.ts';
import { generateDoubleElimination } from './double-elimination.ts';
import { swissPairKey, swissPairRound } from './swiss.ts';
import { buildManual, type ManualGraphSpec } from './manual.ts';
import { validateCompetitionConfig } from './validation.ts';
import {
  canRecordResult,
  type CompetitionFormat,
  type CompetitionRecord,
  type MatchRecord,
  type ParticipantRef
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

    let bracket: Bracket;
    let swiss: CompetitionRecord['swiss'] = null;
    if (format === 'single_elimination') {
      bracket = generateSingleElimination(seeded);
    } else if (format === 'round_robin') {
      bracket = generateRoundRobin(seeded, legs);
    } else if (format === 'double_elimination') {
      bracket = generateDoubleElimination(seeded);
    } else if (format === 'swiss') {
      const targetRounds = this.#swissTargetRounds(options.targetRounds, seeded.length);
      const result = swissPairRound({ order: seeded, wins: new Map(), priorPairs: new Set(), byeCounts: new Map() });
      bracket = { format: 'swiss', rounds: targetRounds, matches: this.#swissRoundMatches(1, result.pairs, result.bye) };
      swiss = { targetRounds, currentRound: 1 };
    } else {
      if (options.manualGraph === undefined) {
        throw new ValidationError('A custom competition requires a graph.', [{ field: 'graph', code: 'MANUAL_GRAPH_REQUIRED', message: 'Provide the competition graph.' }]);
      }
      bracket = buildManual(options.manualGraph, seeded);
    }

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
      swiss,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    const refByRegistration = new Map(participants.map((p) => [p.registrationId, p]));
    const matchDocs = this.#buildMatchDocs(bracket.matches, competition, tournamentId, format, refByRegistration, now);

    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#competitions(uow.db).insertOne(competition, { session: uow.session });
        await this.#matches(uow.db).insertMany(matchDocs, { session: uow.session });
        uow.audit({ action: 'competition.generated', resourceType: 'competition', resourceId: competition._id, after: { tournamentId, format, participantCount: competition.participantCount, matchCount: matchDocs.length } });
        uow.publish({ eventName: 'competition.generated', eventVersion: 1, aggregateId: competition._id, payload: { tournamentId, format, participantCount: competition.participantCount } });
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictError('COMPETITION_EXISTS', 'A competition has already been generated for this tournament.');
      throw error;
    }
    return competition;
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

  // --- Reads ---

  async getCompetition(tournamentId: EntityId): Promise<CompetitionRecord | null> {
    return this.#competitions().findOne({ tournamentId });
  }

  async listMatches(competitionId: EntityId): Promise<MatchRecord[]> {
    return this.#matches().find({ competitionId }).sort({ round: 1, index: 1 }).toArray();
  }
}
