/** Public surface of the media module (DRAGON-15, section 32.1). */
export { MediaService, mediaPublicUrl, type MediaReferences, type MediaConfigView } from './service.ts';
export { MongoBlobStorage, type MediaStorage } from './storage.ts';
export { registerMediaRoutes, type MediaAdminDeps } from './routes.ts';
export { mediaMigration } from './migrations.ts';
export { MEDIA_COLLECTIONS, MEDIA_INDEXES } from './collections.ts';
export { detectImageType, ACCEPTED_CONTENT_TYPES, type MediaRecord, type MediaState } from './state.ts';
