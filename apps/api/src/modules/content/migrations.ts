import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { CONTENT_COLLECTIONS, CONTENT_INDEXES } from './collections.ts';

/** Creates the content collections and their indexes. Idempotent. */
export const contentMigration: Migration = {
  version: '004-content',
  description: 'Create content items, revisions, categories, and tags for the CMS.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

    for (const name of Object.values(CONTENT_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }

    for (const declaration of CONTENT_INDEXES) {
      await db
        .collection(declaration.collection)
        .createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
