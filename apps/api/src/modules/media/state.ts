import type { EntityId } from '../../shared/ids.ts';

/**
 * Media domain types (DRAGON-15, MEDIA-001..010/015).
 *
 * Media is validated by its actual bytes (magic-byte signature), never by the
 * client-supplied filename or MIME type (MEDIA-002). An upload stays `staged`
 * (nonpublic) until an explicit publish (MEDIA-003); only a `published` asset is
 * served publicly. Assets are content-addressed by the SHA-256 of their bytes
 * (MEDIA-007), which also deduplicates identical uploads.
 */

export type MediaState = 'staged' | 'published' | 'failed';

export interface LocalizedAlt {
  /** Localized alternative text (MEDIA-009). An empty string marks a decorative image (MEDIA-010). */
  readonly fa: string;
  readonly en: string;
}

export interface MediaDerivative {
  /** e.g. 'thumbnail' — the rendition kind. */
  readonly kind: string;
  readonly storageKey: string;
  readonly contentType: string;
  readonly byteSize: number;
}

export interface MediaRecord {
  readonly _id: EntityId;
  state: MediaState;
  /** Validated image MIME derived from the bytes, never from the client. */
  readonly contentType: string;
  readonly ext: string;
  readonly byteSize: number;
  /** SHA-256 of the original bytes — the content address (MEDIA-007) and dedup key. */
  readonly sha256: string;
  /** Storage-adapter key for the original bytes. */
  readonly storageKey: string;
  /** Original ↔ derivative relationships are retained (MEDIA-005). */
  readonly derivatives: readonly MediaDerivative[];
  alt: LocalizedAlt;
  readonly createdBy: EntityId;
  readonly correlationId: string;
  version: number;
  readonly createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  /** Set when validation/processing failed (MEDIA-015); a failed asset can never publish. */
  lastError: string | null;
}

/**
 * Allowlist of accepted image types (MEDIA-001): MIME, extension, and the leading
 * magic bytes that must match the actual file content (MEDIA-002).
 */
interface Signature {
  readonly contentType: string;
  readonly ext: string;
  readonly magic: readonly number[];
  /** Optional bytes that must appear at a fixed later offset (e.g. WEBP's 'WEBP' at 8). */
  readonly at8?: readonly number[];
}

const SIGNATURES: readonly Signature[] = [
  { contentType: 'image/png', ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { contentType: 'image/jpeg', ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  // RIFF....WEBP
  { contentType: 'image/webp', ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46], at8: [0x57, 0x45, 0x42, 0x50] }
];

export const ACCEPTED_CONTENT_TYPES: readonly string[] = SIGNATURES.map((s) => s.contentType);

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Identifies an image purely from its bytes. Returns the validated MIME + extension,
 * or null when the content matches no allowed signature (MEDIA-001/002). The
 * client-provided filename and MIME are never trusted for this decision.
 */
export function detectImageType(bytes: Uint8Array): { contentType: string; ext: string } | null {
  for (const sig of SIGNATURES) {
    if (!startsWith(bytes, sig.magic)) continue;
    if (sig.at8 !== undefined && !startsWith(bytes, sig.at8, 8)) continue;
    return { contentType: sig.contentType, ext: sig.ext };
  }
  return null;
}
