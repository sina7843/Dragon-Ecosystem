import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the media module (DRAGON-15). No other module reads these directly. */
export const MEDIA_COLLECTIONS = {
  media: 'media_assets',
  blobs: 'media_blobs'
} as const;

export const MEDIA_INDEXES: readonly IndexDeclaration[] = [
  // Content-addressed dedup: at most one asset per byte content (MEDIA-007).
  { collection: MEDIA_COLLECTIONS.media, name: 'media_sha256_unique', keys: { sha256: 1 }, options: { unique: true } },
  // Public serve + admin listing by state, newest first.
  { collection: MEDIA_COLLECTIONS.media, name: 'media_state_created', keys: { state: 1, createdAt: -1 } }
];
