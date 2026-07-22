import { Binary, type Db } from 'mongodb';
import { MEDIA_COLLECTIONS } from './collections.ts';

/**
 * Storage-adapter boundary for media bytes (MEDIA storage adapter boundary). The
 * service never touches a concrete store directly; a deployment can swap this
 * Mongo-backed implementation for an object store (S3/GCS) without any service
 * change. Keys are content-addressed (the SHA-256 of the bytes), so a `put` of
 * identical content is idempotent and URLs are cacheable/immutable (MEDIA-007).
 */
export interface MediaStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

interface BlobRecord {
  _id: string;
  bytes: Binary;
}

/** Default adapter: stores bytes in a Mongo collection keyed by content address. */
export class MongoBlobStorage implements MediaStorage {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  #blobs() {
    return this.#db.collection<BlobRecord>(MEDIA_COLLECTIONS.blobs);
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    // Idempotent: a content-addressed key always maps to the same bytes.
    await this.#blobs().updateOne({ _id: key }, { $setOnInsert: { bytes: new Binary(bytes) } }, { upsert: true });
  }

  async get(key: string): Promise<Buffer | null> {
    const record = await this.#blobs().findOne({ _id: key });
    return record === null ? null : Buffer.from(record.bytes.buffer);
  }

  async delete(key: string): Promise<void> {
    await this.#blobs().deleteOne({ _id: key });
  }
}
