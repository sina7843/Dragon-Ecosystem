import { apiFetch } from '../api.ts';
import type { Locale } from '../i18n/locale.ts';

/**
 * Typed client for the tournaments surface (TOURN-001..030 authoring scope). The
 * server owns every lifecycle and authorization rule; these calls shape requests
 * and responses only. No payment is executed here — fees/prizes are definitions.
 */

export interface MoneyView {
  assetCode: 'IRR' | 'DRC';
  amountInteger: number;
  scale: number;
}

export interface FeeView {
  kind: 'free' | 'toman' | 'dragon_coin' | 'mixed';
  components: MoneyView[];
}

export interface PrizeView {
  version: number;
  placements: Array<{ rank: number; rewards: MoneyView[] }>;
}

export interface TournamentCard {
  id: string;
  slug: string;
  name: string;
  summary: string;
  gameId: string;
  participantType: 'individual' | 'team';
  format: string;
  feeKind: FeeView['kind'];
  startAt: string | null;
  endAt: string | null;
  capacity: number;
  coverImageUrl: string | null;
}

export interface TournamentDetail extends TournamentCard {
  locale: Locale;
  description: string;
  seoTitle: string;
  seoDescription: string;
  rules: string;
  registration: { opensAt: string | null; closesAt: string | null };
  approvalMode: 'automatic' | 'manual';
  waitlistMode: 'enabled' | 'disabled';
  eligibility: { minAge: number | null; requireCompleteProfile: boolean; requireGameIdentity: boolean };
  fee: FeeView;
  prizes: PrizeView;
  refundPolicy: { kind: string; text: string };
  questions: Array<{ key: string; prompt: string; type: 'short_text' | 'long_text' | 'single_choice'; required: boolean; options: string[] }>;
  publishedAt: string | null;
  /** Whether the approved participant list is shown publicly. */
  participantsPublic: boolean;
}

export interface PublicParticipant {
  registrationId: string;
  participantType: 'individual' | 'team';
  name: string | null;
  /** Individual entrant's username, for a public player link. */
  username: string | null;
  /** Team entry's slug, for a public team link. */
  teamSlug: string | null;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, v);
  const s = search.toString();
  return s === '' ? '' : `?${s}`;
}

export function listTournaments(params: {
  locale: Locale;
  game?: string;
  participantType?: string;
  format?: string;
  q?: string;
  cursor?: string;
}): Promise<Page<TournamentCard>> {
  return apiFetch(`/tournaments${query(params)}`);
}

export function getTournament(slug: string, locale: Locale): Promise<TournamentDetail> {
  return apiFetch(`/tournaments/${encodeURIComponent(slug)}${query({ locale })}`);
}

export function tournamentCalendar(params: { locale: Locale; from: string; to: string }): Promise<Page<TournamentCard>> {
  return apiFetch(`/tournaments-calendar${query(params)}`);
}

/** Admin tournament record by id (the fields this view needs); carries the current version. */
export function getAdminTournament(id: string): Promise<{ id: string; version: number; participantsPublic: boolean }> {
  return apiFetch(`/admin/tournaments/${encodeURIComponent(id)}`);
}

/** Public participant list; only returns data when the organizer made it public (else 404). */
export function getTournamentParticipants(id: string): Promise<{ items: PublicParticipant[] }> {
  return apiFetch(`/tournaments/${encodeURIComponent(id)}/participants`);
}

/** Admin toggle for public participant visibility (any tournament state). */
export function setParticipantsVisibility(id: string, isPublic: boolean, expectedVersion: number): Promise<{ id: string; version: number; participantsPublic: boolean }> {
  return apiFetch(`/admin/tournaments/${encodeURIComponent(id)}/participants-visibility`, {
    method: 'POST',
    body: JSON.stringify({ isPublic, expectedVersion })
  });
}
