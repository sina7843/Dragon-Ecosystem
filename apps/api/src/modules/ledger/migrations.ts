import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { LEDGER_COLLECTIONS, LEDGER_INDEXES } from './collections.ts';

/** Creates the ledger collections and their integrity safeguards. Idempotent. */
export const ledgerMigration: Migration = {
  version: '013-ledger',
  description: 'Create the immutable double-entry ledger (accounts, transactions, entries) with integrity indexes.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of Object.values(LEDGER_COLLECTIONS)) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    for (const declaration of LEDGER_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
