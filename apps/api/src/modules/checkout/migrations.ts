import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { CHECKOUT_COLLECTIONS, CHECKOUT_INDEXES } from './collections.ts';

/** Creates the registration-checkout collection and its integrity indexes. Idempotent. */
export const checkoutMigration: Migration = {
  version: '016-checkout',
  description: 'Create the paid registration checkout collection with business-reference and provider indexes.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(CHECKOUT_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of CHECKOUT_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
