import type { Db } from 'mongodb';
import { COLLECTIONS, INDEX_DECLARATIONS } from '../collections.ts';
import type { Migration } from '../migrations.ts';

/**
 * Creates the foundation collections and their declared indexes.
 * Both operations are idempotent, so re-running the migration is harmless.
 */
export const foundationMigration: Migration = {
  version: '001-foundation',
  description: 'Create foundation collections and indexes for audit, outbox, idempotency, and jobs.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

    for (const name of Object.values(COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }

    for (const declaration of INDEX_DECLARATIONS) {
      await db
        .collection(declaration.collection)
        .createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};

export const migrations: readonly Migration[] = [foundationMigration];
