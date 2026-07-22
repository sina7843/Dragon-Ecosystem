import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { COMPETITIONS_COLLECTIONS, COMPETITIONS_INDEXES } from './collections.ts';

/** Creates the competition and match collections and their indexes. Idempotent. */
export const competitionsMigration: Migration = {
  version: '009-competitions',
  description: 'Create competition and competition-match collections.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(COMPETITIONS_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of COMPETITIONS_INDEXES) {
      await db
        .collection(declaration.collection)
        .createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
