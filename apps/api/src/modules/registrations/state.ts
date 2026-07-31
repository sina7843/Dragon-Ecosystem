import type { EntityId } from '../../shared/ids.ts';

/**
 * Tournament registration lifecycle (TOURN-004..017 registration scope).
 *
 * A registration is created `pending` (manual approval) or `approved`/`waitlisted`
 * (automatic approval), and an administrator moves it through the remaining states.
 * Only an `approved` registration occupies a capacity seat; a `waitlisted` one
 * holds an ordered queue position; `rejected`/`cancelled` are terminal and inactive.
 */

export const REGISTRATION_STATES = ['pending_payment', 'pending', 'approved', 'waitlisted', 'rejected', 'cancelled'] as const;
export type RegistrationState = (typeof REGISTRATION_STATES)[number];

const ALLOWED: Readonly<Record<RegistrationState, readonly RegistrationState[]>> = {
  // Paid checkout (DRAGON-12): a seat is reserved while payment settles; completion
  // activates it, cancellation/expiry releases it. It never becomes waitlisted.
  pending_payment: ['approved', 'cancelled'],
  pending: ['approved', 'waitlisted', 'rejected', 'cancelled'],
  waitlisted: ['approved', 'rejected', 'cancelled'],
  approved: ['cancelled'],
  rejected: [],
  cancelled: []
};

export function canRegistrationTransition(from: RegistrationState, to: RegistrationState): boolean {
  return ALLOWED[from].includes(to);
}

/** Active registrations count against the duplicate-prevention rule (TOURN-009). */
export function isActiveState(state: RegistrationState): boolean {
  return state === 'pending_payment' || state === 'pending' || state === 'approved' || state === 'waitlisted';
}

export type Seat = 'main' | 'waitlist' | 'none';
/** An approved registration and a paid registration awaiting payment both hold a main seat. */
export function seatOf(state: RegistrationState): Seat {
  if (state === 'approved' || state === 'pending_payment') return 'main';
  if (state === 'waitlisted') return 'waitlist';
  return 'none';
}

export type ParticipantType = 'individual' | 'team';

export interface RegistrationAnswer {
  key: string;
  value: string;
}

export interface RegistrationRecord {
  _id: EntityId;
  tournamentId: EntityId;
  participantType: ParticipantType;
  /** The acting registrant: the participant for an individual entry, the owner for a team entry. */
  accountId: EntityId;
  teamId: EntityId | null;
  /** Canonical participant key for duplicate prevention: accountId or teamId. */
  subjectId: EntityId;
  state: RegistrationState;
  /** Denormalized so a partial unique index can enforce one active entry per participant. */
  active: boolean;
  seat: Seat;
  answers: RegistrationAnswer[];
  /** TOURN-007: the question-set version the answers were captured against (immutable). */
  questionVersion: number;
  /** TOURN-010: immutable roster snapshot id for a team entry. */
  rosterSnapshotId: EntityId | null;
  /** Deterministic waitlist ordering token (monotonic per tournament). */
  waitlistSeq: number | null;
  createdAt: string;
  updatedAt: string;
  decidedBy: EntityId | null;
  decidedAt: string | null;
  reason: string | null;
  version: number;
}

/** Atomic seat counter per tournament (owned by the registrations module). */
export interface SeatCounterRecord {
  _id: EntityId; // tournamentId
  capacity: number;
  mainCount: number;
  /** Monotonic sequence handing out deterministic waitlist positions. */
  waitlistSeq: number;
}
