import { createHash, createHmac } from 'node:crypto';
import type { EntityId } from '../../shared/ids.ts';

/**
 * Streaming provider boundary (STREAM-002, section 33.1, INT adapter rule).
 *
 * Video delivery sits behind this interface so the domain never speaks a provider's
 * dialect. Two rules are structural rather than conventional:
 *
 * - Nothing here returns a provider credential. `provision` yields opaque resource ids
 *   and `playback` yields a short-lived, signed viewer configuration. A management key
 *   never leaves the server and is never stored on a stream record (STREAM-002).
 * - `provision` is keyed by the Dragon stream id, so a retry converges on the same
 *   provider resource instead of creating a second one (STREAM-007).
 *
 * OD-013 is a prompt-blocker: no Arvan-specific behaviour is implemented here, because
 * the contracted live/player/API/secure-link/archive capabilities are not confirmed.
 * The selection point lives in `config.ts` and refuses `arvan` with that reason, so the
 * boundary is real and the unverified provider cannot be silently half-implemented.
 */

export interface ProvisionRequest {
  /** Dragon's own stream id. The provider resource is derived from it, never the reverse. */
  readonly streamId: EntityId;
  readonly channelKey: string;
}

export interface ProvisionResult {
  readonly channelId: string;
  readonly streamId: string;
  readonly ingestReady: boolean;
}

export interface PlaybackRequest {
  readonly providerStreamId: string;
  /**
   * Who the link was issued to, as an opaque scope string (an account id, or `anonymous`
   * for a public stream). It is bound into the signature so a link issued for one viewer
   * scope cannot be replayed as another.
   */
  readonly viewerScope: string;
  readonly ttlSeconds: number;
}

/** Provider-safe viewer configuration. Carries a signed, expiring token — never a key. */
export interface PlaybackConfig {
  readonly provider: string;
  readonly embedUrl: string;
  readonly playbackUrl: string;
  readonly expiresAt: string;
}

/** Provider-side truth used for reconciliation; null when the resource is unknown there. */
export interface ProviderSnapshot {
  readonly providerStreamId: string;
  readonly live: boolean;
  readonly archiveReady: boolean;
}

export interface StreamingProvider {
  readonly name: string;
  provision(request: ProvisionRequest): Promise<ProvisionResult>;
  playback(request: PlaybackRequest): Promise<PlaybackConfig>;
  describe(providerStreamId: string): Promise<ProviderSnapshot | null>;
}

/** Stable provider-side identifier derived from a Dragon id, so provisioning is pure. */
function derive(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

/**
 * Deterministic in-repository provider (DEC: mock/stub adapters, section 35.4).
 *
 * It performs no network call and holds no state, which is what makes it deterministic:
 * the same stream id always yields the same provider resource, so provisioning is
 * idempotent by construction rather than by a bookkeeping table. Playback links are
 * signed with a server-side secret and expire, mirroring a secure-link scheme without
 * claiming any specific provider's implementation of one.
 */
export class LocalStubStreamingProvider implements StreamingProvider {
  readonly name = 'stub';
  readonly #secret: string;
  readonly #now: () => Date;

  constructor(secret: string, now: () => Date = () => new Date()) {
    if (secret.trim() === '') throw new TypeError('a secure-link secret is required');
    this.#secret = secret;
    this.#now = now;
  }

  async provision(request: ProvisionRequest): Promise<ProvisionResult> {
    return {
      channelId: derive('ch', `${this.name}:${request.channelKey}`),
      streamId: derive('st', `${this.name}:${request.streamId}`),
      ingestReady: true
    };
  }

  async playback(request: PlaybackRequest): Promise<PlaybackConfig> {
    const expiresAt = new Date(this.#now().getTime() + request.ttlSeconds * 1000).toISOString();
    const token = this.#sign(request.providerStreamId, request.viewerScope, expiresAt);
    const query = `?token=${token}&expires=${encodeURIComponent(expiresAt)}`;
    return {
      provider: this.name,
      embedUrl: `/stream-stub/embed/${encodeURIComponent(request.providerStreamId)}${query}`,
      playbackUrl: `/stream-stub/hls/${encodeURIComponent(request.providerStreamId)}/index.m3u8${query}`,
      expiresAt
    };
  }

  /**
   * The stub has no provider-side lifecycle of its own, so it reports the resource as
   * present and idle. Reconciliation therefore proves the convergence path without
   * inventing provider behaviour that was never contracted (OD-013).
   */
  async describe(providerStreamId: string): Promise<ProviderSnapshot | null> {
    if (providerStreamId.trim() === '') return null;
    return { providerStreamId, live: false, archiveReady: false };
  }

  #sign(providerStreamId: string, viewerScope: string, expiresAt: string): string {
    return createHmac('sha256', this.#secret)
      .update(`${providerStreamId}.${viewerScope}.${expiresAt}`)
      .digest('base64url');
  }
}
