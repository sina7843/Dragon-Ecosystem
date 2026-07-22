import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page, type PageCursor } from '../../shared/pagination.ts';
import { applyTextSearch, normalizeQuery } from '../../shared/search.ts';
import { resolveSlug } from '../content/slug.ts';
import { TOURNAMENTS_COLLECTIONS } from './collections.ts';
import {
  canTournamentTransition,
  type Locale,
  type TournamentRecord,
  type TournamentRevisionRecord,
  type TournamentState,
  type TournamentTranslation
} from './state.ts';
import {
  assertDateOrdering,
  dateOrderingProblems,
  buildEligibility,
  buildFee,
  buildPrizes,
  buildQuestions,
  buildRefundPolicy,
  buildRuleProfile,
  buildTranslation,
  parseDate,
  publicationProblems,
  validateCapacity,
  validateFormat,
  validateParticipantType,
  type FeeInput,
  type PrizeInput,
  type QuestionInput
} from './validation.ts';

/**
 * Tournament authoring and discovery service (TOURN-001..030 definition scope).
 *
 * Invariants:
 * - A draft/cancelled/archived tournament is never returned by a public read.
 * - Publication lists every missing mandatory value (TOURN-002) and requires a
 *   published game and correctly ordered dates.
 * - Every mutation writes a revision (TOURN-026 history) and an audit event in the
 *   same transaction; prize and question sets carry their own version counters.
 * - No payment is executed here; fees and prizes are priced definitions only.
 */

const DEFAULT_CAPACITY = 16;
const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export interface GameLookup {
  getById(id: EntityId): Promise<{ _id: EntityId; status: string } | null>;
}

export interface TournamentInput {
  slug?: string;
  translations?: Partial<Record<Locale, Partial<TournamentTranslation>>>;
  gameId?: string;
  participantType?: string;
  capacity?: number;
  registration?: { opensAt?: string | null; closesAt?: string | null };
  schedule?: { startAt?: string | null; endAt?: string | null };
  format?: string;
  ruleProfile?: { text?: Record<Locale, string> };
  approvalMode?: 'automatic' | 'manual';
  waitlistMode?: 'enabled' | 'disabled';
  eligibility?: { minAge?: number | null; requireCompleteProfile?: boolean; requireGameIdentity?: boolean };
  questions?: QuestionInput[];
  fee?: FeeInput;
  refundPolicy?: { kind?: 'no_refund' | 'until_start' | 'custom'; text?: Record<Locale, string> };
  prizes?: PrizeInput;
}

export interface UpdateTournamentInput extends TournamentInput {
  expectedVersion: number;
}

function emptyTranslation(): TournamentTranslation {
  return { name: '', summary: '', description: '', seoTitle: '', seoDescription: '' };
}

export class TournamentsService {
  readonly #database: Database;
  readonly #games: GameLookup;

  constructor(database: Database, games: GameLookup) {
    this.#database = database;
    this.#games = games;
  }

  get #db(): Db {
    return this.#database.db;
  }

  #tournaments(db: Db = this.#db) {
    return db.collection<TournamentRecord>(TOURNAMENTS_COLLECTIONS.tournaments);
  }
  #revisions(db: Db = this.#db) {
    return db.collection<TournamentRevisionRecord>(TOURNAMENTS_COLLECTIONS.revisions);
  }

  async #assertPublishedGame(gameId: string): Promise<void> {
    const game = await this.#games.getById(gameId);
    if (game === null || game.status !== 'published') {
      throw new ValidationError('The selected game is not available.', [
        { field: 'gameId', code: 'INVALID_GAME', message: 'Choose a published game.' }
      ]);
    }
  }

  // --- Authoring ---

  async createDraft(context: RequestContext, input: TournamentInput): Promise<TournamentRecord> {
    const organizerId = context.actor.accountId;
    if (organizerId === null) throw new ForbiddenError();
    if (input.gameId === undefined) {
      throw new ValidationError('A game is required.', [{ field: 'gameId', code: 'REQUIRED', message: 'Choose a game.' }]);
    }
    await this.#assertPublishedGame(input.gameId);

    const now = utcNow();
    const translations = {
      fa: buildTranslation(input.translations?.fa, emptyTranslation()),
      en: buildTranslation(input.translations?.en, emptyTranslation())
    };
    const slug = resolveSlug(input.slug, translations.en.name || translations.fa.name || 'tournament');
    const base: TournamentRecord = {
      _id: newId(),
      slug,
      state: 'draft',
      translations,
      gameId: input.gameId,
      participantType: validateParticipantType(input.participantType, 'individual'),
      capacity: validateCapacity(input.capacity, DEFAULT_CAPACITY),
      registration: {
        opensAt: parseDate(input.registration?.opensAt, 'registration.opensAt', null),
        closesAt: parseDate(input.registration?.closesAt, 'registration.closesAt', null)
      },
      schedule: {
        startAt: parseDate(input.schedule?.startAt, 'schedule.startAt', null),
        endAt: parseDate(input.schedule?.endAt, 'schedule.endAt', null)
      },
      format: validateFormat(input.format, 'single_elimination'),
      ruleProfile: buildRuleProfile(input.ruleProfile, { kind: 'custom', text: { fa: '', en: '' } }),
      approvalMode: input.approvalMode ?? 'manual',
      waitlistMode: input.waitlistMode ?? 'disabled',
      eligibility: buildEligibility(input.eligibility, { minAge: null, requireCompleteProfile: true, requireGameIdentity: false }),
      questionSet: buildQuestions(input.questions, { version: 0, questions: [] }),
      fee: buildFee(input.fee),
      refundPolicy: buildRefundPolicy(input.refundPolicy, { kind: 'no_refund', text: { fa: '', en: '' } }),
      prizes: buildPrizes(input.prizes, { version: 0, placements: [] }),
      version: 1,
      organizerId,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      cancelledAt: null
    };
    assertDateOrdering(base);
    await this.#write(context, base, 'tournament.created', 'Initial draft.', null);
    return base;
  }

  async updateDraft(context: RequestContext, id: EntityId, input: UpdateTournamentInput): Promise<TournamentRecord> {
    const current = await this.#tournaments().findOne({ _id: id });
    if (current === null) throw new NotFoundError('Unknown tournament.');
    if (current.version !== input.expectedVersion) {
      throw new ConflictError('TOURNAMENT_STALE', 'This tournament changed since you opened it. Reload and retry.');
    }
    if (current.state !== 'draft') {
      throw new ValidationError('Only a draft tournament can be edited.', [
        { field: 'state', code: 'NOT_EDITABLE', message: 'Return the tournament to draft to edit it.' }
      ]);
    }
    if (input.gameId !== undefined && input.gameId !== current.gameId) await this.#assertPublishedGame(input.gameId);

    const translations = {
      fa: buildTranslation(input.translations?.fa, current.translations.fa),
      en: buildTranslation(input.translations?.en, current.translations.en)
    };
    const next: TournamentRecord = {
      ...current,
      slug: input.slug === undefined ? current.slug : resolveSlug(input.slug, translations.en.name || translations.fa.name),
      translations,
      gameId: input.gameId ?? current.gameId,
      participantType: validateParticipantType(input.participantType, current.participantType),
      capacity: validateCapacity(input.capacity, current.capacity),
      registration: {
        opensAt: parseDate(input.registration?.opensAt, 'registration.opensAt', current.registration.opensAt),
        closesAt: parseDate(input.registration?.closesAt, 'registration.closesAt', current.registration.closesAt)
      },
      schedule: {
        startAt: parseDate(input.schedule?.startAt, 'schedule.startAt', current.schedule.startAt),
        endAt: parseDate(input.schedule?.endAt, 'schedule.endAt', current.schedule.endAt)
      },
      format: validateFormat(input.format, current.format),
      ruleProfile: buildRuleProfile(input.ruleProfile, current.ruleProfile),
      approvalMode: input.approvalMode ?? current.approvalMode,
      waitlistMode: input.waitlistMode ?? current.waitlistMode,
      eligibility: buildEligibility(input.eligibility, current.eligibility),
      questionSet: buildQuestions(input.questions, current.questionSet),
      fee: input.fee === undefined ? current.fee : buildFee(input.fee),
      refundPolicy: buildRefundPolicy(input.refundPolicy, current.refundPolicy),
      prizes: buildPrizes(input.prizes, current.prizes),
      version: current.version + 1,
      updatedAt: utcNow()
    };
    assertDateOrdering(next);
    await this.#write(context, next, 'tournament.updated', 'Edited draft.', current);
    return next;
  }

  /**
   * Lifecycle transition (TOURN-001). Publishing runs the full publication
   * validation and requires a published game and ordered dates; cancel and archive
   * require a reason on the audit record.
   */
  async transition(context: RequestContext, id: EntityId, to: TournamentState, reason: string): Promise<TournamentRecord> {
    const current = await this.#tournaments().findOne({ _id: id });
    if (current === null) throw new NotFoundError('Unknown tournament.');
    if (!canTournamentTransition(current.state, to)) {
      throw new ValidationError(`Cannot move a tournament from ${current.state} to ${to}.`, [
        { field: 'state', code: 'INVALID_TRANSITION', message: 'That lifecycle change is not allowed.' }
      ]);
    }
    if (to === 'published') {
      await this.#assertPublishedGame(current.gameId);
      // Report every publication blocker at once — missing mandatory values and any
      // date-ordering violations together (TOURN-002: list each missing/invalid value).
      const problems = [...publicationProblems(current), ...dateOrderingProblems(current)];
      if (problems.length > 0) throw new ValidationError('The tournament is missing required values.', problems);
    }

    const now = utcNow();
    const next: TournamentRecord = {
      ...current,
      state: to,
      version: current.version + 1,
      updatedAt: now,
      publishedAt: to === 'published' ? (current.publishedAt ?? now) : current.publishedAt,
      cancelledAt: to === 'cancelled' ? now : current.cancelledAt
    };
    await this.#write(context, next, `tournament.${to}`, reason, current);
    return next;
  }

  /** Clones a tournament's configuration into a fresh draft (acceptance: cloning). */
  async clone(context: RequestContext, id: EntityId): Promise<TournamentRecord> {
    const organizerId = context.actor.accountId;
    if (organizerId === null) throw new ForbiddenError();
    const source = await this.#tournaments().findOne({ _id: id });
    if (source === null) throw new NotFoundError('Unknown tournament.');
    const now = utcNow();
    const clone: TournamentRecord = {
      ...source,
      _id: newId(),
      slug: `${source.slug}-copy-${newId().slice(0, 8)}`,
      state: 'draft',
      version: 1,
      organizerId,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      cancelledAt: null
    };
    await this.#write(context, clone, 'tournament.cloned', `Cloned from ${id}.`, null);
    return clone;
  }

  async #write(
    context: RequestContext,
    record: TournamentRecord,
    action: string,
    reason: string,
    previous: TournamentRecord | null
  ): Promise<void> {
    const { _id, ...snapshot } = record;
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        if (previous === null) {
          await this.#tournaments(uow.db).insertOne(record, { session: uow.session });
        } else {
          const result = await this.#tournaments(uow.db).replaceOne(
            { _id, version: previous.version },
            record,
            { session: uow.session }
          );
          if (result.matchedCount === 0) throw new ConflictError('TOURNAMENT_STALE', 'This tournament changed. Reload and retry.');
        }
        await this.#revisions(uow.db).insertOne(
          {
            _id: newId(),
            tournamentId: _id,
            version: record.version,
            snapshot,
            actorId: context.actor.accountId ?? 'system',
            reason,
            createdAt: record.updatedAt
          },
          { session: uow.session }
        );
        uow.audit({
          action,
          resourceType: 'tournament',
          resourceId: _id,
          before: previous === null ? null : { state: previous.state, version: previous.version },
          after: { state: record.state, version: record.version },
          reason
        });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ValidationError('That tournament name/slug is already in use.', [
          { field: 'slug', code: 'SLUG_TAKEN', message: 'Choose a different name or slug.' }
        ]);
      }
      throw error;
    }
  }

  // --- Admin reads ---

  async getById(id: EntityId): Promise<TournamentRecord | null> {
    return this.#tournaments().findOne({ _id: id });
  }

  async listForAdmin(query: { state?: TournamentState; gameId?: string; cursor?: string; limit?: number }): Promise<Page<TournamentRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = {};
    if (query.state !== undefined) filter['state'] = query.state;
    if (query.gameId !== undefined) filter['gameId'] = query.gameId;
    this.#applyCursor(filter, decodeCursor(query.cursor), 'updatedAt', -1);
    const rows = await this.#tournaments().find(filter).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1).toArray();
    return this.#toPage(rows, limit, (r) => r.updatedAt);
  }

  async listRevisions(tournamentId: EntityId): Promise<Array<{ version: number; actorId: string; reason: string; createdAt: string }>> {
    const rows = await this.#revisions()
      .find({ tournamentId }, { projection: { snapshot: 0 } })
      .sort({ version: -1 })
      .limit(50)
      .toArray();
    return rows.map((r) => ({ version: r.version, actorId: r.actorId, reason: r.reason, createdAt: r.createdAt }));
  }

  // --- Public reads (published only) ---

  #publicFilter(): Record<string, unknown> {
    return { state: 'published' };
  }

  async listPublished(query: {
    gameId?: string;
    participantType?: string;
    format?: string;
    q?: string;
    locale?: Locale;
    cursor?: string;
    limit?: number;
  }): Promise<Page<TournamentRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = this.#publicFilter();
    if (query.gameId !== undefined) filter['gameId'] = query.gameId;
    if (query.participantType !== undefined) filter['participantType'] = query.participantType;
    if (query.format !== undefined) filter['format'] = query.format;
    this.#applyCursor(filter, decodeCursor(query.cursor), 'schedule.startAt', 1);
    // Draft-safe free-text search over the requested locale's name/summary (both locales
    // when unspecified), narrowing the published-only filter above.
    const search = normalizeQuery(query.q);
    if (search !== null) {
      const locales: Locale[] = query.locale === undefined ? ['fa', 'en'] : [query.locale];
      applyTextSearch(filter, search, locales.flatMap((l) => [`translations.${l}.name`, `translations.${l}.summary`]));
    }
    const rows = await this.#tournaments().find(filter).sort({ 'schedule.startAt': 1, _id: 1 }).limit(limit + 1).toArray();
    return this.#toPage(rows, limit, (r) => r.schedule.startAt ?? '', 1);
  }

  async getPublishedBySlug(slug: string): Promise<TournamentRecord | null> {
    return this.#tournaments().findOne({ ...this.#publicFilter(), slug });
  }

  /** Calendar view (acceptance): published tournaments whose start falls in [from, to]. */
  async calendar(from: string, to: string): Promise<TournamentRecord[]> {
    return this.#tournaments()
      .find({ ...this.#publicFilter(), 'schedule.startAt': { $gte: from, $lte: to } })
      .sort({ 'schedule.startAt': 1, _id: 1 })
      .limit(500)
      .toArray();
  }

  #applyCursor(filter: Record<string, unknown>, cursor: PageCursor | null, field: string, dir: 1 | -1): void {
    if (cursor === null) return;
    const op = dir === 1 ? '$gt' : '$lt';
    filter['$or'] = [
      { [field]: { [op]: cursor.sortValue } },
      { [field]: cursor.sortValue, _id: { [op]: cursor.id } }
    ];
  }

  #toPage(rows: TournamentRecord[], limit: number, sortOf: (r: TournamentRecord) => string, _dir: 1 | -1 = -1): Page<TournamentRecord> {
    const page = toPage(rows.map((r) => ({ ...r, sortValue: sortOf(r), id: r._id })), limit);
    return {
      items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as TournamentRecord),
      nextCursor: page.nextCursor
    };
  }
}
