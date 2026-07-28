import type { Db } from 'mongodb';
import type { Migration } from './shared/db/migrations.ts';
import { COLLECTIONS } from './shared/db/collections.ts';

/**
 * Indexes for the administration audit list (AUDIT).
 *
 * The console's default view is the unfiltered, newest-first page, and the existing
 * indexes are all filter-led (`resourceType+resourceId`, `actor.accountId`,
 * `correlationId`), so none of them serves it: `explain()` reported a COLLSCAN with
 * `keysExamined: 0` and an in-memory sort. `audit_events` is append-only and the
 * fastest-growing collection, and a blocking sort eventually exceeds MongoDB's 32 MB
 * limit and fails the query outright rather than merely slowing it down.
 *
 * Both indexes match the exact sort key (`occurredAt` then `_id`) used for keyset
 * pagination, so the list becomes an index scan with no in-memory sort.
 * `createIndex` is idempotent, so this is safe to (re)run on a migrated database.
 */
export const auditIndexesMigration: Migration = {
  version: '023-audit-indexes',
  description: 'Add time-ordered indexes for the audit list and its emergency-only filter.',

  async up(db: Db): Promise<void> {
    const auditEvents = db.collection(COLLECTIONS.auditEvents);
    await auditEvents.createIndex({ occurredAt: -1, _id: -1 }, { name: 'audit_occurredAt_id' });
    await auditEvents.createIndex({ emergency: 1, occurredAt: -1, _id: -1 }, { name: 'audit_emergency_occurredAt_id' });
  }
};
