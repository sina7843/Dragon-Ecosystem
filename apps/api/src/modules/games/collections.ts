import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the games module (DATA-009). */
export const GAMES_COLLECTIONS = {
  games: 'games'
} as const;

export const GAMES_INDEXES: readonly IndexDeclaration[] = [
  { collection: GAMES_COLLECTIONS.games, name: 'game_slug_unique', keys: { slug: 1 }, options: { unique: true } },
  { collection: GAMES_COLLECTIONS.games, name: 'game_status', keys: { status: 1, 'translations.en.name': 1 } },
  // Public catalog lists published games sorted by slug; compound so the walk stays within
  // published rows in sort order instead of a residual filter over the whole collection (DRAGON-16c).
  { collection: GAMES_COLLECTIONS.games, name: 'game_status_slug', keys: { status: 1, slug: 1 } }
];
