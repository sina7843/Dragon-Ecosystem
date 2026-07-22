/** Public surface of the content module (section 32.1). */
export { ContentService } from './service.ts';
export { registerContentRoutes, type ContentDeps } from './routes.ts';
export { CONTENT_TYPES } from './store.ts';
export type { ContentType, ContentLocale } from './store.ts';
