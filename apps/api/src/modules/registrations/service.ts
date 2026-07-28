import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork, type UnitOfWork } from '../../shared/db/unit-of-work.ts';
import { withIdempotency } from '../../shared/db/idempotency.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import { MAX_CAPACITY, type TournamentRecord } from '../tournaments/index.ts';
import { REGISTRATIONS_COLLECTIONS } from './collections.ts';
import {
  canRegistrationTransition,
  isActiveState,
  seatOf,
  type RegistrationRecord,
  type RegistrationState,
  type SeatCounterRecord
} from './state.ts';
import { buildAnswers, eligibilityProblems } from './validation.ts';

/**
 * Tournament registration service (TOURN-004..017 registration scope).
 *
 * Concurrency invariants are enforced by the database, never by read-before-write:
 * - Capacity (TOURN-005): a main seat is claimed by an atomic conditional `$inc`
 *   on a per-tournament counter (`mainCount < capacity`); a concurrent last-slot
 *   race is serialized on that one document, so it can never overbook.
 * - Duplicate prevention (TOURN-009): a partial unique index on
 *   (tournamentId, subjectId) where `active: true` guarantees one active entry.
 * - Idempotent submit (TOURN-013): `withIdempotency` returns the stored result on
 *   replay and rejects an in-flight duplicate.
 * - Deterministic waitlist order (TOURN-006): positions come from a monotonic
 *   `$inc` on the counter, so promotion is by strictly increasing waitlistSeq.
 * Paid registration and refund execution stay disabled (OD-007): a non-free
 * tournament rejects registration until DRAGON-11/12.
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

/** UTC whole-years age from an ISO date (YYYY-MM-DD); null if unparseable. */
function ageFrom(birthDate: string | undefined, now: Date): number | null {
  if (birthDate === undefined) return null;
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

export interface TournamentAccess {
  getById(id: EntityId): Promise<TournamentRecord | null>;
  /** Whether a visitor may read a tournament in this state (published, completed, cancelled). */
  isPubliclyReadable(state: TournamentRecord['state']): boolean;
}
export interface ProfileAccess {
  getProfile(accountId: EntityId): Promise<{ birthDate: string } | null>;
  /** Batch display-name resolver for individual entrants (public-safe fields only). */
  getPublicIdentities(accountIds: readonly EntityId[]): Promise<Map<EntityId, { username: string; displayName: string }>>;
}
export interface TeamAccess {
  captureRosterSnapshot(context: RequestContext, actorId: string, teamId: string, reason: string): Promise<{ _id: string }>;
  hasGamingIdentity(accountId: string, gameId: string): Promise<boolean>;
  /** Batch team summary resolver for team entrants (name, slug for linking, logo). */
  getTeamSummaries(teamIds: readonly EntityId[]): Promise<Map<EntityId, { name: string; slug: string; avatarUrl: string | null }>>;
}

/** A participant's display identity, resolved from the account (individual) or team. */
export interface ParticipantName {
  registrationId: EntityId;
  participantType: 'individual' | 'team';
  /** Team name, or an individual's display name; null when the record can no longer resolve. */
  name: string | null;
  /** Individual entrant's username, for a public player link; null for a team entry. */
  username: string | null;
  /** Team entry's slug, for a public team link; null for an individual entry. */
  teamSlug: string | null;
}

export interface RegisterInput {
  teamId?: string;
  answers?: Array<{ key: string; value: string }>;
  idempotencyKey: string;
}

/** Validated paid-registration data the checkout persists atomically (DRAGON-12). */
export interface PreparedPaidRegistration {
  tournamentId: string;
  capacity: number;
  actorId: string;
  teamId: string | null;
  subjectId: string;
  participantType: 'individual' | 'team';
  answers: RegistrationRecord['answers'];
  questionVersion: number;
  rosterSnapshotId: string | null;
}

export class RegistrationsService {
  readonly #database: Database;
  readonly #tournaments: TournamentAccess;
  readonly #profiles: ProfileAccess;
  readonly #teams: TeamAccess;

  constructor(database: Database, tournaments: TournamentAccess, profiles: ProfileAccess, teams: TeamAccess) {
    this.#database = database;
    this.#tournaments = tournaments;
    this.#profiles = profiles;
    this.#teams = teams;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #registrations(db: Db = this.#db) {
    return db.collection<RegistrationRecord>(REGISTRATIONS_COLLECTIONS.registrations);
  }
  #seats(db: Db) {
    return db.collection<SeatCounterRecord>(REGISTRATIONS_COLLECTIONS.seatCounters);
  }

  // --- Seat counter primitives (atomic, race-safe) ---

  async #ensureSeatCounter(uow: UnitOfWork, tournamentId: string, capacity: number): Promise<void> {
    await this.#seats(uow.db).updateOne(
      { _id: tournamentId },
      { $setOnInsert: { _id: tournamentId, capacity, mainCount: 0, waitlistSeq: 0 } },
      { upsert: true, session: uow.session }
    );
  }

  /** Claims a main seat iff mainCount < capacity. Returns true on success. */
  async #claimMainSeat(uow: UnitOfWork, tournamentId: string, capacity: number): Promise<boolean> {
    await this.#ensureSeatCounter(uow, tournamentId, capacity);
    const claimed = await this.#seats(uow.db).findOneAndUpdate(
      { _id: tournamentId, mainCount: { $lt: capacity } },
      { $inc: { mainCount: 1 } },
      { session: uow.session, returnDocument: 'after' }
    );
    return claimed !== null;
  }

  async #releaseMainSeat(uow: UnitOfWork, tournamentId: string): Promise<void> {
    await this.#seats(uow.db).updateOne(
      { _id: tournamentId, mainCount: { $gt: 0 } },
      { $inc: { mainCount: -1 } },
      { session: uow.session }
    );
  }

  async #nextWaitlistSeq(uow: UnitOfWork, tournamentId: string, capacity: number): Promise<number> {
    await this.#ensureSeatCounter(uow, tournamentId, capacity);
    const updated = await this.#seats(uow.db).findOneAndUpdate(
      { _id: tournamentId },
      { $inc: { waitlistSeq: 1 } },
      { session: uow.session, returnDocument: 'after' }
    );
    return updated?.waitlistSeq ?? 1;
  }

  // --- Registration submission (TOURN-005/007/008/009/010/013) ---

  async register(context: RequestContext, actorId: string, tournamentId: string, input: RegisterInput): Promise<RegistrationRecord> {
    const tournament = await this.#tournaments.getById(tournamentId);
    // A non-published tournament is indistinguishable from a missing one.
    if (tournament === null || tournament.state !== 'published') throw new NotFoundError('Unknown tournament.');

    // OD-007: paid registration and refund execution are disabled until DRAGON-11/12.
    if (tournament.fee.kind !== 'free') {
      throw new ValidationError('Paid registration is not available yet.', [
        { field: 'fee', code: 'PAYMENT_NOT_AVAILABLE', message: 'Paid tournament registration arrives in a later release.' }
      ]);
    }

    const participantType = input.teamId !== undefined ? 'team' : 'individual';
    const subjectId = input.teamId ?? actorId;

    const profile = await this.#profiles.getProfile(actorId);
    const facts = {
      tournament,
      now: new Date(),
      participantType: participantType as 'individual' | 'team',
      hasCompleteProfile: profile !== null,
      age: ageFrom(profile?.birthDate, new Date()),
      hasGameIdentity: await this.#teams.hasGamingIdentity(actorId, tournament.gameId)
    };
    const problems = eligibilityProblems(facts);
    if (problems.length > 0) throw new ValidationError('You are not eligible to register.', problems);

    const { answers, version } = buildAnswers(tournament.questionSet, input.answers);

    // Team entry: capture an immutable roster snapshot. This also enforces that only
    // the team owner may register the team (TOURN-009) — captureRosterSnapshot throws
    // ForbiddenError for a non-owner and requires an active team.
    let rosterSnapshotId: string | null = null;
    if (participantType === 'team') {
      const snapshot = await this.#teams.captureRosterSnapshot(context, actorId, input.teamId as string, 'Tournament registration roster snapshot.');
      rosterSnapshotId = snapshot._id;
    }

    const outcome = await withIdempotency(
      this.#db,
      { scope: `registration:${tournamentId}`, key: input.idempotencyKey, request: { subjectId, answers } },
      () => this.#createRegistration(context, {
        tournament,
        actorId,
        teamId: input.teamId ?? null,
        subjectId,
        participantType: participantType as 'individual' | 'team',
        answers,
        questionVersion: version,
        rosterSnapshotId
      })
    );
    return outcome.result;
  }

  // --- Paid registration (DRAGON-12): the checkout owns activation atomically ---

  /**
   * Validates a paid registration's eligibility and captures its answers/roster,
   * returning the data the checkout persists. No write happens here; the checkout
   * reserves the seat and activates the registration inside its own transaction.
   */
  async preparePaidRegistration(context: RequestContext, actorId: string, tournamentId: string, input: RegisterInput): Promise<PreparedPaidRegistration> {
    const tournament = await this.#tournaments.getById(tournamentId);
    if (tournament === null || tournament.state !== 'published') throw new NotFoundError('Unknown tournament.');
    if (tournament.fee.kind === 'free') throw new ValidationError('This tournament is free.', [{ field: 'fee', code: 'FREE_TOURNAMENT', message: 'Register directly; no checkout is needed.' }]);

    const participantType: 'individual' | 'team' = input.teamId !== undefined ? 'team' : 'individual';
    const subjectId = input.teamId ?? actorId;
    const profile = await this.#profiles.getProfile(actorId);
    const problems = eligibilityProblems({
      tournament,
      now: new Date(),
      participantType,
      hasCompleteProfile: profile !== null,
      age: ageFrom(profile?.birthDate, new Date()),
      hasGameIdentity: await this.#teams.hasGamingIdentity(actorId, tournament.gameId)
    });
    if (problems.length > 0) throw new ValidationError('You are not eligible to register.', problems);
    const { answers, version } = buildAnswers(tournament.questionSet, input.answers);
    let rosterSnapshotId: string | null = null;
    if (participantType === 'team') {
      const snapshot = await this.#teams.captureRosterSnapshot(context, actorId, input.teamId as string, 'Tournament registration roster snapshot.');
      rosterSnapshotId = snapshot._id;
    }
    return { tournamentId: tournament._id, capacity: tournament.capacity, actorId, teamId: input.teamId ?? null, subjectId, participantType, answers, questionVersion: version, rosterSnapshotId };
  }

  /** Reserves a main seat and inserts a `pending_payment` registration inside the caller's transaction. */
  async reservePaidRegistrationWithin(uow: UnitOfWork, prepared: PreparedPaidRegistration): Promise<RegistrationRecord> {
    const gotSeat = await this.#claimMainSeat(uow, prepared.tournamentId, prepared.capacity);
    if (!gotSeat) throw new ConflictError('TOURNAMENT_FULL', 'This tournament is full.');
    const now = utcNow();
    const record: RegistrationRecord = {
      _id: newId(),
      tournamentId: prepared.tournamentId,
      participantType: prepared.participantType,
      accountId: prepared.actorId,
      teamId: prepared.teamId,
      subjectId: prepared.subjectId,
      state: 'pending_payment',
      active: true,
      seat: 'main',
      answers: prepared.answers,
      questionVersion: prepared.questionVersion,
      rosterSnapshotId: prepared.rosterSnapshotId,
      waitlistSeq: null,
      createdAt: now,
      updatedAt: now,
      decidedBy: null,
      decidedAt: null,
      reason: null,
      version: 1
    };
    await this.#registrations(uow.db).insertOne(record, { session: uow.session });
    this.#audit(uow, record, 'tournament.registration.pending_payment', null);
    this.#publish(uow, record, 'tournament.registration.pending_payment');
    return record;
  }

  /** Activates a reserved paid registration (`pending_payment` → `approved`) inside the caller's transaction. */
  async activatePaidRegistrationWithin(uow: UnitOfWork, registrationId: string): Promise<RegistrationRecord> {
    return this.#transitionPaidWithin(uow, registrationId, 'approved', 'system');
  }

  /** Cancels a reserved paid registration (`pending_payment` → `cancelled`), releasing its seat. */
  async cancelPaidRegistrationWithin(uow: UnitOfWork, registrationId: string, reason: string): Promise<RegistrationRecord> {
    return this.#transitionPaidWithin(uow, registrationId, 'cancelled', reason);
  }

  async #transitionPaidWithin(uow: UnitOfWork, registrationId: string, to: 'approved' | 'cancelled', reason: string): Promise<RegistrationRecord> {
    const reg = await this.#registrations(uow.db).findOne({ _id: registrationId }, { session: uow.session });
    if (reg === null) throw new NotFoundError('Unknown registration.');
    if (reg.state === to) return reg; // idempotent
    if (reg.state !== 'pending_payment' || !canRegistrationTransition(reg.state, to)) throw new ConflictError('INVALID_REGISTRATION_TRANSITION', `Cannot move a registration from ${reg.state} to ${to}.`);
    if (to === 'cancelled' && reg.seat === 'main') await this.#releaseMainSeat(uow, reg.tournamentId);
    const now = utcNow();
    const updated = await this.#registrations(uow.db).updateOne(
      { _id: registrationId, state: 'pending_payment', version: reg.version },
      { $set: { state: to, active: isActiveState(to), seat: seatOf(to), decidedBy: to === 'approved' ? 'system' : null, decidedAt: now, reason: to === 'cancelled' ? reason : null, updatedAt: now }, $inc: { version: 1 } },
      { session: uow.session }
    );
    if (updated.matchedCount === 0) throw new ConflictError('INVALID_REGISTRATION_TRANSITION', 'The registration changed. Reload and retry.');
    const next: RegistrationRecord = { ...reg, state: to, active: isActiveState(to), seat: seatOf(to), decidedBy: to === 'approved' ? 'system' : null, decidedAt: now, reason: to === 'cancelled' ? reason : null, updatedAt: now, version: reg.version + 1 };
    this.#audit(uow, next, `tournament.registration.${to}`, reg);
    this.#publish(uow, next, `tournament.registration.${to}`);
    return next;
  }

  async #createRegistration(
    context: RequestContext,
    input: {
      tournament: TournamentRecord;
      actorId: string;
      teamId: string | null;
      subjectId: string;
      participantType: 'individual' | 'team';
      answers: RegistrationRecord['answers'];
      questionVersion: number;
      rosterSnapshotId: string | null;
    }
  ): Promise<RegistrationRecord> {
    const t = input.tournament;
    try {
      return await runUnitOfWork(this.#database, context, async (uow) => {
        let state: RegistrationState;
        let waitlistSeq: number | null = null;

        if (t.approvalMode === 'automatic') {
          const gotSeat = await this.#claimMainSeat(uow, t._id, t.capacity);
          if (gotSeat) {
            state = 'approved';
          } else if (t.waitlistMode === 'enabled') {
            state = 'waitlisted';
            waitlistSeq = await this.#nextWaitlistSeq(uow, t._id, t.capacity);
          } else {
            throw new ConflictError('TOURNAMENT_FULL', 'This tournament is full.');
          }
        } else {
          // Manual approval: created pending; a seat is claimed at approval time.
          state = 'pending';
        }

        const now = utcNow();
        const record: RegistrationRecord = {
          _id: newId(),
          tournamentId: t._id,
          participantType: input.participantType,
          accountId: input.actorId,
          teamId: input.teamId,
          subjectId: input.subjectId,
          state,
          active: true,
          seat: seatOf(state),
          answers: input.answers,
          questionVersion: input.questionVersion,
          rosterSnapshotId: input.rosterSnapshotId,
          waitlistSeq,
          createdAt: now,
          updatedAt: now,
          decidedBy: state === 'approved' && t.approvalMode === 'automatic' ? 'system' : null,
          decidedAt: state === 'approved' && t.approvalMode === 'automatic' ? now : null,
          reason: null,
          version: 1
        };
        await this.#registrations(uow.db).insertOne(record, { session: uow.session });
        this.#audit(uow, record, 'tournament.registration.submitted', null);
        this.#publish(uow, record, `tournament.registration.${state}`);
        return record;
      });
    } catch (error) {
      // A concurrent active registration for the same participant lost the unique
      // index; the whole transaction (including any seat claim) rolled back.
      if (isDuplicateKey(error)) {
        throw new ConflictError('DUPLICATE_REGISTRATION', 'There is already an active registration for this participant.');
      }
      throw error;
    }
  }

  // --- Administrative decisions (TOURN-004/006/014/015) ---

  /** Approves a pending or waitlisted registration, claiming a main seat atomically. */
  async approve(context: RequestContext, adminId: string, tournamentId: string, registrationId: string, reason: string | null): Promise<RegistrationRecord> {
    return this.#decide(context, adminId, tournamentId, registrationId, 'approved', reason, async (uow, reg, t) => {
      const gotSeat = await this.#claimMainSeat(uow, t._id, t.capacity);
      if (!gotSeat) throw new ConflictError('TOURNAMENT_FULL', 'No seats are available. A seat must be released first.');
      return { seat: 'main' as const, waitlistSeq: null };
    });
  }

  async reject(context: RequestContext, adminId: string, tournamentId: string, registrationId: string, reason: string): Promise<RegistrationRecord> {
    if (reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    return this.#decide(context, adminId, tournamentId, registrationId, 'rejected', reason, async (uow, reg) => {
      if (reg.seat === 'main') await this.#releaseMainSeat(uow, reg.tournamentId);
      return { seat: 'none' as const, waitlistSeq: null };
    });
  }

  async waitlist(context: RequestContext, adminId: string, tournamentId: string, registrationId: string, reason: string | null): Promise<RegistrationRecord> {
    return this.#decide(context, adminId, tournamentId, registrationId, 'waitlisted', reason, async (uow, reg, t) => {
      if (reg.seat === 'main') await this.#releaseMainSeat(uow, reg.tournamentId);
      const waitlistSeq = await this.#nextWaitlistSeq(uow, t._id, t.capacity);
      return { seat: 'waitlist' as const, waitlistSeq };
    });
  }

  /** Promotion is an approval of a waitlisted registration (TOURN-006). */
  async promote(context: RequestContext, adminId: string, tournamentId: string, registrationId: string, reason: string | null): Promise<RegistrationRecord> {
    return this.approve(context, adminId, tournamentId, registrationId, reason);
  }

  /** Cancellation by an administrator or by the participant themselves (TOURN-016). */
  async cancel(context: RequestContext, actorId: string, tournamentId: string, registrationId: string, options: { asAdmin: boolean; reason: string | null }): Promise<RegistrationRecord> {
    return this.#decide(context, actorId, tournamentId, registrationId, 'cancelled', options.reason, async (uow, reg) => {
      if (reg.seat === 'main') await this.#releaseMainSeat(uow, reg.tournamentId);
      return { seat: 'none' as const, waitlistSeq: null };
    }, { requireOwn: !options.asAdmin });
  }

  async #decide(
    context: RequestContext,
    actorId: string,
    tournamentId: string,
    registrationId: string,
    to: RegistrationState,
    reason: string | null,
    apply: (uow: UnitOfWork, reg: RegistrationRecord, tournament: TournamentRecord) => Promise<{ seat: RegistrationRecord['seat']; waitlistSeq: number | null }>,
    guards: { requireOwn?: boolean } = {}
  ): Promise<RegistrationRecord> {
    const tournament = await this.#tournaments.getById(tournamentId);
    if (tournament === null) throw new NotFoundError('Unknown tournament.');

    return runUnitOfWork(this.#database, context, async (uow) => {
      const reg = await this.#registrations(uow.db).findOne({ _id: registrationId, tournamentId }, { session: uow.session });
      if (reg === null) throw new NotFoundError('Unknown registration.');
      // A participant may only cancel their own entry (IDOR guard on the self path).
      if (guards.requireOwn === true && reg.accountId !== actorId) throw new NotFoundError('Unknown registration.');
      // A payment-pending registration is owned entirely by the checkout flow (DRAGON-12):
      // the generic admin/self decision path must never approve it (which would grant a seat
      // and activate it without the fee, double-claiming capacity) or cancel it (orphaning the
      // checkout hold). Callers act through the checkout, which uses its own within-uow path.
      if (reg.state === 'pending_payment') {
        throw new ConflictError('REGISTRATION_PAYMENT_PENDING', 'This registration is completing payment and is managed by checkout.');
      }
      if (!canRegistrationTransition(reg.state, to)) {
        throw new ConflictError('INVALID_REGISTRATION_TRANSITION', `Cannot move a registration from ${reg.state} to ${to}.`);
      }

      const applied = await apply(uow, reg, tournament);
      const now = utcNow();
      const next: RegistrationRecord = {
        ...reg,
        state: to,
        // Single source of truth for the duplicate-prevention flag (TOURN-009).
        active: isActiveState(to),
        seat: applied.seat,
        waitlistSeq: applied.waitlistSeq,
        decidedBy: actorId,
        decidedAt: now,
        reason: reason ?? reg.reason,
        updatedAt: now,
        version: reg.version + 1
      };
      const result = await this.#registrations(uow.db).replaceOne(
        { _id: registrationId, version: reg.version },
        next,
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('REGISTRATION_STALE', 'This registration changed. Reload and retry.');

      this.#audit(uow, next, `tournament.registration.${to}`, reg);
      this.#publish(uow, next, `tournament.registration.${to}`);
      return next;
    });
  }

  #audit(uow: UnitOfWork, reg: RegistrationRecord, action: string, previous: RegistrationRecord | null): void {
    uow.audit({
      action,
      resourceType: 'registration',
      resourceId: reg._id,
      before: previous === null ? null : { state: previous.state, seat: previous.seat },
      after: { state: reg.state, seat: reg.seat, subjectId: reg.subjectId },
      reason: reg.reason
    });
  }

  #publish(uow: UnitOfWork, reg: RegistrationRecord, eventName: string): void {
    uow.publish({
      eventName,
      eventVersion: 1,
      aggregateId: reg._id,
      payload: { tournamentId: reg.tournamentId, subjectId: reg.subjectId, state: reg.state }
    });
  }

  // --- Reads ---

  async getById(tournamentId: string, registrationId: string): Promise<RegistrationRecord | null> {
    return this.#registrations().findOne({ _id: registrationId, tournamentId });
  }

  /** The caller's own registration for a tournament (localized status is derived client-side). */
  async myRegistration(accountId: string, tournamentId: string): Promise<RegistrationRecord | null> {
    return this.#registrations()
      .find({ tournamentId, accountId })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();
  }

  /** Paginated admin queue (TOURN-006/014). Bounded query; no unbounded participant load. */
  async listForAdmin(tournamentId: string, query: { state?: RegistrationState; cursor?: string; limit?: number }): Promise<Page<RegistrationRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { tournamentId };
    if (query.state !== undefined) filter['state'] = query.state;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ createdAt: { $gt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    }
    const rows = await this.#registrations().find(filter).sort({ createdAt: 1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return {
      items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as RegistrationRecord),
      nextCursor: page.nextCursor
    };
  }

  /**
   * Approved registrations as competition participants (DRAGON-09 integration).
   * Only approved entries may enter a competition; each carries its immutable
   * registration-time roster snapshot for a team entry (TOURN-010).
   */
  /**
   * Every approved entrant, for bracket generation.
   *
   * This one deliberately does **not** paginate: generation needs the complete field, and
   * a silently truncated read would build a wrong bracket that looks correct. The cap is
   * therefore a tripwire rather than a page size — a tournament cannot exceed
   * {@link MAX_CAPACITY} approved seats, so exceeding it means the seat counter and the
   * registrations disagree, and failing loudly is the only safe outcome (DB-002).
   */
  async listApprovedParticipants(tournamentId: string): Promise<Array<{ registrationId: string; participantType: 'individual' | 'team'; teamId: string | null; rosterSnapshotId: string | null }>> {
    const rows = await this.#registrations()
      .find({ tournamentId, state: 'approved' })
      .sort({ createdAt: 1, _id: 1 })
      .limit(MAX_CAPACITY + 1)
      .toArray();
    if (rows.length > MAX_CAPACITY) {
      throw new ConflictError(
        'PARTICIPANTS_EXCEED_CAPACITY',
        `This tournament has more than ${String(MAX_CAPACITY)} approved participants, which should be impossible. Reconcile the seat counter before generating a bracket.`
      );
    }
    return rows.map((r) => ({ registrationId: r._id, participantType: r.participantType, teamId: r.teamId, rosterSnapshotId: r.rosterSnapshotId }));
  }

  /**
   * Resolves display names for a set of registrations in two batched lookups (one per
   * participant kind), so an admin queue or a public list never issues a query per row.
   */
  /**
   * The identity fields of specific registrations, for a caller that already holds their
   * ids — the competitions module joins bracket seeds onto participant names this way.
   * Returns only what {@link resolveNames} consumes, never the private answer set.
   */
  async listByIds(registrationIds: readonly EntityId[]): Promise<Array<Pick<RegistrationRecord, '_id' | 'participantType' | 'accountId' | 'teamId'>>> {
    if (registrationIds.length === 0) return [];
    return this.#registrations()
      .find({ _id: { $in: [...new Set(registrationIds)] } }, { projection: { _id: 1, participantType: 1, accountId: 1, teamId: 1 } })
      .toArray();
  }

  async resolveNames(rows: readonly Pick<RegistrationRecord, '_id' | 'participantType' | 'accountId' | 'teamId'>[]): Promise<Map<EntityId, ParticipantName>> {
    const accountIds = rows.filter((r) => r.participantType === 'individual').map((r) => r.accountId);
    const teamIds = rows.filter((r) => r.participantType === 'team' && r.teamId !== null).map((r) => r.teamId as EntityId);
    const [identities, teamSummaries] = await Promise.all([
      accountIds.length > 0 ? this.#profiles.getPublicIdentities(accountIds) : Promise.resolve(new Map()),
      teamIds.length > 0 ? this.#teams.getTeamSummaries(teamIds) : Promise.resolve(new Map())
    ]);
    const out = new Map<EntityId, ParticipantName>();
    for (const r of rows) {
      if (r.participantType === 'team') {
        const team = r.teamId !== null ? teamSummaries.get(r.teamId) : undefined;
        out.set(r._id, { registrationId: r._id, participantType: 'team', name: team?.name ?? null, username: null, teamSlug: team?.slug ?? null });
      } else {
        const id = identities.get(r.accountId);
        out.set(r._id, { registrationId: r._id, participantType: 'individual', name: id?.displayName ?? null, username: id?.username ?? null, teamSlug: null });
      }
    }
    return out;
  }

  /**
   * Public participant list: the approved entrants of a tournament with their display
   * names, but only when the tournament is published and the organizer has made the
   * list public. Any other case is indistinguishable from a missing tournament (404),
   * so a private list never leaks its existence or its members.
   */
  async listPublicParticipants(tournamentId: string, query: { cursor?: string; limit?: number } = {}): Promise<Page<ParticipantName>> {
    const tournament = await this.#tournaments.getById(tournamentId);
    // Readable for as long as the tournament itself is: the roster of a finished event is
    // part of its permanent record. The organizer's visibility switch still gates it.
    if (tournament === null || !this.#tournaments.isPubliclyReadable(tournament.state) || tournament.participantsPublic !== true) {
      throw new NotFoundError('Unknown tournament.');
    }
    // Paginated (DB-002): a 512-entrant field previously came back as one unbounded
    // payload, and the name resolution behind it ran over the whole roster at once.
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { tournamentId, state: 'approved' };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ createdAt: { $gt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    }
    const rows = await this.#registrations()
      .find(filter, { projection: { _id: 1, participantType: 1, accountId: 1, teamId: 1, createdAt: 1 } })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit + 1)
      .toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    // Names are resolved for the page only, so the two batched lookups stay bounded.
    const names = await this.resolveNames(page.items);
    return { items: page.items.map((r) => names.get(r._id) as ParticipantName), nextCursor: page.nextCursor };
  }

  /**
   * Registration counts by state for several tournaments at once.
   *
   * The organizer workspace shows a row per event with "N awaiting review"; asking per
   * tournament would be a query per row. One grouped aggregation answers the whole page,
   * and the id list is capped by the caller's route so it cannot be used to scan.
   */
  async countsByState(tournamentIds: readonly string[]): Promise<Map<string, Record<string, number>>> {
    if (tournamentIds.length === 0) return new Map();
    const rows = await this.#registrations()
      .aggregate<{ _id: { tournamentId: string; state: string }; n: number }>([
        { $match: { tournamentId: { $in: [...new Set(tournamentIds)] } } },
        { $group: { _id: { tournamentId: '$tournamentId', state: '$state' }, n: { $sum: 1 } } }
      ])
      .toArray();
    const out = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const entry = out.get(row._id.tournamentId) ?? {};
      entry[row._id.state] = row.n;
      out.set(row._id.tournamentId, entry);
    }
    return out;
  }

  /** Current occupancy for a tournament (admin summary; capacity comes from the tournament). */
  async seatSummary(tournamentId: string): Promise<{ mainCount: number; waitlistCount: number }> {
    const counter = await this.#seats(this.#db).findOne({ _id: tournamentId });
    const waitlistCount = await this.#registrations().countDocuments({ tournamentId, state: 'waitlisted' });
    return { mainCount: counter?.mainCount ?? 0, waitlistCount };
  }
}
