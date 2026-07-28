/** Public surface of the streams module (section 32.1). */
export { StreamsService, type StreamsConfig, type StreamAlerts, type StreamInput, type PlaybackGrant } from './service.ts';
export { registerStreamsRoutes, type StreamsDeps } from './routes.ts';
export { streamsMigration } from './migrations.ts';
export { STREAMS_COLLECTIONS, STREAMS_INDEXES } from './collections.ts';
export { LocalStubStreamingProvider, type StreamingProvider, type PlaybackConfig } from './provider.ts';
export {
  canStreamTransition,
  isPubliclyReadableStream,
  STREAM_STATES,
  STREAM_TRANSITIONS,
  PUBLIC_STREAM_STATES,
  ACCESS_MODES,
  type StreamRecord,
  type StreamState,
  type AccessMode,
  type VodAssetRecord
} from './state.ts';
