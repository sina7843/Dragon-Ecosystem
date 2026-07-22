import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { PRIZES_COLLECTIONS, PRIZES_INDEXES } from './collections.ts';

/** Creates the prize allocation and entitlement collections with integrity indexes. Idempotent. */
export const prizesMigration: Migration = {
  version: '017-prizes',
  description: 'Create prize allocation and entitlement collections with idempotency and uniqueness indexes.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(PRIZES_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of PRIZES_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
