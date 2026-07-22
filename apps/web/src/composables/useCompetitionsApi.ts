import { apiFetch } from '../api.ts';

/**
 * Public competition reads (DRAGON-09c): current standings and a paginated bracket
 * for a published tournament. Participants are identified by seed number (names are
 * later presentation polish).
 */

export interface StandingsRowView {
  seed: number | null;
  rank: number;
  shared: boolean;
  played: number;
  wins: number;
  losses: number;
  points: number;
  placement: 'champion' | 'runner_up' | 'eliminated' | 'active' | 'ranked' | 'unresolved';
}

export interface StandingsView {
  format: string;
  status: 'final' | 'provisional' | 'partial';
  calculationVersion: number;
  lockState: 'open' | 'correction_limited' | 'locked';
  rows: StandingsRowView[];
}

export interface BracketMatchView {
  key: string;
  bracket: string;
  round: number;
  a: number | null;
  b: number | null;
  state: string;
  winner: number | null;
}

export interface BracketView {
  format: string;
  lockState: string;
  items: BracketMatchView[];
  nextCursor: string | null;
}

export function getStandings(tournamentId: string): Promise<StandingsView> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/standings`);
}

export function getBracket(tournamentId: string, cursor?: string): Promise<BracketView> {
  const q = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/bracket${q}`);
}
