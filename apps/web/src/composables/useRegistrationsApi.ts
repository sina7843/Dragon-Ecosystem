import { apiFetch } from '../api.ts';

/**
 * Typed client for the registration surface (TOURN-004..017). The server owns every
 * eligibility, capacity, and authorization rule; these calls only shape requests.
 */

export type RegistrationState = 'pending' | 'approved' | 'waitlisted' | 'rejected' | 'cancelled';

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
