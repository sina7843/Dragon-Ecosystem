import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { CHAT_COLLECTIONS, CHAT_INDEXES } from './collections.ts';

/** Creates the chat room, message, and restriction collections and their indexes. Idempotent. */
export const chatMigration: Migration = {
  version: '025-chat',
  description: 'Create the live chat room, message, and restriction collections.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(CHAT_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of CHAT_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
