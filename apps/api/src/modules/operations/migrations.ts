import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { OPERATIONS_COLLECTIONS, OPERATIONS_INDEXES } from './collections.ts';

/** Creates analytics, error, and alert collections with indexes. Idempotent. */
export const operationsMigration: Migration = {
  version: '020-operations',
  description: 'Create analytics event/error, ops alert collections and job-execution indexes.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(OPERATIONS_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of OPERATIONS_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
