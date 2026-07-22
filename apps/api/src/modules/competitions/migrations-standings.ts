import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { COMPETITIONS_COLLECTIONS, COMPETITIONS_STANDINGS_INDEXES } from './collections.ts';

/** Creates the standings and result-correction collections and their safeguards. Idempotent. */
export const competitionsStandingsMigration: Migration = {
  version: '011-competitions-standings',
  description: 'Create competition standings and result-correction collections with concurrency safeguards.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of [COMPETITIONS_COLLECTIONS.standings, COMPETITIONS_COLLECTIONS.corrections]) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of COMPETITIONS_STANDINGS_INDEXES) {
      await db
        .collection(declaration.collection)
        .createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
