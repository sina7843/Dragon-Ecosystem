import type { Db } from 'mongodb';
import type { Migration } from './shared/db/migrations.ts';
import { EDUCATION_COLLECTIONS } from './modules/education/index.ts';

/**
 * Indexes serving the stuck-reservation recovery scan (DRAGON-27B).
 *
 * The index is also declared in the education module's own index list so a fresh database
 * gets it from `026-education`; this migration exists because that one has already run
 * everywhere else, and an index added to a declaration list is not retroactively created.
 *
 * Additive and idempotent: it creates an index and rewrites no record. The store's
 * equivalent (`order_state_created`) already existed, so only enrolments need one.
 */
export const recoveryIndexesMigration: Migration = {
  version: '030-recovery-indexes',
  description: 'Index course enrolments by state and creation time for the stuck-reservation scan.',

  async up(db: Db): Promise<void> {
    await db
      .collection(EDUCATION_COLLECTIONS.enrollments)
      .createIndex({ state: 1, createdAt: 1 }, { name: 'enrollment_state_created' });
  }
};
