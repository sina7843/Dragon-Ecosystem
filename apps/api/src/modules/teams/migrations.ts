import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { TEAMS_COLLECTIONS, TEAMS_INDEXES } from './collections.ts';

/** Creates the teams collections and their indexes. Idempotent. */
export const teamsMigration: Migration = {
  version: '006-teams',
  description: 'Create persistent-team, membership, invitation, roster-snapshot, and gaming-identity collections.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(TEAMS_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of TEAMS_INDEXES) {
      await db
        .collection(declaration.collection)
        .createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
