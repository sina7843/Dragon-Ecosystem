import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, ForbiddenError, NotFoundError, ProviderUnavailableError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import { applyTextSearch, normalizeQuery } from '../../shared/search.ts';
import { resolveSlug } from '../content/slug.ts';
import { STREAMS_COLLECTIONS } from './collections.ts';
import type { PlaybackConfig, StreamingProvider } from './provider.ts';
import {
  canStreamTransition,
  isPubliclyReadableStream,
  PUBLIC_STREAM_STATES,
  type AccessMode,
  type Locale,
  type StreamRecord,
  type StreamState,
  type StreamTranslation,
  type VodAssetRecord
} from './state.ts';
import {
  assertScheduleOrdering,
  buildArchivePolicy,
  buildLinks,
  buildTranslation,
  emptyLinks,
  emptyTranslation,
  parseDate,
  schedulingProblems,
  validateAccessMode,
  validateCoverImage,
  type ArchivePolicyInput,
  type LinksInput
} from './validation.ts';

/**
 * Stream catalog and provider orchestration (STREAM-001..012).
 *
 * Invariants:
 * - Dragon owns identity, schedule, relationships, access policy, and lifecycle; the
 *   provider owns delivery. A provider id never replaces a Dragon id (STREAM-001).
 * - Only a transition allowed by section 12.9 succeeds (STREAM-003).
 * - Access is decided here, before any provider playback data exists (BR-023, STREAM-006).
 * - Provisioning converges: a retry reuses the same provider resource (STREAM-007).
 * - Archive and takedown are inert until the rights policy is approved (OD-014).
 * - Every mutation writes an audit row in the same transaction as the state change.
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export interface StreamsConfig {
  /**
   * OD-014 gate covering stream rights, archive duration, takedown, and geographic
   * policy. Fail-closed: while it is false there is no approved archive duration and no
   * approved takedown policy, so both controls refuse rather than improvise one.
   */
  readonly rightsPolicyApproved: boolean;
  /** How long an issued playback link stays valid (secure-link abstraction). */
  readonly playbackTtlSeconds: number;
}

/**
 * Narrow operator-alert port (STREAM-008). The streams module raises an alert without
 * depending on the operations module's internals, mirroring how moderation reaches
 * identity through a suspend adapter only.
 */
export interface StreamAlerts {
  raise(context: RequestContext, input: { severity: 'warning' | 'critical'; message: string; detail: Readonly<Record<string, unknown>> }): Promise<void>;
}

export interface StreamInput {
  slug?: string;
  translations?: Partial<Record<Locale, Partial<StreamTranslation>>>;
  accessMode?: string;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  links?: LinksInput;
  archivePolicy?: ArchivePolicyInput;
  coverImageUrl?: string | null;
}

export interface UpdateStreamInput extends StreamInput {
  expectedVersion: number;
}

/** What a viewer receives once access is granted. Carries no provider credential. */
export interface PlaybackGrant {
  readonly streamId: EntityId;
  readonly accessMode: AccessMode;
  readonly config: PlaybackConfig;
}

export class StreamsService {
  readonly #database: Database;
  readonly #provider: StreamingProvider;
  readonly #config: StreamsConfig;
  readonly #alerts: StreamAlerts;

  constructor(database: Database, provider: StreamingProvider, config: StreamsConfig, alerts: StreamAlerts) {
    this.#database = database;
    this.#provider = provider;
    this.#config = config;
    this.#alerts = alerts;
  }

  get #db(): Db {
    return this.#database.db;
  }

  #streams(db: Db = this.#db) {
    return db.collection<StreamRecord>(STREAMS_COLLECTIONS.streams);
  }
  #vods(db: Db = this.#db) {
    return db.collection<VodAssetRecord>(STREAMS_COLLECTIONS.vodAssets);
  }

  /** Config a console can display without guessing which gate is on. */
  configView(): { rightsPolicyApproved: boolean; provider: string; playbackTtlSeconds: number } {
    return {
      rightsPolicyApproved: this.#config.rightsPolicyApproved,
      provider: this.#provider.name,
      playbackTtlSeconds: this.#config.playbackTtlSeconds
    };
  }

  // --- Authoring ---

  async create(context: RequestContext, input: StreamInput): Promise<StreamRecord> {
    const translations = {
      fa: buildTranslation(input.translations?.fa, emptyTranslation()),
      en: buildTranslation(input.translations?.en, emptyTranslation())
    };
    const scheduledStartAt = parseDate(input.scheduledStartAt, 'scheduledStartAt', null);
    const scheduledEndAt = parseDate(input.scheduledEndAt, 'scheduledEndAt', null);
    assertScheduleOrdering(scheduledStartAt, scheduledEndAt);

    const now = utcNow();
    const record: StreamRecord = {
      _id: newId(),
      slug: resolveSlug(input.slug, translations.en.title || translations.fa.title || 'stream'),
      state: 'draft',
      accessMode: validateAccessMode(input.accessMode, 'public'),
      translations,
      scheduledStartAt,
      scheduledEndAt,
      actualStartAt: null,
      actualEndAt: null,
      links: buildLinks(input.links, emptyLinks()),
      // Rights are never confirmed implicitly: an operator states the approval explicitly.
      rights: { confirmed: false, reference: null, confirmedAt: null, confirmedBy: null, takedownAt: null, takedownReason: null },
      archivePolicy: buildArchivePolicy(input.archivePolicy, { mode: 'disabled', retentionDays: null }, this.#config.rightsPolicyApproved),
      provider: {
        name: this.#provider.name,
        channelId: null,
        streamId: null,
        syncState: 'unlinked',
        lastSyncAt: null,
        lastError: null,
        attempts: 0
      },
      coverImageUrl: validateCoverImage(input.coverImageUrl, null),
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    await this.#write(context, record, 'stream.created', null, 'Stream created.');
    return record;
  }

  async update(context: RequestContext, id: EntityId, input: UpdateStreamInput): Promise<StreamRecord> {
    const current = await this.#require(id);
    this.#assertVersion(current, input.expectedVersion);
    // Editing is limited to states that have not run yet; an ended or archived stream is
    // a record of what happened and is not rewritten.
    if (current.state === 'ended' || current.state === 'archived' || current.state === 'cancelled') {
      throw new ConflictError('STREAM_NOT_EDITABLE', 'A finished or cancelled stream can no longer be edited.');
    }
    const translations = {
      fa: buildTranslation(input.translations?.fa, current.translations.fa),
      en: buildTranslation(input.translations?.en, current.translations.en)
    };
    const scheduledStartAt = parseDate(input.scheduledStartAt, 'scheduledStartAt', current.scheduledStartAt);
    const scheduledEndAt = parseDate(input.scheduledEndAt, 'scheduledEndAt', current.scheduledEndAt);
    assertScheduleOrdering(scheduledStartAt, scheduledEndAt);

    const next: StreamRecord = {
      ...current,
      slug: input.slug === undefined ? current.slug : resolveSlug(input.slug, translations.en.title || current.slug),
      translations,
      accessMode: validateAccessMode(input.accessMode, current.accessMode),
      scheduledStartAt,
      scheduledEndAt,
      links: buildLinks(input.links, current.links),
      archivePolicy: buildArchivePolicy(input.archivePolicy, current.archivePolicy, this.#config.rightsPolicyApproved),
      coverImageUrl: validateCoverImage(input.coverImageUrl, current.coverImageUrl),
      version: current.version + 1,
      updatedAt: utcNow()
    };
    // STREAM-011: a moved schedule is the thing followers were told about, so it publishes
    // a domain event; an edit that leaves the times alone does not.
    const rescheduled = next.scheduledStartAt !== current.scheduledStartAt || next.scheduledEndAt !== current.scheduledEndAt;
    await this.#write(context, next, 'stream.updated', current, 'Stream updated.', rescheduled);
    return next;
  }

  /**
   * Records the rights approval this stream relies on (section 27). It is deliberately a
   * separate, explicitly-reasoned action rather than a field on the edit form: nothing
   * else in the system may set it, and it is what unlocks scheduling.
   */
  async confirmRights(context: RequestContext, id: EntityId, input: { expectedVersion: number; reference: string }): Promise<StreamRecord> {
    const current = await this.#require(id);
    this.#assertVersion(current, input.expectedVersion);
    const actorId = context.actor.accountId;
    if (actorId === null) throw new ForbiddenError();
    const reference = input.reference.trim();
    if (reference === '') {
      throw new ValidationError('A rights reference is required.', [
        { field: 'reference', code: 'REQUIRED', message: 'Record which approval confirms these broadcast rights.' }
      ]);
    }
    const now = utcNow();
    const next: StreamRecord = {
      ...current,
      rights: { ...current.rights, confirmed: true, reference: reference.slice(0, 300), confirmedAt: now, confirmedBy: actorId },
      version: current.version + 1,
      updatedAt: now
    };
    await this.#write(context, next, 'stream.rights_confirmed', current, `Rights confirmed: ${reference.slice(0, 200)}`);
    return next;
  }

  /**
   * OD-014 takedown control. The gate is implemented; the policy behind it is not, so
   * while the rights/takedown policy is unapproved this refuses instead of inventing the
   * legal grounds on which content may be pulled.
   */
  async takedown(context: RequestContext, id: EntityId, input: { expectedVersion: number; reason: string }): Promise<StreamRecord> {
    if (!this.#config.rightsPolicyApproved) {
      throw new ForbiddenError('Takedown is unavailable: stream rights and takedown policy (OD-014) has not been approved.');
    }
    const current = await this.#require(id);
    this.#assertVersion(current, input.expectedVersion);
    const now = utcNow();
    const next: StreamRecord = {
      ...current,
      rights: { ...current.rights, takedownAt: now, takedownReason: input.reason.trim().slice(0, 300) },
      // A taken-down stream stops delivering: the archive policy is revoked with it, and
      // STREAM-010 highlights inherit that through their source VOD.
      archivePolicy: { mode: 'disabled', retentionDays: null },
      version: current.version + 1,
      updatedAt: now
    };
    await this.#write(context, next, 'stream.takedown', current, input.reason);
    await this.#vods().updateOne({ streamId: id }, { $set: { state: 'removed', updatedAt: now } });
    return next;
  }

  // --- Lifecycle (STREAM-003) ---

  async setState(context: RequestContext, id: EntityId, to: StreamState, input: { expectedVersion: number; reason: string }): Promise<StreamRecord> {
    const current = await this.#require(id);
    this.#assertVersion(current, input.expectedVersion);
    if (current.state === to) return current; // idempotent no-op
    if (!canStreamTransition(current.state, to)) {
      throw new ConflictError('STREAM_TRANSITION_NOT_ALLOWED', `A ${current.state} stream cannot move to ${to}.`);
    }
    if (to === 'scheduled') {
      const problems = schedulingProblems(current);
      if (problems.length > 0) throw new ValidationError('This stream is not ready to be scheduled.', problems);
    }
    if (to === 'archived' && !this.#config.rightsPolicyApproved) {
      throw new ForbiddenError('Archiving is unavailable: stream rights, retention, and takedown policy (OD-014) has not been approved.');
    }
    if (to === 'archived' && current.archivePolicy.mode !== 'retain') {
      throw new ValidationError('This stream has no archive policy.', [
        { field: 'archivePolicy.mode', code: 'ARCHIVE_DISABLED', message: 'Set the archive policy to "retain" before archiving.' }
      ]);
    }
    // Going live needs a provider resource: without one there is nothing to watch, and a
    // viewer would reach a live page that can never issue playback.
    if (to === 'live' && current.provider.syncState !== 'ready') {
      throw new ConflictError('STREAM_NOT_PROVISIONED', 'Provision the provider resource before going live.');
    }

    const now = utcNow();
    const next: StreamRecord = {
      ...current,
      state: to,
      actualStartAt: to === 'live' ? (current.actualStartAt ?? now) : current.actualStartAt,
      actualEndAt: to === 'ended' ? (current.actualEndAt ?? now) : current.actualEndAt,
      version: current.version + 1,
      updatedAt: now
    };
    await this.#write(context, next, `stream.${to}`, current, input.reason, to === 'scheduled' || to === 'cancelled');

    if (to === 'archived') await this.#openVodAsset(context, next);
    return next;
  }

  /**
   * STREAM-009: an enabled archive is tracked through its processing states. The asset is
   * created only on archival, only with the gate on, and only when the stream's own policy
   * retains it — so a disabled archive produces no VOD row and therefore no public VOD.
   */
  async #openVodAsset(context: RequestContext, stream: StreamRecord): Promise<void> {
    const now = utcNow();
    const asset: VodAssetRecord = {
      _id: newId(),
      streamId: stream._id,
      state: 'pending',
      providerAssetId: null,
      rightsReference: stream.rights.reference,
      retentionDays: stream.archivePolicy.retentionDays,
      createdAt: now,
      updatedAt: now
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#vods(uow.db).insertOne(asset, { session: uow.session });
        uow.audit({ action: 'stream.vod_opened', resourceType: 'stream_vod', resourceId: asset._id, after: { streamId: stream._id, state: asset.state }, reason: 'Archive retained.' });
      });
    } catch (error) {
      // Re-archiving an already-archived stream must not fail: the asset already exists.
      if (!isDuplicateKey(error)) throw error;
    }
  }

  async getVodAsset(streamId: EntityId): Promise<VodAssetRecord | null> {
    return this.#vods().findOne({ streamId });
  }

  // --- Provider orchestration (STREAM-007, STREAM-008) ---

  /**
   * Creates or reuses the provider resource for this stream.
   *
   * Idempotency is structural: the adapter derives its resource ids from the Dragon
   * stream id, so a retry after a timeout returns the same channel/stream and the unique
   * index on `(provider.name, provider.streamId)` refuses a second one regardless.
   */
  async provision(context: RequestContext, id: EntityId): Promise<StreamRecord> {
    const current = await this.#require(id);
    if (current.provider.syncState === 'ready' && current.provider.streamId !== null) return current;
    if (current.state === 'cancelled' || current.state === 'archived') {
      throw new ConflictError('STREAM_NOT_PROVISIONABLE', `A ${current.state} stream is not provisioned.`);
    }
    const channelKey = current.links.channelKeys[0] ?? current.slug;

    let result;
    try {
      result = await this.#provider.provision({ streamId: current._id, channelKey });
    } catch (error) {
      await this.#recordProviderFailure(context, current, error);
      throw new ProviderUnavailableError('The streaming provider could not be reached. The stream is marked unavailable; retry provisioning.');
    }

    const now = utcNow();
    const next: StreamRecord = {
      ...current,
      provider: {
        ...current.provider,
        name: this.#provider.name,
        channelId: result.channelId,
        streamId: result.streamId,
        syncState: result.ingestReady ? 'ready' : 'provisioning',
        lastSyncAt: now,
        lastError: null,
        attempts: current.provider.attempts + 1
      },
      version: current.version + 1,
      updatedAt: now
    };
    await this.#write(context, next, 'stream.provisioned', current, 'Provider resource provisioned.');
    return next;
  }

  /**
   * Re-reads the provider and converges the stored sync state (operator control).
   *
   * A resource the provider no longer knows about drops back to `unlinked` rather than
   * being silently reported as ready, which is what makes a later re-provision correct.
   */
  async reconcile(context: RequestContext, id: EntityId): Promise<StreamRecord> {
    const current = await this.#require(id);
    if (current.provider.streamId === null) {
      throw new ConflictError('STREAM_NOT_PROVISIONED', 'This stream has no provider resource to reconcile.');
    }
    let snapshot;
    try {
      snapshot = await this.#provider.describe(current.provider.streamId);
    } catch (error) {
      await this.#recordProviderFailure(context, current, error);
      throw new ProviderUnavailableError('The streaming provider could not be reached. The stream is marked unavailable; retry reconciliation.');
    }
    const now = utcNow();
    const next: StreamRecord = {
      ...current,
      provider: {
        ...current.provider,
        syncState: snapshot === null ? 'unlinked' : 'ready',
        channelId: snapshot === null ? null : current.provider.channelId,
        streamId: snapshot === null ? null : current.provider.streamId,
        lastSyncAt: now,
        lastError: null
      },
      version: current.version + 1,
      updatedAt: now
    };
    await this.#write(context, next, 'stream.reconciled', current, 'Provider state reconciled.');
    return next;
  }

  /**
   * Marks the stream unavailable and alerts an operator (STREAM-008).
   *
   * The stored detail is a bounded message plus the correlation id — never the provider's
   * raw error, which can carry a request URL or credential fragment. The alert is raised
   * after the state write so it is not rolled back with a retried transaction.
   */
  async #recordProviderFailure(context: RequestContext, current: StreamRecord, error: unknown): Promise<void> {
    const now = utcNow();
    const message = error instanceof Error ? error.message.slice(0, 200) : 'The provider request failed.';
    const next: StreamRecord = {
      ...current,
      provider: {
        ...current.provider,
        syncState: 'failed',
        lastSyncAt: now,
        lastError: { code: 'PROVIDER_UNAVAILABLE', message, correlationId: context.correlationId, occurredAt: now },
        attempts: current.provider.attempts + 1
      },
      version: current.version + 1,
      updatedAt: now
    };
    await this.#write(context, next, 'stream.provider_failed', current, 'Provider request failed.');
    await this.#alerts.raise(context, {
      severity: 'warning',
      message: `Streaming provider request failed for stream ${current.slug}.`,
      detail: { streamId: current._id, provider: this.#provider.name, attempts: next.provider.attempts, correlationId: context.correlationId }
    });
  }

  // --- Watch access (STREAM-005, STREAM-006, BR-023) ---

  /**
   * Decides access, then issues playback configuration. Order is the requirement: Dragon
   * validates before any provider data exists, so a direct call cannot obtain playable
   * data for a stream the caller may not watch.
   *
   * `viewerAccountId` is null for an anonymous caller. Every refusal below is a Dragon
   * decision; the provider is never consulted for one.
   */
  async issuePlaybackAccess(context: RequestContext, slug: string, viewerAccountId: EntityId | null): Promise<PlaybackGrant> {
    const stream = await this.#streams().findOne({ slug });
    // A draft stream is not merely unwatchable, it is not public: it 404s like any
    // unpublished resource rather than admitting it exists.
    if (stream === null || !isPubliclyReadableStream(stream.state)) throw new NotFoundError('Unknown stream.');
    if (stream.accessMode === 'authenticated' && viewerAccountId === null) {
      throw new ForbiddenError('Sign in to watch this stream.');
    }
    if (stream.rights.takedownAt !== null) throw new ForbiddenError('This stream is unavailable.');

    const archived = stream.state === 'archived';
    if (!(stream.state === 'live' || archived)) {
      throw new ConflictError('STREAM_NOT_PLAYABLE', 'This stream is not playing right now.');
    }
    if (archived) {
      // A disabled archive has no VOD, so there is nothing to issue (STREAM-009).
      const asset = await this.#vods().findOne({ streamId: stream._id });
      if (!this.#config.rightsPolicyApproved || asset === null || asset.state !== 'available') {
        throw new ConflictError('STREAM_ARCHIVE_UNAVAILABLE', 'No archive recording is available for this stream.');
      }
    }
    if (stream.provider.syncState !== 'ready' || stream.provider.streamId === null) {
      throw new ProviderUnavailableError('This stream is temporarily unavailable. Try again shortly.');
    }

    // The returned URLs necessarily carry the provider resource id — that is what a player
    // fetches. STREAM-001 constrains the *public* discovery and detail payloads, which
    // carry no provider field at all; this response is issued only after access is granted.
    const config = await this.#provider.playback({
      providerStreamId: stream.provider.streamId,
      // The scope is bound into the signature, so a link issued to one viewer cannot be
      // replayed as another. A public stream issues one shared anonymous scope.
      viewerScope: stream.accessMode === 'authenticated' ? (viewerAccountId ?? 'anonymous') : 'anonymous',
      ttlSeconds: this.#config.playbackTtlSeconds
    });
    return { streamId: stream._id, accessMode: stream.accessMode, config };
  }

  // --- Reads ---

  async getById(id: EntityId): Promise<StreamRecord | null> {
    return this.#streams().findOne({ _id: id });
  }

  async getPublicBySlug(slug: string): Promise<StreamRecord | null> {
    const stream = await this.#streams().findOne({ slug });
    return stream === null || !isPubliclyReadableStream(stream.state) ? null : stream;
  }

  /**
   * Public discovery (PAGE-027). Defaults to the live/upcoming shelf; the archive and the
   * called-off events are asked for explicitly so a finished stream never displaces a
   * running one. Relationship filters are what makes STREAM-004 resolve from the other
   * side: a game or tournament page asks for its own streams by id.
   */
  async listPublic(query: {
    locale: Locale;
    state?: StreamState;
    gameId?: string;
    tournamentId?: string;
    matchId?: string;
    q?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<StreamRecord>> {
    const limit = clampLimit(query.limit);
    const requested = query.state !== undefined && PUBLIC_STREAM_STATES.includes(query.state) ? [query.state] : ['scheduled', 'live', 'failed'];
    const filter: Record<string, unknown> = { state: requested.length === 1 ? requested[0] : { $in: requested } };
    if (query.gameId !== undefined) filter['links.gameIds'] = query.gameId;
    if (query.tournamentId !== undefined) filter['links.tournamentIds'] = query.tournamentId;
    if (query.matchId !== undefined) filter['links.matchIds'] = query.matchId;

    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ sortKey: { $gt: cursor.sortValue } }, { sortKey: cursor.sortValue, _id: { $gt: cursor.id } }];
    }
    const search = normalizeQuery(query.q);
    if (search !== null) applyTextSearch(filter, search, [`translations.${query.locale}.title`, `translations.${query.locale}.summary`]);

    // Soonest first. An unscheduled row sorts last rather than being dropped, so the
    // cursor walk never skips a stream that has no start time yet.
    const rows = await this.#streams()
      .aggregate<StreamRecord & { sortKey: string }>([
        { $addFields: { sortKey: { $ifNull: ['$scheduledStartAt', '9999-12-31T00:00:00.000Z'] } } },
        { $match: filter },
        { $sort: { sortKey: 1, _id: 1 } },
        { $limit: limit + 1 }
      ])
      .toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.sortKey, id: r._id })), limit);
    return {
      items: page.items.map(({ sortValue: _s, id: _i, sortKey: _k, ...rest }) => rest as StreamRecord),
      nextCursor: page.nextCursor
    };
  }

  async listForAdmin(query: { state?: StreamState; cursor?: string; limit?: number }): Promise<Page<StreamRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = {};
    if (query.state !== undefined) filter['state'] = query.state;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [{ updatedAt: { $lt: cursor.sortValue } }, { updatedAt: cursor.sortValue, _id: { $lt: cursor.id } }];
    }
    const rows = await this.#streams().find(filter).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.updatedAt, id: r._id })), limit);
    return {
      items: page.items.map(({ sortValue: _s, id: _i, ...rest }) => rest as StreamRecord),
      nextCursor: page.nextCursor
    };
  }

  // --- Internals ---

  async #require(id: EntityId): Promise<StreamRecord> {
    const stream = await this.#streams().findOne({ _id: id });
    if (stream === null) throw new NotFoundError('Unknown stream.');
    return stream;
  }

  #assertVersion(current: StreamRecord, expectedVersion: number): void {
    if (current.version !== expectedVersion) {
      throw new ConflictError('STREAM_STALE', 'This stream changed since you opened it. Reload and retry.');
    }
  }

  /**
   * One write path: the record replace, its audit row, and any schedule event commit
   * together, so an audit trail can never disagree with the stored state (AUDIT-001).
   */
  async #write(
    context: RequestContext,
    record: StreamRecord,
    action: string,
    previous: StreamRecord | null,
    reason: string,
    announceSchedule = false
  ): Promise<void> {
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        const streams = this.#streams(uow.db);
        if (previous === null) {
          await streams.insertOne(record, { session: uow.session });
        } else {
          const result = await streams.replaceOne({ _id: record._id, version: previous.version }, record, { session: uow.session });
          if (result.matchedCount === 0) throw new ConflictError('STREAM_STALE', 'This stream changed. Reload and retry.');
        }
        uow.audit({
          action,
          resourceType: 'stream',
          resourceId: record._id,
          before: previous === null ? null : { state: previous.state, syncState: previous.provider.syncState, version: previous.version },
          after: { state: record.state, syncState: record.provider.syncState, version: record.version },
          reason
        });
        if (announceSchedule) {
          // STREAM-011: one event per schedule change, per assigned streamer. The
          // notifications outbox turns it into deliveries and records every attempt, so
          // this module never talks to a channel itself.
          for (const accountId of record.links.streamerAccountIds) {
            uow.publish({
              eventName: 'stream.schedule_changed',
              eventVersion: 1,
              aggregateId: record._id,
              payload: { accountId, streamId: record._id, streamSlug: record.slug, state: record.state, scheduledStartAt: record.scheduledStartAt }
            });
          }
        }
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ValidationError('That slug is already in use.', [
          { field: 'slug', code: 'SLUG_TAKEN', message: 'Choose a different slug.' }
        ]);
      }
      throw error;
    }
  }
}
