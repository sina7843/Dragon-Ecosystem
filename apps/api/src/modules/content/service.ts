import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type FieldError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import {
  clampLimit,
  decodeCursor,
  toPage,
  type Page,
  type PageCursor
} from '../../shared/pagination.ts';
import { applyTextSearch, normalizeQuery } from '../../shared/search.ts';
import { sanitizeRichText, toPlainText } from './sanitize.ts';
import { resolveSlug } from './slug.ts';
import { canContentTransition, requiresPublishPermission, type ContentState } from './state.ts';
import {
  categories,
  contentItems,
  contentRevisions,
  isContentType,
  LOCALES,
  tags,
  type ContentItemRecord,
  type ContentLocale,
  type ContentTranslation,
  type ContentType
} from './store.ts';

/**
 * Content domain service: bilingual editorial publishing with version history.
 *
 * Invariants:
 * - A draft or restricted item is never returned by a public read (CONTENT: drafts
 *   must not leak). Public reads require state `published` AND `publishedAt <= now`,
 *   so a scheduled item stays hidden until its time.
 * - Publication requires a complete fa and en translation (CONTENT-004).
 * - Bodies are sanitised on write (CONTENT-005); the public path serves safe HTML.
 * - Every mutation writes a revision (CONTENT-007) and an audit event, atomically.
 */

interface TranslationInput {
  title?: string;
  summary?: string;
  body?: string;
  seoTitle?: string;
  seoDescription?: string;
}

export interface CreateContentInput {
  type: string;
  translations: Partial<Record<ContentLocale, TranslationInput>>;
  slugs?: Partial<Record<ContentLocale, string>>;
  categorySlugs?: string[];
  tagSlugs?: string[];
  gameId?: string | null;
  coverImageUrl?: string | null;
}

export interface UpdateContentInput extends Partial<CreateContentInput> {
  /** Optimistic concurrency (ADMIN-005): the version the editor started from. */
  expectedVersion: number;
}

export interface PublicContentCard {
  id: EntityId;
  type: ContentType;
  slug: string;
  title: string;
  summary: string;
  publishedAt: string;
  coverImageUrl: string | null;
}

const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

/** A cover image must be a same-origin path or an https URL (no javascript:/data:). */
function validateCoverImage(url: string | null | undefined): string | null {
  if (url === undefined || url === null || url === '') return null;
  const value = url.trim();
  if (value.startsWith('/') || value.startsWith('https://')) return value;
  throw new ValidationError('The cover image reference is not allowed.', [
    { field: 'coverImageUrl', code: 'INVALID_MEDIA_REF', message: 'Use a site path or an https URL.' }
  ]);
}

function emptyTranslation(): ContentTranslation {
  return { title: '', summary: '', body: '', plainText: '', seoTitle: '', seoDescription: '' };
}

function buildTranslation(input: TranslationInput | undefined, previous: ContentTranslation): ContentTranslation {
  const title = (input?.title ?? previous.title).trim();
  const summary = (input?.summary ?? previous.summary).trim();
  // Sanitise on write so stored and served HTML is always safe.
  const body = sanitizeRichText(input?.body ?? previous.body);
  // SEO fields fall back through explicit input, then any prior value, then the
  // title/summary. `||` is used so an empty string falls through rather than sticking.
  return {
    title,
    summary,
    body,
    plainText: toPlainText(body),
    seoTitle: (input?.seoTitle ?? '').trim() || previous.seoTitle || title,
    seoDescription: (input?.seoDescription ?? '').trim() || previous.seoDescription || summary
  };
}

export class ContentService {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  get #db(): Db {
    return this.#database.db;
  }

  // --- Authoring ---

  async createDraft(context: RequestContext, input: CreateContentInput): Promise<ContentItemRecord> {
    if (!isContentType(input.type)) throw new ValidationError('Unknown content type.');
    const authorId = context.actor.accountId;
    if (authorId === null) throw new ForbiddenError();

    const now = utcNow();
    const translations = {
      fa: buildTranslation(input.translations.fa, emptyTranslation()),
      en: buildTranslation(input.translations.en, emptyTranslation())
    };
    // A slug needs a source: the locale title, falling back to the other locale.
    const slugs = {
      fa: resolveSlug(input.slugs?.fa, translations.fa.title || translations.en.title || input.type, 'slugs.fa'),
      en: resolveSlug(input.slugs?.en, translations.en.title || translations.fa.title || input.type, 'slugs.en')
    };

    const record: ContentItemRecord = {
      _id: newId(),
      type: input.type,
      state: 'draft',
      slugs,
      translations,
      categorySlugs: input.categorySlugs ?? [],
      tagSlugs: input.tagSlugs ?? [],
      gameId: input.gameId ?? null,
      coverImageUrl: validateCoverImage(input.coverImageUrl),
      version: 1,
      authorId,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      scheduledFor: null
    };

    await this.#writeWithRevision(context, record, 'content.created', 'Initial draft.', null);
    return record;
  }

  async updateContent(context: RequestContext, id: EntityId, input: UpdateContentInput): Promise<ContentItemRecord> {
    const current = await contentItems(this.#db).findOne({ _id: id });
    if (current === null) throw new NotFoundError('Unknown content item.');
    if (current.version !== input.expectedVersion) {
      throw new ConflictError('CONTENT_STALE', 'This content changed since you opened it. Reload and retry.');
    }

    const translations = {
      fa: buildTranslation(input.translations?.fa, current.translations.fa),
      en: buildTranslation(input.translations?.en, current.translations.en)
    };
    const slugs = {
      fa: input.slugs?.fa === undefined ? current.slugs.fa : resolveSlug(input.slugs.fa, translations.fa.title, 'slugs.fa'),
      en: input.slugs?.en === undefined ? current.slugs.en : resolveSlug(input.slugs.en, translations.en.title, 'slugs.en')
    };

    const next: ContentItemRecord = {
      ...current,
      translations,
      slugs,
      categorySlugs: input.categorySlugs ?? current.categorySlugs,
      tagSlugs: input.tagSlugs ?? current.tagSlugs,
      gameId: input.gameId === undefined ? current.gameId : input.gameId,
      coverImageUrl: input.coverImageUrl === undefined ? current.coverImageUrl : validateCoverImage(input.coverImageUrl),
      version: current.version + 1,
      updatedAt: utcNow()
    };

    await this.#writeWithRevision(context, next, 'content.updated', 'Edited draft.', current);
    return next;
  }

  /**
   * Moves an item through its lifecycle. Reaching or leaving the public state
   * (published/archived) requires the publish permission, enforced by the caller
   * passing `canPublish`. Publishing validates both locales and sets the publish
   * time; a future time schedules it without making it public early.
   */
  async transition(
    context: RequestContext,
    id: EntityId,
    to: ContentState,
    options: { reason: string; canPublish: boolean; publishAt?: string }
  ): Promise<ContentItemRecord> {
    const current = await contentItems(this.#db).findOne({ _id: id });
    if (current === null) throw new NotFoundError('Unknown content item.');
    if (!canContentTransition(current.state, to)) {
      throw new ValidationError(`Cannot move content from ${current.state} to ${to}.`);
    }
    if (requiresPublishPermission(to) && !options.canPublish) {
      throw new ForbiddenError('Publishing requires the publish permission.');
    }
    if (to === 'published') this.#assertPublishable(current);

    const now = utcNow();
    const publishedAt = to === 'published' ? (options.publishAt ?? now) : current.publishedAt;
    const next: ContentItemRecord = {
      ...current,
      state: to,
      version: current.version + 1,
      updatedAt: now,
      publishedAt: to === 'archived' ? current.publishedAt : publishedAt,
      scheduledFor: to === 'published' && options.publishAt !== undefined && options.publishAt > now ? options.publishAt : null
    };

    await this.#writeWithRevision(context, next, `content.${to}`, options.reason, current);
    return next;
  }

  /** CONTENT-004: publication is blocked unless both required locales are complete. */
  #assertPublishable(item: ContentItemRecord): void {
    const problems: FieldError[] = [];
    for (const locale of LOCALES) {
      const t = item.translations[locale];
      for (const field of ['title', 'summary', 'body'] as const) {
        if (t[field].trim() === '') {
          problems.push({
            field: `translations.${locale}.${field}`,
            code: 'REQUIRED_FOR_PUBLICATION',
            message: `The ${locale} ${field} is required before publishing.`
          });
        }
      }
    }
    if (problems.length > 0) {
      throw new ValidationError('Both languages must be complete before publishing.', problems);
    }
  }

  async #writeWithRevision(
    context: RequestContext,
    record: ContentItemRecord,
    action: string,
    reason: string,
    previous: ContentItemRecord | null
  ): Promise<void> {
    const { _id, ...snapshot } = record;
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        if (previous === null) {
          await contentItems(uow.db).insertOne(record, { session: uow.session });
        } else {
          // Optimistic guard at the write: only replace the exact prior version.
          const result = await contentItems(uow.db).replaceOne(
            { _id, version: previous.version },
            record,
            { session: uow.session }
          );
          if (result.matchedCount === 0) {
            throw new ConflictError('CONTENT_STALE', 'This content changed. Reload and retry.');
          }
        }
        await contentRevisions(uow.db).insertOne(
          {
            _id: newId(),
            contentId: _id,
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
          resourceType: 'content',
          resourceId: _id,
          before: previous === null ? null : { state: previous.state, version: previous.version },
          after: { state: record.state, version: record.version },
          reason
        });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ValidationError('That slug is already in use for this content type.', [
          { field: 'slug', code: 'SLUG_TAKEN', message: 'Choose a different slug.' }
        ]);
      }
      throw error;
    }
  }

  // --- Admin reads ---

  async getById(id: EntityId): Promise<ContentItemRecord | null> {
    return contentItems(this.#db).findOne({ _id: id });
  }

  async listForAdmin(query: {
    type?: string;
    state?: ContentState;
    cursor?: string;
    limit?: number;
  }): Promise<Page<ContentItemRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = {};
    if (query.type !== undefined) filter['type'] = query.type;
    if (query.state !== undefined) filter['state'] = query.state;
    this.#applyCursor(filter, decodeCursor(query.cursor), 'updatedAt');

    const rows = await contentItems(this.#db)
      .find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();
    return this.#toPage(rows, limit, (row) => row.updatedAt);
  }

  async listRevisions(contentId: EntityId): Promise<Array<{ version: number; actorId: string; reason: string; createdAt: string }>> {
    const rows = await contentRevisions(this.#db)
      .find({ contentId }, { projection: { snapshot: 0 } })
      .sort({ version: -1 })
      .limit(50)
      .toArray();
    return rows.map((r) => ({ version: r.version, actorId: r.actorId, reason: r.reason, createdAt: r.createdAt }));
  }

  // --- Public reads (published only, never a draft) ---

  async listPublished(query: {
    locale: ContentLocale;
    type?: string;
    categorySlug?: string;
    tagSlug?: string;
    gameId?: string;
    q?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<PublicContentCard>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = this.#publicFilter();
    if (query.type !== undefined) filter['type'] = query.type;
    if (query.categorySlug !== undefined) filter['categorySlugs'] = query.categorySlug;
    if (query.tagSlug !== undefined) filter['tagSlugs'] = query.tagSlug;
    if (query.gameId !== undefined) filter['gameId'] = query.gameId;
    this.#applyCursor(filter, decodeCursor(query.cursor), 'publishedAt');
    // Free-text search over the requested locale's title/summary/plain text; draft-safe
    // because it only narrows the published filter above.
    const search = normalizeQuery(query.q);
    if (search !== null) applyTextSearch(filter, search, [`translations.${query.locale}.title`, `translations.${query.locale}.summary`, `translations.${query.locale}.plainText`]);

    const rows = await contentItems(this.#db)
      .find(filter)
      .sort({ publishedAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();

    const page = this.#toPage(rows, limit, (row) => row.publishedAt ?? '');
    return {
      items: page.items.map((row) => this.#toCard(row, query.locale)),
      nextCursor: page.nextCursor
    };
  }

  /** Public detail by localized slug, with the alternate-locale slug for hreflang. */
  async getPublishedBySlug(
    type: string,
    locale: ContentLocale,
    slug: string
  ): Promise<{
    item: ContentItemRecord;
    translation: ContentTranslation;
    alternateSlugs: Record<ContentLocale, string>;
  } | null> {
    const filter: Record<string, unknown> = { ...this.#publicFilter(), type, [`slugs.${locale}`]: slug };
    const item = await contentItems(this.#db).findOne(filter);
    if (item === null) return null;
    return { item, translation: item.translations[locale], alternateSlugs: item.slugs };
  }

  /** The published-and-visible filter used by every public read. */
  #publicFilter(): Record<string, unknown> {
    return { state: 'published', publishedAt: { $lte: utcNow() } };
  }

  #toCard(row: ContentItemRecord, locale: ContentLocale): PublicContentCard {
    const t = row.translations[locale];
    return {
      id: row._id,
      type: row.type,
      slug: row.slugs[locale],
      title: t.title,
      summary: t.summary,
      publishedAt: row.publishedAt ?? row.updatedAt,
      coverImageUrl: row.coverImageUrl
    };
  }

  #applyCursor(filter: Record<string, unknown>, cursor: PageCursor | null, field: string): void {
    if (cursor === null) return;
    filter['$or'] = [
      { [field]: { $lt: cursor.sortValue } },
      { [field]: cursor.sortValue, _id: { $lt: cursor.id } }
    ];
  }

  #toPage<T extends { _id: string }>(rows: T[], limit: number, sortOf: (row: T) => string): Page<T> {
    const page = toPage(
      rows.map((row) => ({ ...row, sortValue: sortOf(row), id: row._id })),
      limit
    );
    return {
      items: page.items.map(({ sortValue: _s, id: _i, ...row }) => row as unknown as T),
      nextCursor: page.nextCursor
    };
  }

  // --- Taxonomy ---

  async createCategory(context: RequestContext, input: { type: string; slug?: string; labels: Record<ContentLocale, string> }) {
    if (!isContentType(input.type)) throw new ValidationError('Unknown content type.');
    const slug = resolveSlug(input.slug, input.labels.en || input.labels.fa, 'slug');
    const record = { _id: newId(), type: input.type, slug, labels: input.labels, createdAt: utcNow() };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await categories(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'category.created', resourceType: 'category', resourceId: record._id, after: { type: input.type, slug } });
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictError('CATEGORY_EXISTS', 'That category already exists.');
      throw error;
    }
    return record;
  }

  async listCategories(type?: string) {
    const filter: Record<string, unknown> = type === undefined ? {} : { type };
    return categories(this.#db).find(filter).sort({ slug: 1 }).limit(200).toArray();
  }

  async createTag(context: RequestContext, input: { slug?: string; labels: Record<ContentLocale, string> }) {
    const slug = resolveSlug(input.slug, input.labels.en || input.labels.fa, 'slug');
    const record = { _id: newId(), slug, labels: input.labels, createdAt: utcNow() };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await tags(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'tag.created', resourceType: 'tag', resourceId: record._id, after: { slug } });
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictError('TAG_EXISTS', 'That tag already exists.');
      throw error;
    }
    return record;
  }

  async listTags() {
    return tags(this.#db).find({}).sort({ slug: 1 }).limit(200).toArray();
  }
}
