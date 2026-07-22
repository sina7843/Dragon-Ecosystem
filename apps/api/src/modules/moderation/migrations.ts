import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { MODERATION_COLLECTIONS, MODERATION_INDEXES } from './collections.ts';

/** Creates moderation, support, and recovery collections with integrity indexes. Idempotent. */
export const moderationMigration: Migration = {
  version: '019-moderation',
  description: 'Create moderation report/case, support case, and recovery request collections with indexes.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(MODERATION_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of MODERATION_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
