import { apiFetch } from '../api.ts';

/**
 * Public player identity (section 16.4). Only a public profile resolves; a private or
 * unknown one is a 404, so this never leaks whether a private profile exists.
 */
export interface PublicPlayer {
  username: string;
  displayName: string;
}

export function getPublicPlayer(username: string): Promise<PublicPlayer> {
  return apiFetch<PublicPlayer>(`/players/${encodeURIComponent(username)}`);
}
