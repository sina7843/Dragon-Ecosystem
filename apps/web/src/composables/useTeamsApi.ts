import { apiFetch } from '../api.ts';

/**
 * Typed client for the teams surface (TEAM-001..012). The server owns every
 * authorization and state rule; these calls only shape requests and responses.
 */

export type TeamRole = 'owner' | 'member';
export type Visibility = 'private' | 'public';

export interface TeamSummary {
  id: string;
  slug: string;
  name: string;
  role: TeamRole;
  status: string;
}

export interface TeamMember {
  accountId: string;
  role: TeamRole;
  joinedAt: string;
  username: string | null;
  displayName: string | null;
}

export interface TeamDetail {
  id: string;
  slug: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  gameId: string;
  visibility: Visibility;
  status: string;
  version: number;
  viewerRole: TeamRole;
  members: TeamMember[];
}

export interface Invitation {
  id: string;
  teamId: string;
  teamName: string;
  expiresAt: string;
}

export interface PublicTeam {
  slug: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  gameId: string;
  members: TeamMember[];
}

export interface GamingIdentity {
  gameId: string;
  inGameName: string;
  visibility: Visibility;
}

export function listMyTeams(): Promise<{ items: TeamSummary[] }> {
  return apiFetch('/teams/mine');
}

export function getTeam(id: string): Promise<TeamDetail> {
  return apiFetch(`/teams/${encodeURIComponent(id)}`);
}

export function createTeam(input: { name: string; gameId: string; description?: string; avatarUrl?: string | null; visibility?: Visibility }): Promise<TeamDetail & { id: string }> {
  return apiFetch('/teams', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTeam(id: string, input: { name?: string; visibility?: Visibility; description?: string; avatarUrl?: string | null; expectedVersion?: number }): Promise<TeamDetail> {
  return apiFetch(`/teams/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function disbandTeam(id: string, reason: string): Promise<void> {
  return apiFetch(`/teams/${encodeURIComponent(id)}/disband`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function inviteMember(id: string, username: string): Promise<{ id: string }> {
  return apiFetch(`/teams/${encodeURIComponent(id)}/invitations`, { method: 'POST', body: JSON.stringify({ username }) });
}

export function removeMember(id: string, accountId: string, reason: string): Promise<void> {
  return apiFetch(`/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(accountId)}/remove`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function leaveTeam(id: string): Promise<void> {
  return apiFetch(`/teams/${encodeURIComponent(id)}/leave`, { method: 'POST' });
}

export function transferOwnership(id: string, accountId: string): Promise<void> {
  return apiFetch(`/teams/${encodeURIComponent(id)}/transfer`, { method: 'POST', body: JSON.stringify({ accountId }) });
}

export function captureSnapshot(id: string, reason: string): Promise<{ id: string }> {
  return apiFetch(`/teams/${encodeURIComponent(id)}/snapshots`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function listMyInvitations(): Promise<{ items: Invitation[] }> {
  return apiFetch('/invitations/mine');
}

export function acceptInvitation(id: string): Promise<{ id: string }> {
  return apiFetch(`/invitations/${encodeURIComponent(id)}/accept`, { method: 'POST' });
}

export function declineInvitation(id: string): Promise<void> {
  return apiFetch(`/invitations/${encodeURIComponent(id)}/decline`, { method: 'POST' });
}

export function getPublicTeam(slug: string): Promise<PublicTeam> {
  return apiFetch(`/public/teams/${encodeURIComponent(slug)}`);
}

export function listMyGamingIdentities(): Promise<{ items: GamingIdentity[] }> {
  return apiFetch('/account/gaming-identities');
}

export function saveGamingIdentity(input: { gameId: string; inGameName: string; visibility?: Visibility }): Promise<GamingIdentity> {
  return apiFetch('/account/gaming-identities', { method: 'PUT', body: JSON.stringify(input) });
}
