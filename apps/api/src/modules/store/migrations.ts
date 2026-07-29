import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { STORE_COLLECTIONS, STORE_INDEXES } from './collections.ts';

/** Creates the commerce catalog, cart, order, and fulfillment collections. Idempotent. */
export const storeMigration: Migration = {
  version: '028-store',
  description: 'Create the store product, variant, inventory, cart, discount, order, fulfillment, and entitlement collections.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(STORE_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of STORE_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
