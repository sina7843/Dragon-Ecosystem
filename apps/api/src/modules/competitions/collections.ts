import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the competitions module. */
export const COMPETITIONS_COLLECTIONS = {
  competitions: 'competitions',
  matches: 'competition_matches',
  standings: 'competition_standings',
  corrections: 'competition_result_corrections',
  schedules: 'competition_match_schedules',
  versions: 'competition_bracket_versions'
} as const;

/**
 * Match-schedule history (DRAGON-29D, TOURN-020, API-043).
 *
 * `schedule_match_revision_unique` is the integrity authority, not a read-before-write
 * check: two concurrent reschedules that both computed the same next revision number
 * collapse to one durable row instead of appending a fork in the history.
 */
export const COMPETITIONS_SCHEDULE_INDEXES: readonly IndexDeclaration[] = [
  { collection: 'competition_match_schedules', name: 'schedule_match_revision_unique', keys: { matchId: 1, revisionNumber: 1 }, options: { unique: true } },
  // Serves the per-match history read, newest first.
  { collection: 'competition_match_schedules', name: 'schedule_match_created', keys: { matchId: 1, createdAt: -1 } }
];

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

/**
 * Standings + correction safeguards (DRAGON-09c). Exactly one current standings
 * snapshot per competition and one snapshot per calculation version; one correction
 * revision number per match. These unique indexes are the database authority behind
 * projection-publication and correction-versioning concurrency.
 */
export const COMPETITIONS_STANDINGS_INDEXES: readonly IndexDeclaration[] = [
  { collection: COMPETITIONS_COLLECTIONS.standings, name: 'standings_current_unique', keys: { competitionId: 1 }, options: { unique: true, partialFilterExpression: { current: true } } },
  { collection: COMPETITIONS_COLLECTIONS.standings, name: 'standings_version_unique', keys: { competitionId: 1, calculationVersion: 1 }, options: { unique: true } },
  { collection: COMPETITIONS_COLLECTIONS.corrections, name: 'correction_match_revision_unique', keys: { matchId: 1, revisionNumber: 1 }, options: { unique: true } },
  { collection: COMPETITIONS_COLLECTIONS.corrections, name: 'correction_competition', keys: { competitionId: 1, createdAt: 1 } }
];

/**
 * Bracket-version safeguards (DRAGON-10). One version record per (competition,
 * version number) and one active version per competition — the database authority
 * that makes concurrent regeneration/rollback produce exactly one active version.
 */
export const COMPETITIONS_VERSION_INDEXES: readonly IndexDeclaration[] = [
  { collection: COMPETITIONS_COLLECTIONS.versions, name: 'version_competition_number_unique', keys: { competitionId: 1, versionNumber: 1 }, options: { unique: true } },
  { collection: COMPETITIONS_COLLECTIONS.versions, name: 'version_active_unique', keys: { competitionId: 1 }, options: { unique: true, partialFilterExpression: { state: 'active' } } }
];
