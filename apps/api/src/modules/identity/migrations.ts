import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { IDENTITY_COLLECTIONS, IDENTITY_INDEXES } from './collections.ts';

/** Creates the identity collections and their indexes. Idempotent. */
export const identityMigration: Migration = {
  version: '002-identity',
  description: 'Create accounts, identity methods, OTP challenges, sessions, profiles, and security events.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

    for (const name of Object.values(IDENTITY_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }

    for (const declaration of IDENTITY_INDEXES) {
      await db
        .collection(declaration.collection)
        .createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
