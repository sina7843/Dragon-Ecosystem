import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import { MEDIA_COLLECTIONS } from './collections.ts';
import type { MediaStorage } from './storage.ts';
import { detectImageType, type LocalizedAlt, type MediaRecord } from './state.ts';

/**
 * Media service (DRAGON-15). Validates uploads by their actual bytes (MEDIA-002),
 * enforces an allowlist + size cap (MEDIA-001), keeps assets nonpublic until an
 * explicit publish (MEDIA-003), content-addresses them for cacheable URLs + dedup
 * (MEDIA-007), blocks deletion of a referenced asset (MEDIA-008), and never publishes
 * a failed asset (MEDIA-015). Bytes live behind a storage adapter, never touched here.
 */

/** Owning-resource reference check (MEDIA-008), provided by the composition root so the
 * media module never reads another module's collections directly. */
export interface MediaReferences {
  isReferenced(publicUrl: string): Promise<boolean>;
}

export interface MediaConfigView {
  mediaMaxBytes: number;
}

/** The stable public URL for a published asset (MEDIA-007: content-addressed + versioned). */
export function mediaPublicUrl(mediaId: EntityId): string {
  return `/media/${mediaId}`;
}

function emptyAlt(): LocalizedAlt {
  return { fa: '', en: '' };
}
function normalizeAlt(alt: { fa?: string; en?: string } | undefined): LocalizedAlt {
  return { fa: (alt?.fa ?? '').slice(0, 300), en: (alt?.en ?? '').slice(0, 300) };
}

export class MediaService {
  readonly #database: Database;
  readonly #storage: MediaStorage;
  readonly #config: MediaConfigView;
  readonly #references: MediaReferences;

  constructor(database: Database, storage: MediaStorage, config: MediaConfigView, references: MediaReferences) {
    this.#database = database;
    this.#storage = storage;
    this.#config = config;
    this.#references = references;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #media(db: Db = this.#db) {
    return db.collection<MediaRecord>(MEDIA_COLLECTIONS.media);
  }

  /**
   * Accepts a base64-encoded upload, validates it by content, stores the bytes, and
   * records a nonpublic (`staged`) asset. Identical content deduplicates to the existing
   * asset (content-addressed). The client filename and MIME are never trusted.
   */
  async upload(context: RequestContext, uploaderId: EntityId, input: { data: string; alt?: { fa?: string; en?: string } }): Promise<MediaRecord> {
    // Bound the work before decoding: base64 expands the bytes by ~4/3, so a string longer
    // than that ratio of the cap cannot decode to an allowed size. This keeps the size cap
    // enforced here independent of any HTTP body limit (defence in depth).
    if (input.data.length > Math.ceil(this.#config.mediaMaxBytes * 1.4)) {
      throw new ValidationError('The upload exceeds the maximum size.', [{ field: 'data', code: 'MEDIA_TOO_LARGE', message: `Maximum ${this.#config.mediaMaxBytes} bytes.` }]);
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(input.data, 'base64');
    } catch {
      throw new ValidationError('The upload is not valid base64.', [{ field: 'data', code: 'INVALID_UPLOAD', message: 'Provide base64-encoded bytes.' }]);
    }
    // Reject an empty or oversize payload before any further work (MEDIA-001).
    if (bytes.length === 0) throw new ValidationError('The upload is empty.', [{ field: 'data', code: 'EMPTY_UPLOAD', message: 'Provide file bytes.' }]);
    if (bytes.length > this.#config.mediaMaxBytes) {
      throw new ValidationError('The upload exceeds the maximum size.', [{ field: 'data', code: 'MEDIA_TOO_LARGE', message: `Maximum ${this.#config.mediaMaxBytes} bytes.` }]);
    }
    // Content-based type validation (MEDIA-002): reject anything not matching an allowed signature.
    const detected = detectImageType(bytes);
    if (detected === null) {
      throw new ValidationError('The file type is not allowed.', [{ field: 'data', code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Allowed image types: PNG, JPEG, WEBP.' }]);
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    // Dedup: identical content is one asset (content-addressed).
    const existing = await this.#media().findOne({ sha256 });
    if (existing !== null) return existing;

    const storageKey = `${sha256}.${detected.ext}`;
    await this.#storage.put(storageKey, bytes);

    const now = utcNow();
    const record: MediaRecord = {
      _id: newId(),
      state: 'staged',
      contentType: detected.contentType,
      ext: detected.ext,
      byteSize: bytes.length,
      sha256,
      storageKey,
      derivatives: [],
      alt: normalizeAlt(input.alt),
      createdBy: uploaderId,
      correlationId: context.correlationId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      lastError: null
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#media(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'media.uploaded', resourceType: 'media', resourceId: record._id, after: { contentType: record.contentType, byteSize: record.byteSize } });
      });
    } catch (error) {
      // A concurrent upload of identical content won the unique-sha race — return theirs.
      if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
        const other = await this.#media().findOne({ sha256 });
        if (other !== null) return other;
      }
      throw error;
    }
    return record;
  }

  async getForAdmin(mediaId: EntityId): Promise<MediaRecord | null> {
    return this.#media().findOne({ _id: mediaId });
  }

  /** Bytes of a published asset for public serving; null when not published (MEDIA-003). */
  async getPublishedBytes(mediaId: EntityId): Promise<{ record: MediaRecord; bytes: Buffer } | null> {
    const record = await this.#media().findOne({ _id: mediaId, state: 'published' });
    if (record === null) return null;
    const bytes = await this.#storage.get(record.storageKey);
    if (bytes === null) return null;
    return { record, bytes };
  }

  async list(query: { state?: string; cursor?: string; limit?: number } = {}): Promise<Page<MediaRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = {};
    if (query.state) filter['state'] = query.state;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    const rows = await this.#media().find(filter).sort({ createdAt: -1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as MediaRecord), nextCursor: page.nextCursor };
  }

  /** Publishes a staged asset (MEDIA-003). A failed asset can never be published (MEDIA-015). */
  async publish(context: RequestContext, mediaId: EntityId, expectedVersion: number): Promise<MediaRecord> {
    const current = await this.#media().findOne({ _id: mediaId });
    if (current === null) throw new NotFoundError('Unknown media asset.');
    if (current.state === 'failed') throw new ConflictError('MEDIA_FAILED', 'A failed asset cannot be published; re-upload it.');
    if (current.state === 'published') return current;
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const updated = await this.#media(uow.db).updateOne({ _id: mediaId, version: expectedVersion, state: 'staged' }, { $set: { state: 'published', publishedAt: now, updatedAt: now }, $inc: { version: 1 } }, { session: uow.session });
      if (updated.matchedCount === 0) throw new ConflictError('STALE_MEDIA_VERSION', 'The asset changed since it was read. Reload and retry.');
      uow.audit({ action: 'media.published', resourceType: 'media', resourceId: mediaId });
      return { ...current, state: 'published', publishedAt: now, version: current.version + 1, updatedAt: now };
    });
  }

  async setAlt(context: RequestContext, mediaId: EntityId, alt: { fa?: string; en?: string }, expectedVersion: number): Promise<MediaRecord> {
    const current = await this.#media().findOne({ _id: mediaId });
    if (current === null) throw new NotFoundError('Unknown media asset.');
    const next = normalizeAlt(alt);
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const updated = await this.#media(uow.db).updateOne({ _id: mediaId, version: expectedVersion }, { $set: { alt: next, updatedAt: now }, $inc: { version: 1 } }, { session: uow.session });
      if (updated.matchedCount === 0) throw new ConflictError('STALE_MEDIA_VERSION', 'The asset changed since it was read. Reload and retry.');
      uow.audit({ action: 'media.alt_updated', resourceType: 'media', resourceId: mediaId });
      return { ...current, alt: next, version: current.version + 1, updatedAt: now };
    });
  }

  /** Deletes an asset, blocked while any resource still references its public URL (MEDIA-008). */
  async delete(context: RequestContext, mediaId: EntityId): Promise<void> {
    const current = await this.#media().findOne({ _id: mediaId });
    if (current === null) throw new NotFoundError('Unknown media asset.');
    if (await this.#references.isReferenced(mediaPublicUrl(mediaId))) {
      throw new ConflictError('MEDIA_IN_USE', 'This asset is referenced by published content and cannot be deleted. Replace the reference first.');
    }
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#media(uow.db).deleteOne({ _id: mediaId }, { session: uow.session });
      uow.audit({ action: 'media.deleted', resourceType: 'media', resourceId: mediaId, before: { state: current.state } });
    });
    // Only drop the bytes when no other asset shares this content address.
    const stillUsed = await this.#media().findOne({ storageKey: current.storageKey });
    if (stillUsed === null) await this.#storage.delete(current.storageKey);
  }
}

/** Compatibility export kept minimal; alt defaults live with the record. */
export { emptyAlt };
