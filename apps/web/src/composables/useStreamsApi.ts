import { apiFetch } from '../api.ts';
import type { Locale } from '../i18n/locale.ts';

/**
 * Typed client for the stream surface (STREAM-001..012).
 *
 * The public payloads carry Dragon fields only — no provider identifier ever reaches the
 * browser, which is what keeps a public stream id stable across a provider change
 * (STREAM-001). Playback configuration comes from its own call, and only after the server
 * has decided access (STREAM-006): the client never gates a stream itself.
 */

/** The stream states a visitor can ever see. `draft` is never served. */
export type PublicStreamState = 'scheduled' | 'live' | 'ended' | 'cancelled' | 'archived' | 'failed';
export type StreamState = PublicStreamState | 'draft';
export type AccessMode = 'public' | 'authenticated';

/**
 * Whether a play control can be offered right now. `unavailable` is the degraded state a
 * provider failure produces (STREAM-008): the page says so and offers a retry.
 */
export type StreamAvailability = 'playable' | 'unavailable' | 'not_playing';

export interface StreamCard {
  id: string;
  slug: string;
  locale: Locale;
  state: PublicStreamState;
  accessMode: AccessMode;
  title: string;
  summary: string;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  coverImageUrl: string | null;
  availability: StreamAvailability;
  links: { gameIds: string[]; tournamentIds: string[]; matchIds: string[]; channelKeys: string[] };
  archiveAvailable: boolean;
}

/** Provider-safe viewer configuration. The token inside the URLs is short-lived. */
export interface PlaybackGrant {
  streamId: string;
  accessMode: AccessMode;
  config: { provider: string; embedUrl: string; playbackUrl: string; expiresAt: string };
}

export interface StreamListQuery {
  locale: Locale;
  state?: PublicStreamState;
  game?: string;
  tournament?: string;
  match?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export function listStreams(query: StreamListQuery): Promise<{ items: StreamCard[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ locale: query.locale });
  for (const key of ['state', 'game', 'tournament', 'match', 'q', 'cursor'] as const) {
    const value = query[key];
    if (value !== undefined && value !== '') params.set(key, value);
  }
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return apiFetch(`/streams?${params.toString()}`);
}

export function getStream(slug: string, locale: Locale): Promise<StreamCard> {
  return apiFetch(`/streams/${encodeURIComponent(slug)}?locale=${locale}`);
}

/**
 * Asks the server for playback configuration. Every refusal (sign-in required, not
 * playing, provider unavailable) is the server's decision and surfaces as an
 * `ApiRequestError` the caller turns into a message.
 */
export function requestPlaybackAccess(slug: string): Promise<PlaybackGrant> {
  return apiFetch(`/streams/${encodeURIComponent(slug)}/playback-access`, { method: 'POST' });
}

// --- Operator console (PAGE-052) ---

export interface AdminStream {
  id: string;
  slug: string;
  state: StreamState;
  accessMode: AccessMode;
  translations: Record<Locale, { title: string; summary: string }>;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  links: { gameIds: string[]; tournamentIds: string[]; matchIds: string[]; channelKeys: string[]; streamerAccountIds: string[] };
  rights: { confirmed: boolean; reference: string | null; takedownAt: string | null };
  archivePolicy: { mode: 'disabled' | 'retain'; retentionDays: number | null };
  /** Operator-only: the provider resource and its sync state, never shown publicly. */
  provider: {
    name: string;
    channelId: string | null;
    streamId: string | null;
    syncState: 'unlinked' | 'provisioning' | 'ready' | 'failed';
    lastSyncAt: string | null;
    lastError: { code: string; message: string; correlationId: string; occurredAt: string } | null;
    attempts: number;
  };
  version: number;
  updatedAt: string;
}

export interface StreamingConfigView {
  provider: string;
  playbackTtlSeconds: number;
  /** OD-014. While false, archiving and takedown are refused by the server. */
  rightsPolicyApproved: boolean;
}

export function getStreamingConfig(): Promise<StreamingConfigView> {
  return apiFetch('/admin/streams/config');
}

export function listAdminStreams(query: { state?: StreamState; cursor?: string; limit?: number } = {}): Promise<{ items: AdminStream[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (query.state !== undefined) params.set('state', query.state);
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const suffix = params.toString();
  return apiFetch(`/admin/streams${suffix === '' ? '' : `?${suffix}`}`);
}

export function createStream(body: {
  slug?: string;
  accessMode?: AccessMode;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  translations?: Partial<Record<Locale, { title?: string; summary?: string }>>;
}): Promise<AdminStream> {
  return apiFetch('/admin/streams', { method: 'POST', body: JSON.stringify(body) });
}

export function confirmStreamRights(id: string, body: { expectedVersion: number; reference: string }): Promise<AdminStream> {
  return apiFetch(`/admin/streams/${encodeURIComponent(id)}/rights`, { method: 'POST', body: JSON.stringify(body) });
}

export function setStreamState(id: string, body: { state: StreamState; expectedVersion: number; reason: string }): Promise<AdminStream> {
  return apiFetch(`/admin/streams/${encodeURIComponent(id)}/state`, { method: 'POST', body: JSON.stringify(body) });
}

export function provisionStream(id: string): Promise<AdminStream> {
  return apiFetch(`/admin/streams/${encodeURIComponent(id)}/provision`, { method: 'POST' });
}

export function reconcileStream(id: string): Promise<AdminStream> {
  return apiFetch(`/admin/streams/${encodeURIComponent(id)}/reconcile`, { method: 'POST' });
}
