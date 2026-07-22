import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { MEDIA_COLLECTIONS, MEDIA_INDEXES } from './collections.ts';

/** Creates the media asset + blob collections and their indexes. Idempotent. */
export const mediaMigration: Migration = {
  version: '021-media',
  description: 'Create media assets and blob storage for the media pipeline.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(MEDIA_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of MEDIA_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
