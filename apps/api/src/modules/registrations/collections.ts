import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the registrations module (TOURN-004..017 registration scope). */
export const REGISTRATIONS_COLLECTIONS = {
  registrations: 'registrations',
  seatCounters: 'tournament_seat_counters'
} as const;

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
