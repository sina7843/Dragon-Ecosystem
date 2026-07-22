import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { REGISTRATIONS_COLLECTIONS, REGISTRATIONS_INDEXES } from './collections.ts';

/** Creates the registration and seat-counter collections and their indexes. Idempotent. */
export const registrationsMigration: Migration = {
  version: '008-registrations',
  description: 'Create tournament-registration and seat-counter collections.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(REGISTRATIONS_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of REGISTRATIONS_INDEXES) {
      await db
        .collection(declaration.collection)
        .createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
