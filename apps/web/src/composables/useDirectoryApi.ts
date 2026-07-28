import { apiFetch } from '../api.ts';

/**
 * Public team and player directories.
 *
 * Both endpoints already existed and were never called by anything: teams and player
 * profiles could only be reached by typing their URL. The server decides what is listed —
 * public, active teams and profiles their owner has published — so nothing here filters
 * for privacy, and a private profile is simply absent rather than hidden client-side.
 */

export interface TeamCard {
  slug: string;
  name: string;
  gameId: string;
  avatarUrl: string | null;
}

export interface PlayerCard {
  username: string;
  displayName: string;
}

export interface DirectoryPage<T> {
  items: T[];
  nextCursor: string | null;
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const s = search.toString();
  return s === '' ? '' : `?${s}`;
}

export function listPublicTeams(params: { q?: string; game?: string; cursor?: string; limit?: number } = {}): Promise<DirectoryPage<TeamCard>> {
  return apiFetch(`/public/teams${query({ ...params, limit: params.limit === undefined ? undefined : String(params.limit) })}`);
}

export function listPublicPlayers(params: { q?: string; cursor?: string; limit?: number } = {}): Promise<DirectoryPage<PlayerCard>> {
  return apiFetch(`/players${query({ ...params, limit: params.limit === undefined ? undefined : String(params.limit) })}`);
}
