import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the tournaments module (TOURN-001..030 authoring scope). */
export const TOURNAMENTS_COLLECTIONS = {
  tournaments: 'tournaments',
  revisions: 'tournament_revisions'
} as const;

export const TOURNAMENTS_INDEXES: readonly IndexDeclaration[] = [
  { collection: TOURNAMENTS_COLLECTIONS.tournaments, name: 'tournament_slug_unique', keys: { slug: 1 }, options: { unique: true } },
  // Public discovery and calendar: published tournaments ordered by start time.
  { collection: TOURNAMENTS_COLLECTIONS.tournaments, name: 'tournament_state_start', keys: { state: 1, 'schedule.startAt': 1 } },
  { collection: TOURNAMENTS_COLLECTIONS.tournaments, name: 'tournament_game', keys: { gameId: 1 } },
  { collection: TOURNAMENTS_COLLECTIONS.tournaments, name: 'tournament_updated', keys: { updatedAt: -1 } },
  // Append-only version history (TOURN-026).
  { collection: TOURNAMENTS_COLLECTIONS.revisions, name: 'tournament_revision_version', keys: { tournamentId: 1, version: -1 } }
];
