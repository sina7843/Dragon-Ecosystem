import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { COMPETITIONS_COLLECTIONS, COMPETITIONS_VERSION_INDEXES } from './collections.ts';

/** Creates the bracket-version collection and its safeguards. Idempotent. */
export const competitionsVersionsMigration: Migration = {
  version: '012-competitions-versions',
  description: 'Create the bracket-version log with one-active-version and unique-version-number safeguards.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    if (!existing.has(COMPETITIONS_COLLECTIONS.versions)) await db.createCollection(COMPETITIONS_COLLECTIONS.versions);
    for (const declaration of COMPETITIONS_VERSION_INDEXES) {
      await db
        .collection(declaration.collection)
        .createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
