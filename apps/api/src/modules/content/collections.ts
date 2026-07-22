import type { IndexDeclaration } from '../../shared/db/collections.ts';

/**
 * Collections owned by the content module (DATA-011..015). No other module reads
 * these directly (section 32.1).
 */
export const CONTENT_COLLECTIONS = {
  contentItems: 'content_items',
  contentRevisions: 'content_revisions',
  categories: 'categories',
  tags: 'tags'
} as const;

export const CONTENT_INDEXES: readonly IndexDeclaration[] = [
  // Public detail lookup is by (type, locale slug); only published items are public.
  {
    collection: CONTENT_COLLECTIONS.contentItems,
    name: 'content_type_slug_fa_unique',
    keys: { type: 1, 'slugs.fa': 1 },
    options: { unique: true }
  },
  {
    collection: CONTENT_COLLECTIONS.contentItems,
    name: 'content_type_slug_en_unique',
    keys: { type: 1, 'slugs.en': 1 },
    options: { unique: true }
  },
  // Public listing: published items, newest first, filterable by type/category/tag/game.
  {
    collection: CONTENT_COLLECTIONS.contentItems,
    name: 'content_state_published',
    keys: { state: 1, publishedAt: -1 }
  },
  {
    collection: CONTENT_COLLECTIONS.contentItems,
    name: 'content_type_state_published',
    keys: { type: 1, state: 1, publishedAt: -1 }
  },
  {
    collection: CONTENT_COLLECTIONS.contentItems,
    name: 'content_categories',
    keys: { categorySlugs: 1, state: 1, publishedAt: -1 }
  },
  {
    collection: CONTENT_COLLECTIONS.contentItems,
    name: 'content_tags',
    keys: { tagSlugs: 1, state: 1, publishedAt: -1 }
  },
  {
    collection: CONTENT_COLLECTIONS.contentItems,
    name: 'content_game',
    keys: { gameId: 1, state: 1, publishedAt: -1 }
  },
  // Version history is append-only, read newest first per item (CONTENT-007).
  {
    collection: CONTENT_COLLECTIONS.contentRevisions,
    name: 'revision_content_version',
    keys: { contentId: 1, version: -1 }
  },
  {
    collection: CONTENT_COLLECTIONS.categories,
    name: 'category_type_slug_unique',
    keys: { type: 1, slug: 1 },
    options: { unique: true }
  },
  {
    collection: CONTENT_COLLECTIONS.tags,
    name: 'tag_slug_unique',
    keys: { slug: 1 },
    options: { unique: true }
  }
];
