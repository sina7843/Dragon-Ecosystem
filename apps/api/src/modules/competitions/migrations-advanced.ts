import type { Db } from 'mongodb';
import type { Migration } from '../../shared/db/migrations.ts';
import { COMPETITIONS_ADVANCED_INDEXES } from './collections.ts';

/** Adds the advanced-format safeguards (unique logical fixture keys per competition). Idempotent. */
export const competitionsAdvancedMigration: Migration = {
  version: '010-competitions-advanced',
  description: 'Add the unique (competition, logical key) index for advanced competition formats.',

  async up(db: Db): Promise<void> {
    for (const declaration of COMPETITIONS_ADVANCED_INDEXES) {
      await db
        .collection(declaration.collection)
        .createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
