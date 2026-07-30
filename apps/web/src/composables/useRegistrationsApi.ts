import { apiFetch } from '../api.ts';

/**
 * Typed client for the registration surface (TOURN-004..017). The server owns every
 * eligibility, capacity, and authorization rule; these calls only shape requests.
 */

/**
 * Mirrors the server's registration lifecycle. `pending_payment` is the seat a paid
 * checkout reserves while the payment settles — it was missing here, so the client could
 * not even name the state the API returns for an entry mid-checkout.
 */
export type RegistrationState = 'pending_payment' | 'pending' | 'approved' | 'waitlisted' | 'rejected' | 'cancelled';

export interface RegistrationStatus {
  id: string;
  tournamentId: string;
  participantType: 'individual' | 'team';
  teamId: string | null;
  state: RegistrationState;
  seat: 'main' | 'waitlist' | 'none';
  waitlistSeq: number | null;
  createdAt: string;
}

export interface AdminRegistration extends RegistrationStatus {
  accountId: string;
  /** Resolved display name (team name, or the entrant's display name); null if unresolved. */
  participantName: string | null;
  /** Individual entrant's username for a profile link; null for a team entry. */
  username: string | null;
  answers: Array<{ key: string; value: string }>;
  questionVersion: number;
  rosterSnapshotId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
}

export interface RegistrationQueue {
  items: AdminRegistration[];
  nextCursor: string | null;
  seats: { mainCount: number; waitlistCount: number };
}

/** A fresh idempotency key per submission attempt; reused only on retry of the same click. */
export function newIdempotencyKey(): string {
  return `reg-${crypto.randomUUID()}`;
}

export function registerForTournament(
  tournamentId: string,
  body: { idempotencyKey: string; teamId?: string; answers?: Array<{ key: string; value: string }> }
): Promise<RegistrationStatus> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/registration`, { method: 'POST', body: JSON.stringify(body) });
}

export function myRegistration(tournamentId: string): Promise<RegistrationStatus> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/registration/me`);
}

export function withdraw(tournamentId: string): Promise<RegistrationStatus> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/registration/withdraw`, { method: 'POST' });
}

export function listRegistrations(tournamentId: string, params: { state?: string; cursor?: string } = {}): Promise<RegistrationQueue> {
  const search = new URLSearchParams();
  if (params.state !== undefined && params.state !== '') search.set('state', params.state);
  if (params.cursor !== undefined) search.set('cursor', params.cursor);
  const s = search.toString();
  return apiFetch(`/admin/tournaments/${encodeURIComponent(tournamentId)}/registrations${s === '' ? '' : `?${s}`}`);
}

export function decideRegistration(
  tournamentId: string,
  registrationId: string,
  verb: 'approve' | 'reject' | 'waitlist' | 'promote' | 'cancel',
  reason?: string
): Promise<AdminRegistration> {
  return apiFetch(`/admin/tournaments/${encodeURIComponent(tournamentId)}/registrations/${encodeURIComponent(registrationId)}/${verb}`, {
    method: 'POST',
    body: JSON.stringify(reason === undefined ? {} : { reason })
  });
}

// --- Own registrations and matches (PAGE-017, PAGE-018) ---

/** A tournament reference; null on the record when the tournament no longer exists. */
export interface TournamentRef {
  id: string;
  slug: string;
  state: string;
}

export interface MyRegistration {
  id: string;
  tournamentId: string;
  tournament: TournamentRef | null;
  participantType: 'individual' | 'team';
  teamId: string | null;
  state: string;
  seat: string;
  waitlistSeq: number | null;
  createdAt: string;
  updatedAt: string;
}

/** One transition as the participant may see it: a role, never a staff identity or reason. */
export interface RegistrationTransition {
  fromState: string | null;
  toState: string;
  actor: 'participant' | 'staff' | 'system';
  occurredAt: string;
  revision: number;
}

export interface MyRegistrationDetail extends MyRegistration {
  history: RegistrationTransition[];
  /**
   * Whether the history begins at the registration's creation. False for a record that
   * predates the history migration — including one that has since been decided, where the
   * rows present are real but the earlier ones were never captured.
   */
  historyComplete: boolean;
}

export interface MyMatch {
  id: string;
  tournamentId: string;
  tournament: TournamentRef | null;
  round: number;
  bracket: string;
  state: 'pending' | 'ready' | 'bye' | 'completed';
  /** UTC ISO 8601, or null when the organizer has not scheduled it yet (TOURN-019). */
  scheduledAt: string | null;
  rescheduled: boolean;
  previousScheduledAt: string | null;
  opponent: { name: string | null; username: string | null; teamSlug: string | null } | null;
  won: boolean | null;
  scoreA: number | null;
  scoreB: number | null;
}

export function listMyRegistrations(cursor?: string): Promise<{ items: MyRegistration[]; nextCursor: string | null }> {
  const query = cursor === undefined || cursor === '' ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  return apiFetch(`/me/tournament-registrations${query}`);
}

export function getMyRegistration(registrationId: string): Promise<MyRegistrationDetail> {
  return apiFetch(`/me/tournament-registrations/${encodeURIComponent(registrationId)}`);
}

export function listMyMatches(): Promise<{ items: MyMatch[]; truncated: boolean }> {
  return apiFetch('/me/matches');
}
