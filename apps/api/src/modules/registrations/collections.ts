import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the registrations module (TOURN-004..017 registration scope). */
export const REGISTRATIONS_COLLECTIONS = {
  registrations: 'registrations',
  seatCounters: 'tournament_seat_counters',
  transitions: 'registration_transitions'
} as const;

/**
 * Append-only registration transition history (DRAGON-29E, PAGE-017).
 *
 * `transition_registration_revision_unique` is the integrity authority rather than a
 * read-before-write: the revision is the registration version the transition produced, and
 * the registration write is itself version-guarded, so two concurrent decisions can never
 * both land a row for the same revision and fork the history.
 */
export const REGISTRATION_HISTORY_INDEXES: readonly IndexDeclaration[] = [
  { collection: 'registration_transitions', name: 'transition_registration_revision_unique', keys: { registrationId: 1, revision: 1 }, options: { unique: true } },
  // The per-registration history read, oldest first (a timeline reads forwards).
  { collection: 'registration_transitions', name: 'transition_registration_occurred', keys: { registrationId: 1, occurredAt: 1 } },
  /**
   * Serves the account list: filter `{ accountId }`, sort `{ createdAt: -1, _id: -1 }`,
   * keyset paginated on the same pair. `registration_account` is `{accountId, tournamentId}`
   * and cannot serve that sort — it would force an in-memory sort of every registration the
   * account has ever made. Write cost is one additional index entry per registration write,
   * on a collection whose writes are already transactional and low-volume per account.
   */
  { collection: REGISTRATIONS_COLLECTIONS.registrations, name: 'registration_account_created', keys: { accountId: 1, createdAt: -1, _id: -1 } }
];

export const REGISTRATIONS_INDEXES: readonly IndexDeclaration[] = [
  // TOURN-009: at most one active registration per (tournament, participant). The
  // partial unique index is the sole authority under concurrency — never a read.
  {
    collection: REGISTRATIONS_COLLECTIONS.registrations,
    name: 'registration_active_subject_unique',
    keys: { tournamentId: 1, subjectId: 1 },
    options: { unique: true, partialFilterExpression: { active: true } }
  },
  // Admin queue: filter by state, ordered stably; waitlist order is by waitlistSeq.
  { collection: REGISTRATIONS_COLLECTIONS.registrations, name: 'registration_tournament_state', keys: { tournamentId: 1, state: 1, waitlistSeq: 1, createdAt: 1 } },
  // A user's own registration status per tournament.
  { collection: REGISTRATIONS_COLLECTIONS.registrations, name: 'registration_account', keys: { accountId: 1, tournamentId: 1 } },
  // Keyset pagination over the whole queue.
  { collection: REGISTRATIONS_COLLECTIONS.registrations, name: 'registration_tournament_created', keys: { tournamentId: 1, createdAt: 1, _id: 1 } }
];
