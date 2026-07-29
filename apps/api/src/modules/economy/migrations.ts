import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { ECONOMY_COLLECTIONS, ECONOMY_INDEXES } from './collections.ts';

/** Creates the coin transfer, reward rule, and reward grant collections. Idempotent. */
export const economyMigration: Migration = {
  version: '029-economy',
  description: 'Create the Dragon Coin transfer, reward rule, and reward grant collections.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(ECONOMY_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of ECONOMY_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
