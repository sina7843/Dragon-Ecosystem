import { apiFetch } from '../api.ts';

/**
 * Upload center client (DRAGON-15 frontend). Wraps the media admin API into a
 * one-call "give me a usable image URL" helper for avatars, posters, content
 * covers, and inline body images.
 *
 * The server is the security boundary: it re-validates the bytes by signature,
 * enforces the real size cap, content-addresses + dedups, and only serves a
 * published asset. The client-side checks here are a fast, friendly pre-filter,
 * never the guarantee.
 */

/** Image signatures the media service accepts (MEDIA-002). */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Also match by extension: some browsers report an empty or nonstandard MIME (e.g. `image/x-png`). */
const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

/** File-input `accept` value: MIME types plus extensions, so no valid image is greyed out. */
export const IMAGE_ACCEPT = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_EXTENSIONS].join(',');

/**
 * Whether the file looks like an accepted image. The browser's reported `type` is
 * unreliable (empty for some PNGs, `image/x-png` on older systems), so an empty or
 * unknown type is allowed through — the server is the real gate, validating the actual
 * bytes by signature (MEDIA-002). Only a clearly non-image type is rejected here.
 */
function looksAccepted(file: File): boolean {
  const type = file.type.toLowerCase();
  if ((ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)) return true;
  const name = file.name.toLowerCase();
  if (ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  // Unknown/empty type with no telltale extension: defer to the server's signature check.
  return type === '' || type.startsWith('image/');
}

/** Default MEDIA_MAX_BYTES (apps/api config). The server enforces the authoritative cap. */
export const MAX_UPLOAD_BYTES = 20_000_000;

export interface UploadedMedia {
  id: string;
  /** Stable same-origin path, e.g. `/media/<id>`, safe to store as a resource reference. */
  url: string;
  contentType: string;
  byteSize: number;
}

interface MediaView {
  id: string;
  url: string;
  contentType: string;
  byteSize: number;
  version: number;
  state: string;
}

/** A locally-detectable reason an upload cannot succeed, as a stable code the UI localizes. */
export class UploadRejected extends Error {
  readonly code: 'UNSUPPORTED_MEDIA_TYPE' | 'MEDIA_TOO_LARGE' | 'EMPTY_UPLOAD';
  constructor(code: UploadRejected['code']) {
    super(code);
    this.name = 'UploadRejected';
    this.code = code;
  }
}

function toBase64(bytes: Uint8Array): string {
  // btoa needs a binary string; chunk to stay well under argument-length limits on large files.
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Uploads an image and publishes it, returning its public URL. Requires the
 * caller to hold `content.publish` (the server enforces it); a 403 surfaces as an
 * ApiRequestError for the view to handle.
 */
export async function uploadImage(file: File, alt?: { fa?: string; en?: string }): Promise<UploadedMedia> {
  if (file.size === 0) throw new UploadRejected('EMPTY_UPLOAD');
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadRejected('MEDIA_TOO_LARGE');
  if (!looksAccepted(file)) throw new UploadRejected('UNSUPPORTED_MEDIA_TYPE');

  const data = toBase64(new Uint8Array(await file.arrayBuffer()));
  // Self-service endpoint: any signed-in user can upload + publish (avatars, covers, body
  // images). The server validates bytes, caps size, dedups, and returns a usable /media URL.
  const published = await apiFetch<MediaView>('/media', {
    method: 'POST',
    body: JSON.stringify({ data, ...(alt === undefined ? {} : { alt }) })
  });

  return { id: published.id, url: published.url, contentType: published.contentType, byteSize: published.byteSize };
}
