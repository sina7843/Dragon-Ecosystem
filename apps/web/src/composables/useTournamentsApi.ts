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
  /** Public lifecycle state. `completed` and `cancelled` are the archive; both stay readable. */
  state: PublicTournamentState;
}

/** The tournament states a visitor can ever see (draft and archived are never served). */
export type PublicTournamentState = 'published' | 'completed' | 'cancelled';

/**
 * One question on a tournament's registration form, localized to the requested locale.
 * A `file`/`image` answer is the `/media/<id>` path of an already uploaded asset; a
 * `multi_choice` answer is a comma-separated list of option indices.
 */
export interface PublicQuestion {
  key: string;
  prompt: string;
  type: 'short_text' | 'long_text' | 'number' | 'national_id' | 'single_choice' | 'multi_choice' | 'file' | 'image';
  required: boolean;
  options: string[];
  page: number;
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
  questions: PublicQuestion[];
  /** Number of steps in the entry form; 1 when it is not paged. */
  questionPages: number;
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
  /** Omitted lists what is open or running; `completed`/`cancelled` open the archive. */
  state?: PublicTournamentState;
  q?: string;
  cursor?: string;
}): Promise<Page<TournamentCard>> {
  return apiFetch(`/tournaments${query(params)}`);
}

/**
 * Public slugs for tournament ids. Domain events (and the notifications built from them)
 * carry ids, but the detail route is addressed by slug, so a link needs this hop.
 */
export function resolveTournamentSlugs(ids: readonly string[], locale: Locale): Promise<{ items: Array<{ id: string; slug: string; name: string }> }> {
  if (ids.length === 0) return Promise.resolve({ items: [] });
  return apiFetch(`/tournament-slugs${query({ locale, ids: [...new Set(ids)].join(',') })}`);
}

export function getTournament(slug: string, locale: Locale): Promise<TournamentDetail> {
  return apiFetch(`/tournaments/${encodeURIComponent(slug)}${query({ locale })}`);
}

export function tournamentCalendar(params: { locale: Locale; from: string; to: string }): Promise<Page<TournamentCard>> {
  return apiFetch(`/tournaments-calendar${query(params)}`);
}

/** Admin tournament record by id (the fields this view needs); carries the current version. */
export function getAdminTournament(id: string): Promise<{ id: string; version: number; participantsPublic: boolean; state: string }> {
  return apiFetch(`/admin/tournaments/${encodeURIComponent(id)}`);
}

/** Public participant list; only returns data when the organizer made it public (else 404). */
/**
 * One page of approved participants. The endpoint is cursor-paginated (DB-002), so a
 * large field arrives in bounded pages rather than one unbounded payload; the page size
 * is the endpoint's maximum to keep the round-trip count down.
 */
export function getTournamentParticipants(id: string, cursor?: string): Promise<{ items: PublicParticipant[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: '100' });
  if (cursor !== undefined) params.set('cursor', cursor);
  return apiFetch(`/tournaments/${encodeURIComponent(id)}/participants?${params.toString()}`);
}

/** Admin toggle for public participant visibility (any tournament state). */
export function setParticipantsVisibility(id: string, isPublic: boolean, expectedVersion: number): Promise<{ id: string; version: number; participantsPublic: boolean }> {
  return apiFetch(`/admin/tournaments/${encodeURIComponent(id)}/participants-visibility`, {
    method: 'POST',
    body: JSON.stringify({ isPublic, expectedVersion })
  });
}
