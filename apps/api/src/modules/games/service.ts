import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ValidationError, type FieldError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import { applyTextSearch, normalizeQuery } from '../../shared/search.ts';
import { resolveSlug } from '../content/slug.ts';
import { GAMES_COLLECTIONS } from './collections.ts';

/**
 * Games catalog (DATA-009): localized game identity with a lifecycle, slug, SEO,
 * and an archive (never a destructive delete, so existing references resolve —
 * CONTENT-012). Public reads return published games only.
 */

export const GAME_STATES = ['draft', 'published', 'archived'] as const;
export type GameStatus = (typeof GAME_STATES)[number];

const LOCALES = ['fa', 'en'] as const;
type Locale = (typeof LOCALES)[number];

interface GameTranslation {
  name: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
}

export interface GameRecord {
  _id: EntityId;
  slug: string;
  status: GameStatus;
  translations: Record<Locale, GameTranslation>;
  coverImageUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface GameInput {
  slug?: string;
  translations: Partial<Record<Locale, Partial<GameTranslation>>>;
  coverImageUrl?: string | null;
  expectedVersion?: number;
}

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

function validateCoverImage(url: string | null | undefined): string | null {
  if (url === undefined || url === null || url === '') return null;
  const value = url.trim();
  if (value.startsWith('/') || value.startsWith('https://')) return value;
  throw new ValidationError('The cover image reference is not allowed.', [
    { field: 'coverImageUrl', code: 'INVALID_MEDIA_REF', message: 'Use a site path or an https URL.' }
  ]);
}

function buildTranslation(input: Partial<GameTranslation> | undefined, previous: GameTranslation): GameTranslation {
  const name = (input?.name ?? previous.name).trim();
  const description = (input?.description ?? previous.description).trim();
  return {
    name,
    description,
    // `||` so an empty prior value falls through to the name/description.
    seoTitle: (input?.seoTitle ?? '').trim() || previous.seoTitle || name,
    seoDescription: (input?.seoDescription ?? '').trim() || previous.seoDescription || description
  };
}

function emptyTranslation(): GameTranslation {
  return { name: '', description: '', seoTitle: '', seoDescription: '' };
}

export class GamesService {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  get #db(): Db {
    return this.#database.db;
  }

  #games() {
    return this.#db.collection<GameRecord>(GAMES_COLLECTIONS.games);
  }

  async create(context: RequestContext, input: GameInput): Promise<GameRecord> {
    const translations = {
      fa: buildTranslation(input.translations.fa, emptyTranslation()),
      en: buildTranslation(input.translations.en, emptyTranslation())
    };
    const slug = resolveSlug(input.slug, translations.en.name || translations.fa.name, 'slug');
    const now = utcNow();
    const record: GameRecord = {
      _id: newId(),
      slug,
      status: 'draft',
      translations,
      coverImageUrl: validateCoverImage(input.coverImageUrl),
      version: 1,
      createdAt: now,
      updatedAt: now,
      publishedAt: null
    };
    await this.#write(context, record, 'game.created', null);
    return record;
  }

  async update(context: RequestContext, id: EntityId, input: GameInput): Promise<GameRecord> {
    const current = await this.#games().findOne({ _id: id });
    if (current === null) throw new NotFoundError('Unknown game.');
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new ConflictError('GAME_STALE', 'This game changed since you opened it. Reload and retry.');
    }
    const translations = {
      fa: buildTranslation(input.translations.fa, current.translations.fa),
      en: buildTranslation(input.translations.en, current.translations.en)
    };
    const next: GameRecord = {
      ...current,
      slug: input.slug === undefined ? current.slug : resolveSlug(input.slug, translations.en.name, 'slug'),
      translations,
      coverImageUrl: input.coverImageUrl === undefined ? current.coverImageUrl : validateCoverImage(input.coverImageUrl),
      version: current.version + 1,
      updatedAt: utcNow()
    };
    await this.#write(context, next, 'game.updated', current);
    return next;
  }

  async setStatus(context: RequestContext, id: EntityId, status: GameStatus, reason: string): Promise<GameRecord> {
    const current = await this.#games().findOne({ _id: id });
    if (current === null) throw new NotFoundError('Unknown game.');
    if (status === 'published') this.#assertPublishable(current);

    const now = utcNow();
    const next: GameRecord = {
      ...current,
      status,
      version: current.version + 1,
      updatedAt: now,
      publishedAt: status === 'published' ? (current.publishedAt ?? now) : current.publishedAt
    };
    await this.#write(context, next, `game.${status}`, current, reason);
    return next;
  }

  #assertPublishable(game: GameRecord): void {
    const problems: FieldError[] = [];
    for (const locale of LOCALES) {
      if (game.translations[locale].name.trim() === '') {
        problems.push({
          field: `translations.${locale}.name`,
          code: 'REQUIRED_FOR_PUBLICATION',
          message: `The ${locale} name is required before publishing.`
        });
      }
    }
    if (problems.length > 0) throw new ValidationError('Both language names are required before publishing.', problems);
  }

  async #write(
    context: RequestContext,
    record: GameRecord,
    action: string,
    previous: GameRecord | null,
    reason = 'Game change.'
  ): Promise<void> {
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        const games = uow.db.collection<GameRecord>(GAMES_COLLECTIONS.games);
        if (previous === null) {
          await games.insertOne(record, { session: uow.session });
        } else {
          const result = await games.replaceOne({ _id: record._id, version: previous.version }, record, {
            session: uow.session
          });
          if (result.matchedCount === 0) throw new ConflictError('GAME_STALE', 'This game changed. Reload and retry.');
        }
        uow.audit({
          action,
          resourceType: 'game',
          resourceId: record._id,
          before: previous === null ? null : { status: previous.status, version: previous.version },
          after: { status: record.status, version: record.version },
          reason
        });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ValidationError('That slug is already in use.', [
          { field: 'slug', code: 'SLUG_TAKEN', message: 'Choose a different slug.' }
        ]);
      }
      throw error;
    }
  }

  async getById(id: EntityId): Promise<GameRecord | null> {
    return this.#games().findOne({ _id: id });
  }

  async listForAdmin(query: { status?: GameStatus; cursor?: string; limit?: number }): Promise<Page<GameRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter['status'] = query.status;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ updatedAt: { $lt: cursor.sortValue } }, { updatedAt: cursor.sortValue, _id: { $lt: cursor.id } }];
    }
    const rows = await this.#games().find(filter).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1).toArray();
    return this.#page(rows, limit, (r) => r.updatedAt);
  }

  async listPublished(query: { locale: Locale; q?: string; cursor?: string; limit?: number }): Promise<Page<{
    id: string;
    slug: string;
    name: string;
    description: string;
    coverImageUrl: string | null;
  }>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { status: 'published' };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ slug: { $gt: cursor.sortValue } }, { slug: cursor.sortValue, _id: { $gt: cursor.id } }];
    }
    // Draft-safe free-text search over the requested locale's name/description.
    const search = normalizeQuery(query.q);
    if (search !== null) applyTextSearch(filter, search, [`translations.${query.locale}.name`, `translations.${query.locale}.description`]);
    const rows = await this.#games().find(filter).sort({ slug: 1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.slug, id: r._id })), limit);
    return {
      items: page.items.map((r) => ({
        id: r._id,
        slug: r.slug,
        name: r.translations[query.locale].name,
        description: r.translations[query.locale].description,
        coverImageUrl: r.coverImageUrl
      })),
      nextCursor: page.nextCursor
    };
  }

  async getPublishedBySlug(slug: string): Promise<GameRecord | null> {
    return this.#games().findOne({ slug, status: 'published' });
  }

  #page<T extends { _id: string }>(rows: T[], limit: number, sortOf: (r: T) => string): Page<T> {
    const page = toPage(rows.map((r) => ({ ...r, sortValue: sortOf(r), id: r._id })), limit);
    return {
      items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as T),
      nextCursor: page.nextCursor
    };
  }
}
