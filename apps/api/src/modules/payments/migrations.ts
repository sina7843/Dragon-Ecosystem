import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { PAYMENTS_COLLECTIONS, PAYMENTS_INDEXES } from './collections.ts';

/** Creates the Dragon Coin purchase collections and their integrity indexes. Idempotent. */
export const paymentsMigration: Migration = {
  version: '014-payments',
  description: 'Create Dragon Coin purchase and provider-event collections with integrity indexes.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(PAYMENTS_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of PAYMENTS_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
