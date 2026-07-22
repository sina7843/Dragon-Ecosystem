import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the competitions module (DRAGON-09a: single elimination + round robin). */
export const COMPETITIONS_COLLECTIONS = {
  competitions: 'competitions',
  matches: 'competition_matches'
} as const;

export const COMPETITIONS_INDEXES: readonly IndexDeclaration[] = [
  // One competition per tournament: the unique index is the sole authority that
  // makes concurrent generation attempts collapse to one competition (no duplicate state).
  { collection: COMPETITIONS_COLLECTIONS.competitions, name: 'competition_tournament_unique', keys: { tournamentId: 1 }, options: { unique: true } },
  // Matches are read by competition, ordered by round; and looked up by id for a result.
  { collection: COMPETITIONS_COLLECTIONS.matches, name: 'match_competition_round', keys: { competitionId: 1, round: 1, index: 1 } },
  { collection: COMPETITIONS_COLLECTIONS.matches, name: 'match_competition_state', keys: { competitionId: 1, state: 1 } }
];

/**
 * Advanced-format safeguards (DRAGON-09b). A unique (competitionId, key) index makes
 * logical fixture keys unique within a competition and is the sole authority that
 * makes concurrent generation of the same Swiss round (or duplicate manual/bracket
 * generation) collapse to one persisted structure.
 */
export const COMPETITIONS_ADVANCED_INDEXES: readonly IndexDeclaration[] = [
  { collection: COMPETITIONS_COLLECTIONS.matches, name: 'match_competition_key_unique', keys: { competitionId: 1, key: 1 }, options: { unique: true } }
];
