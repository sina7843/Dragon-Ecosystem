import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the streams module (DATA-042, DATA-043, DATA-044). */
export const STREAMS_COLLECTIONS = {
  streams: 'streams',
  vodAssets: 'stream_vod_assets'
} as const;

export const STREAMS_INDEXES: readonly IndexDeclaration[] = [
  { collection: STREAMS_COLLECTIONS.streams, name: 'stream_slug_unique', keys: { slug: 1 }, options: { unique: true } },
  // Public discovery walks the readable states in schedule order, so the index carries the
  // whole sort key and the scan stays inside matching rows (PERF-010).
  { collection: STREAMS_COLLECTIONS.streams, name: 'stream_state_schedule', keys: { state: 1, scheduledStartAt: 1, _id: 1 } },
  // The operator console lists every state, newest change first.
  { collection: STREAMS_COLLECTIONS.streams, name: 'stream_updatedAt', keys: { updatedAt: -1, _id: -1 } },
  // STREAM-004: a game/tournament/match page resolves its streams from the other direction.
  { collection: STREAMS_COLLECTIONS.streams, name: 'stream_link_games', keys: { 'links.gameIds': 1, scheduledStartAt: 1 } },
  { collection: STREAMS_COLLECTIONS.streams, name: 'stream_link_tournaments', keys: { 'links.tournamentIds': 1, scheduledStartAt: 1 } },
  { collection: STREAMS_COLLECTIONS.streams, name: 'stream_link_matches', keys: { 'links.matchIds': 1, scheduledStartAt: 1 } },
  // STREAM-007: one provider resource per stream, so a retried provisioning cannot create
  // a second provider channel. Partial so unprovisioned streams do not collide on null.
  {
    collection: STREAMS_COLLECTIONS.streams,
    name: 'stream_provider_resource_unique',
    keys: { 'provider.name': 1, 'provider.streamId': 1 },
    options: { unique: true, partialFilterExpression: { 'provider.streamId': { $type: 'string' } } }
  },
  // A VOD asset belongs to exactly one stream (DATA-044).
  { collection: STREAMS_COLLECTIONS.vodAssets, name: 'vod_stream_unique', keys: { streamId: 1 }, options: { unique: true } },
  { collection: STREAMS_COLLECTIONS.vodAssets, name: 'vod_state_updatedAt', keys: { state: 1, updatedAt: -1 } }
];
