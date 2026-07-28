import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { STREAMS_COLLECTIONS, STREAMS_INDEXES } from './collections.ts';

/** Creates the stream catalog and VOD-asset collections and their indexes. Idempotent. */
export const streamsMigration: Migration = {
  version: '024-streams',
  description: 'Create the stream catalog and VOD asset collections.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(STREAMS_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of STREAMS_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
