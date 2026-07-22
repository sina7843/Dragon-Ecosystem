import type { Db } from 'mongodb';
import { CONTENT_COLLECTIONS } from './collections.ts';
import type { EntityId } from '../../shared/ids.ts';
import type { ContentState } from './state.ts';

/**
 * Document shapes for the content module.
 *
 * A ContentItem is one translation group (section 17.3): it holds both the fa and
 * en translations plus per-locale slugs, so publication can require both locales
 * (CONTENT-004) and canonical/alternate links stay explicit.
 */

/** The editorial content types required by CONTENT-001. */
export const CONTENT_TYPES = ['news', 'article', 'announcement', 'guide', 'rules', 'page'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const LOCALES = ['fa', 'en'] as const;
export type ContentLocale = (typeof LOCALES)[number];

export interface ContentTranslation {
  title: string;
  summary: string;
  /** Sanitised HTML (CONTENT-005). */
  body: string;
  /** Derived plain text for search/preview. */
  plainText: string;
  seoTitle: string;
  seoDescription: string;
}

export interface ContentItemRecord {
  _id: EntityId;
  type: ContentType;
  state: ContentState;
  slugs: Record<ContentLocale, string>;
  translations: Record<ContentLocale, ContentTranslation>;
  categorySlugs: string[];
  tagSlugs: string[];
  gameId: EntityId | null;
  /** Optional cover image, validated as a safe reference (full media library: DRAGON-15). */
  coverImageUrl: string | null;
  version: number;
  authorId: EntityId;
  createdAt: string;
  updatedAt: string;
  /** Set when published; used as the public sort key and canonical date. */
  publishedAt: string | null;
  /** Future publish time for a scheduled item; it stays non-public until then. */
  scheduledFor: string | null;
}

export interface ContentRevisionRecord {
  _id: EntityId;
  contentId: EntityId;
  version: number;
  snapshot: Omit<ContentItemRecord, '_id'>;
  actorId: EntityId;
  reason: string;
  createdAt: string;
}

export interface CategoryRecord {
  _id: EntityId;
  type: ContentType;
  slug: string;
  labels: Record<ContentLocale, string>;
  createdAt: string;
}

export interface TagRecord {
  _id: EntityId;
  slug: string;
  labels: Record<ContentLocale, string>;
  createdAt: string;
}

export function contentItems(db: Db) {
  return db.collection<ContentItemRecord>(CONTENT_COLLECTIONS.contentItems);
}

export function contentRevisions(db: Db) {
  return db.collection<ContentRevisionRecord>(CONTENT_COLLECTIONS.contentRevisions);
}

export function categories(db: Db) {
  return db.collection<CategoryRecord>(CONTENT_COLLECTIONS.categories);
}

export function tags(db: Db) {
  return db.collection<TagRecord>(CONTENT_COLLECTIONS.tags);
}

export function isContentType(value: unknown): value is ContentType {
  return typeof value === 'string' && (CONTENT_TYPES as readonly string[]).includes(value);
}
