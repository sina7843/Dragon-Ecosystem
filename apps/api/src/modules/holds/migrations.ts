import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { HOLDS_COLLECTIONS, HOLDS_INDEXES } from './collections.ts';

/** Creates the Dragon Coin hold collection and its integrity indexes. Idempotent. */
export const holdsMigration: Migration = {
  version: '015-holds',
  description: 'Create the Dragon Coin hold collection with business-reference and expiry indexes.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(HOLDS_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of HOLDS_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
