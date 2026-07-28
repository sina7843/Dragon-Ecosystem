import type { EntityId } from '../../shared/ids.ts';

/**
 * Stream lifecycle and record shape (STREAM-001, STREAM-003, DATA-042..044).
 *
 * Dragon owns stream identity, schedule, relationships, access policy, and lifecycle
 * state; the provider owns video delivery only. Provider identifiers live in a nested
 * `provider` block and never replace the Dragon id, so swapping providers leaves every
 * public stream id untouched (STREAM-001 acceptance).
 */

export const LOCALES = ['fa', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const STREAM_STATES = ['draft', 'scheduled', 'live', 'ended', 'cancelled', 'archived', 'failed'] as const;
export type StreamState = (typeof STREAM_STATES)[number];

/**
 * Section 12.9 exactly: draft → scheduled → live → ended → archived, with
 * draft/scheduled → cancelled, scheduled/live → failed, and a controlled recovery
 * out of failed. `cancelled` and `archived` are terminal.
 */
export const STREAM_TRANSITIONS: Readonly<Record<StreamState, readonly StreamState[]>> = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['live', 'cancelled', 'failed'],
  live: ['ended', 'failed'],
  ended: ['archived'],
  failed: ['scheduled', 'live', 'ended'],
  cancelled: [],
  archived: []
};

export function canStreamTransition(from: StreamState, to: StreamState): boolean {
  return (STREAM_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * States a visitor may read. Only `draft` is hidden: a cancelled stream has to say it
 * was called off rather than vanish, and a `failed` one is exactly the unavailable/retry
 * state PAGE-027 requires to be visible.
 */
export const PUBLIC_STREAM_STATES: readonly StreamState[] = ['scheduled', 'live', 'ended', 'cancelled', 'archived', 'failed'];

export function isPubliclyReadableStream(state: StreamState): boolean {
  return PUBLIC_STREAM_STATES.includes(state);
}

/** ASM-011: public or authenticated. Paid viewing is future scope and has no representation here. */
export const ACCESS_MODES = ['public', 'authenticated'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

/** Provider synchronisation state (DATA-043). `failed` is the user-visible unavailable state. */
export const SYNC_STATES = ['unlinked', 'provisioning', 'ready', 'failed'] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export const VOD_STATES = ['pending', 'processing', 'available', 'failed', 'removed'] as const;
export type VodState = (typeof VOD_STATES)[number];

export interface StreamTranslation {
  title: string;
  summary: string;
}

/** STREAM-004: zero or more of each relationship kind. */
export interface StreamLinks {
  gameIds: string[];
  tournamentIds: string[];
  matchIds: string[];
  /** Channel identity is a stable operator-chosen key; a channel entity is Phase 4 scope. */
  channelKeys: string[];
  streamerAccountIds: string[];
}

/**
 * Rights confirmation (section 27, OD-014). A stream cannot leave draft without it, and
 * the reference records which approval was relied on — the platform never infers a legal
 * permission it was not given.
 */
export interface StreamRights {
  confirmed: boolean;
  reference: string | null;
  confirmedAt: string | null;
  confirmedBy: EntityId | null;
  /** Set only by the OD-014 takedown control; a taken-down stream never issues playback. */
  takedownAt: string | null;
  takedownReason: string | null;
}

/** STREAM-009. `retentionDays` is null while OD-014 has not approved an archive duration. */
export interface ArchivePolicy {
  mode: 'disabled' | 'retain';
  retentionDays: number | null;
}

/**
 * The provider resource (DATA-043). Only opaque provider identifiers and a sync state are
 * stored: no key, token, secret, or management credential is ever persisted here or
 * serialised to a client (STREAM-002 acceptance).
 */
export interface ProviderResource {
  name: string;
  channelId: string | null;
  streamId: string | null;
  syncState: SyncState;
  lastSyncAt: string | null;
  /** Bounded, non-sensitive failure detail plus the correlation id (STREAM-008). */
  lastError: { code: string; message: string; correlationId: string; occurredAt: string } | null;
  /** How many provisioning attempts have been made; drives the operator retry view. */
  attempts: number;
}

export interface StreamRecord {
  _id: EntityId;
  slug: string;
  state: StreamState;
  accessMode: AccessMode;
  translations: Record<Locale, StreamTranslation>;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  links: StreamLinks;
  rights: StreamRights;
  archivePolicy: ArchivePolicy;
  provider: ProviderResource;
  coverImageUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** DATA-044. Retention is governed by the rights policy, not by the provider. */
export interface VodAssetRecord {
  _id: EntityId;
  streamId: EntityId;
  state: VodState;
  /** Opaque provider media reference; never a credentialed URL. */
  providerAssetId: string | null;
  rightsReference: string | null;
  retentionDays: number | null;
  createdAt: string;
  updatedAt: string;
}
