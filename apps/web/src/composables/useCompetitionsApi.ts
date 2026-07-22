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

/**
 * Admin operations client (DRAGON-10). The server owns every authorization,
 * concurrency, and lifecycle rule; these calls only shape requests. Participants
 * are still surfaced by seed number.
 */

export type CompetitionFormat = 'single_elimination' | 'round_robin' | 'double_elimination' | 'swiss' | 'manual';

export interface AdminMatch {
  id: string;
  key: string;
  bracket: string;
  round: number;
  index: number;
  slotA: { registrationId: string } | null;
  slotB: { registrationId: string } | null;
  state: 'pending' | 'ready' | 'bye' | 'completed';
  winner: { registrationId: string } | null;
  scoreA: number | null;
  scoreB: number | null;
  version: number;
}

export interface AdminCompetition {
  id: string;
  format: CompetitionFormat;
  state: 'generated' | 'in_progress' | 'completed';
  participantCount: number;
  participants: Array<{ registrationId: string }>;
  swiss: { targetRounds: number; currentRound: number } | null;
  lockState: 'open' | 'correction_limited' | 'locked';
  lockVersion: number;
  activeVersion: number;
  version: number;
}

export interface AdminCompetitionView {
  competition: AdminCompetition;
  matches: AdminMatch[];
  nextCursor: string | null;
}

export interface BracketVersion {
  id: string;
  versionNumber: number;
  state: 'active' | 'superseded';
  origin: 'generation' | 'regeneration' | 'rollback';
  rolledBackFrom: number | null;
  reason: string | null;
  completedResultCount: number;
  participantCount: number;
  matchCount: number;
  createdAt: string;
  supersededAt: string | null;
}

export interface RegeneratePreview {
  format: CompetitionFormat;
  participantCount: number;
  currentCompletedResults: number;
  activeVersion: number;
  nextVersion: number;
  matchCount: number;
  rounds: number;
  locked: boolean;
}

const admin = (tournamentId: string): string => `/admin/tournaments/${encodeURIComponent(tournamentId)}`;

export function getAdminCompetition(tournamentId: string, cursor?: string): Promise<AdminCompetitionView> {
  const q = new URLSearchParams({ limit: '100' });
  if (cursor !== undefined) q.set('cursor', cursor);
  return apiFetch(`${admin(tournamentId)}/competition?${q.toString()}`);
}

export function generateCompetition(tournamentId: string, body: { seed?: string; legs?: number; targetRounds?: number } = {}): Promise<AdminCompetition> {
  return apiFetch(`${admin(tournamentId)}/competition`, { method: 'POST', body: JSON.stringify(body) });
}

export function recordMatchResult(tournamentId: string, matchId: string, body: { winnerSlot: 'a' | 'b'; scoreA?: number; scoreB?: number }): Promise<AdminMatch> {
  return apiFetch(`${admin(tournamentId)}/matches/${encodeURIComponent(matchId)}/result`, { method: 'POST', body: JSON.stringify(body) });
}

export function correctMatchResult(
  tournamentId: string,
  matchId: string,
  body: { expectedVersion: number; winnerSlot: 'a' | 'b'; scoreA?: number; scoreB?: number; reason: string; idempotencyKey: string }
): Promise<unknown> {
  return apiFetch(`${admin(tournamentId)}/matches/${encodeURIComponent(matchId)}/correct`, { method: 'POST', body: JSON.stringify(body) });
}

export function setCompetitionLock(tournamentId: string, lockState: 'open' | 'correction_limited' | 'locked', expectedLockVersion: number): Promise<AdminCompetition> {
  return apiFetch(`${admin(tournamentId)}/competition/lock`, { method: 'POST', body: JSON.stringify({ lockState, expectedLockVersion }) });
}

export function generateSwissRound(tournamentId: string): Promise<{ round: number; matchCount: number }> {
  return apiFetch(`${admin(tournamentId)}/competition/swiss-round`, { method: 'POST' });
}

export function listBracketVersions(tournamentId: string): Promise<{ versions: BracketVersion[] }> {
  return apiFetch(`${admin(tournamentId)}/competition/versions`);
}

export function previewRegenerate(tournamentId: string, body: { seed?: string } = {}): Promise<RegeneratePreview> {
  return apiFetch(`${admin(tournamentId)}/competition/regenerate/preview`, { method: 'POST', body: JSON.stringify(body) });
}

export function regenerateBracket(tournamentId: string, body: { expectedVersion: number; reason: string; confirm: boolean; seed?: string }): Promise<AdminCompetition> {
  return apiFetch(`${admin(tournamentId)}/competition/regenerate`, { method: 'POST', body: JSON.stringify(body) });
}

export function rollbackBracket(tournamentId: string, body: { expectedVersion: number; targetVersion: number; reason: string; confirm: boolean }): Promise<AdminCompetition> {
  return apiFetch(`${admin(tournamentId)}/competition/rollback`, { method: 'POST', body: JSON.stringify(body) });
}

export function newCorrectionKey(): string {
  return `corr-${crypto.randomUUID()}`;
}
