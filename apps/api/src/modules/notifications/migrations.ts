import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { NOTIFICATIONS_COLLECTIONS, NOTIFICATIONS_INDEXES } from './collections.ts';

/** Creates the notification collections and their integrity indexes. Idempotent. */
export const notificationsMigration: Migration = {
  version: '018-notifications',
  description: 'Create notification inbox, delivery, template, enablement, and preference collections with integrity indexes.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(NOTIFICATIONS_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of NOTIFICATIONS_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
