import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork, type UnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import type { TournamentRecord } from '../tournaments/index.ts';
import { COMPETITIONS_COLLECTIONS } from './collections.ts';
import { generateRoundRobin, generateSingleElimination, seedOrder, type Bracket } from './engine.ts';
import { validateCompetitionConfig } from './validation.ts';
import {
  canRecordResult,
  type CompetitionRecord,
  type MatchRecord,
  type ParticipantRef
} from './state.ts';

/**
 * Competition service (DRAGON-09a): generates a single-elimination bracket or a
 * round-robin schedule from a tournament's approved registrations, and records
 * match results with deterministic single-elimination advancement.
 *
 * Database guarantees:
 * - Concurrent generation collapses to one competition via a unique index on
 *   tournamentId (no duplicate competition state).
 * - A result is recorded under an optimistic (version + state) guard, so concurrent
 *   progression on the same match yields one success and one conflict, a result is
 *   applied at most once, and a match never advances without an accepted result.
 * All writes go through runUnitOfWork (transactional audit + outbox event).
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

  /** Generates the competition for a tournament from its approved registrations. */
  async generate(context: RequestContext, tournamentId: EntityId, options: GenerateOptions = {}): Promise<CompetitionRecord> {
    const tournament = await this.#tournaments.getById(tournamentId);
    if (tournament === null || tournament.state !== 'published') throw new NotFoundError('Unknown tournament.');

    const participants = await this.#registrations.listApprovedParticipants(tournamentId);
    const participantIds = participants.map((p) => p.registrationId);
    const { format, legs } = validateCompetitionConfig({ format: tournament.format, participantIds, ...(options.legs === undefined ? {} : { legs: options.legs }) });

    const seed = options.seed ?? tournamentId;
    const seeded = seedOrder(participantIds, seed);
    const bracket: Bracket = format === 'single_elimination' ? generateSingleElimination(seeded) : generateRoundRobin(seeded, legs);

    const refByRegistration = new Map(participants.map((p) => [p.registrationId, p]));
    const now = utcNow();
    const competition: CompetitionRecord = {
      _id: newId(),
      tournamentId,
      format,
      seed,
      legs,
      participantCount: participantIds.length,
      state: 'generated',
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    // Stable opaque id per logical match key; the deterministic structure is the
    // engine's, the ids are opaque and assigned here (DATA-001, BRACKET-016).
    const idByKey = new Map(bracket.matches.map((m) => [m.key, newId()]));
    const matchDocs: MatchRecord[] = bracket.matches.map((m) => {
      const slotA = m.a === null ? null : refByRegistration.get(m.a) ?? null;
      const slotB = m.b === null ? null : refByRegistration.get(m.b) ?? null;
      const winner = m.winner === null ? null : refByRegistration.get(m.winner) ?? null;
      const state = m.bye ? 'bye' : slotA !== null && slotB !== null ? 'ready' : 'pending';
      return {
        _id: idByKey.get(m.key) as string,
        competitionId: competition._id,
        tournamentId,
        format,
        round: m.round,
        index: m.index,
        slotA,
        slotB,
        state,
        winner,
        scoreA: null,
        scoreB: null,
        nextMatchId: m.nextKey === null ? null : idByKey.get(m.nextKey) ?? null,
        nextSlot: m.nextSlot,
        version: 1,
        createdAt: now,
        updatedAt: now
      };
    });

    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#competitions(uow.db).insertOne(competition, { session: uow.session });
        await this.#matches(uow.db).insertMany(matchDocs, { session: uow.session });
        uow.audit({
          action: 'competition.generated',
          resourceType: 'competition',
          resourceId: competition._id,
          after: { tournamentId, format, participantCount: competition.participantCount, matchCount: matchDocs.length }
        });
        uow.publish({ eventName: 'competition.generated', eventVersion: 1, aggregateId: competition._id, payload: { tournamentId, format, participantCount: competition.participantCount } });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictError('COMPETITION_EXISTS', 'A competition has already been generated for this tournament.');
      }
      throw error;
    }
    return competition;
  }

  /**
   * Records a match result. `winnerSlot` names the winning side. Idempotent for an
   * already-recorded identical result; a conflicting or concurrent write is a 409;
   * a single-elimination winner is advanced into its next match atomically.
   */
  async recordResult(
    context: RequestContext,
    tournamentId: EntityId,
    matchId: EntityId,
    input: { winnerSlot: 'a' | 'b'; scoreA?: number; scoreB?: number }
  ): Promise<MatchRecord> {
    const match = await this.#matches().findOne({ _id: matchId, tournamentId });
    if (match === null) throw new NotFoundError('Unknown match.');

    const winner = input.winnerSlot === 'a' ? match.slotA : match.slotB;

    if (match.state === 'completed') {
      // Same result replayed → idempotent; a different result → conflict.
      if (winner !== null && match.winner !== null && match.winner.registrationId === winner.registrationId) return match;
      throw new ConflictError('RESULT_ALREADY_RECORDED', 'A different result was already recorded for this match.');
    }
    if (!canRecordResult(match.state)) {
      throw new ConflictError('MATCH_NOT_READY', 'This match is not awaiting a result.');
    }
    if (winner === null) {
      throw new ValidationError('The winning slot is empty.', [{ field: 'winnerSlot', code: 'INVALID_WINNER', message: 'Choose a filled slot.' }]);
    }

    return runUnitOfWork(this.#database, context, async (uow) => {
      const now = utcNow();
      const claimed = await this.#matches(uow.db).updateOne(
        { _id: matchId, version: match.version, state: 'ready' },
        { $set: { state: 'completed', winner, scoreA: input.scoreA ?? null, scoreB: input.scoreB ?? null, updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      // The version+state guard makes concurrent progression safe: the loser matches nothing.
      if (claimed.matchedCount === 0) throw new ConflictError('RESULT_STALE', 'This match changed. Reload and retry.');

      await this.#advance(uow, match, winner, now);

      // First result moves the competition to in_progress; the last completes it.
      await this.#competitions(uow.db).updateOne({ _id: match.competitionId, state: 'generated' }, { $set: { state: 'in_progress', updatedAt: now } }, { session: uow.session });
      const remaining = await this.#matches(uow.db).countDocuments({ competitionId: match.competitionId, state: { $in: ['ready', 'pending'] } }, { session: uow.session });
      if (remaining === 0) {
        await this.#competitions(uow.db).updateOne({ _id: match.competitionId }, { $set: { state: 'completed', updatedAt: now } }, { session: uow.session });
      }

      uow.audit({
        action: 'competition.match_completed',
        resourceType: 'match',
        resourceId: matchId,
        before: { state: match.state },
        after: { state: 'completed', winner: winner.registrationId }
      });
      uow.publish({ eventName: 'competition.match_completed', eventVersion: 1, aggregateId: matchId, payload: { tournamentId, competitionId: match.competitionId, winner: winner.registrationId } });

      return { ...match, state: 'completed', winner, scoreA: input.scoreA ?? null, scoreB: input.scoreB ?? null, version: match.version + 1, updatedAt: now };
    });
  }

  /** Advances a single-elimination winner into its next-round slot (never for round robin). */
  async #advance(uow: UnitOfWork, match: MatchRecord, winner: ParticipantRef, now: string): Promise<void> {
    if (match.nextMatchId === null || match.nextSlot === null) return;
    const slotField = match.nextSlot === 'a' ? 'slotA' : 'slotB';
    await this.#matches(uow.db).updateOne({ _id: match.nextMatchId }, { $set: { [slotField]: winner, updatedAt: now } }, { session: uow.session });
    // Promote the next match to ready once both slots are filled (never skips a result).
    await this.#matches(uow.db).updateOne(
      { _id: match.nextMatchId, slotA: { $ne: null }, slotB: { $ne: null }, state: 'pending' },
      { $set: { state: 'ready', updatedAt: now } },
      { session: uow.session }
    );
  }

  // --- Reads ---

  async getCompetition(tournamentId: EntityId): Promise<CompetitionRecord | null> {
    return this.#competitions().findOne({ tournamentId });
  }

  async listMatches(competitionId: EntityId): Promise<MatchRecord[]> {
    return this.#matches().find({ competitionId }).sort({ round: 1, index: 1 }).toArray();
  }
}
