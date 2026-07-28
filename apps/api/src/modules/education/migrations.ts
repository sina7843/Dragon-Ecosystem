import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { EDUCATION_COLLECTIONS, EDUCATION_INDEXES } from './collections.ts';

/** Creates the course, lesson, enrollment, progress, review, and coach collections. Idempotent. */
export const educationMigration: Migration = {
  version: '026-education',
  description: 'Create the education (course, lesson, enrollment, progress, review, coach) collections.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(EDUCATION_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of EDUCATION_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
