import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { GAMES_COLLECTIONS, GAMES_INDEXES } from './collections.ts';

/** Creates the games collection and its indexes. Idempotent. */
export const gamesMigration: Migration = {
  version: '005-games',
  description: 'Create the games catalog collection.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(GAMES_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of GAMES_INDEXES) {
      await db
        .collection(declaration.collection)
        .createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
