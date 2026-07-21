import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { ADMIN_COLLECTIONS, ADMIN_INDEXES } from './collections.ts';

/** Creates the administration collections and their indexes. Idempotent. */
export const adminMigration: Migration = {
  version: '003-admin',
  description: 'Create role assignments and configuration versions for RBAC and versioned configuration.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

    for (const name of Object.values(ADMIN_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }

    for (const declaration of ADMIN_INDEXES) {
      await db
        .collection(declaration.collection)
        .createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
