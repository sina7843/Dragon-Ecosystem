import type { Db } from 'mongodb';
import type { Migration } from './shared/db/migrations.ts';
import { REGISTRATIONS_COLLECTIONS, REGISTRATION_HISTORY_INDEXES } from './modules/registrations/collections.ts';

/**
 * Registration transition history and the account-list index (DRAGON-29E, PAGE-017/PAGE-018).
 *
 * Additive and idempotent. Two changes:
 *
 * 1. `registration_transitions` and its safeguards — the append-only trail that makes
 *    "status history" a queryable fact instead of an audit log the participant cannot read.
 * 2. `registration_account_created` on `registrations`, which serves the newest-first
 *    account list. The existing `registration_account` is `{accountId, tournamentId}` and
 *    cannot serve that sort.
 *
 * **No history is backfilled.** A registration that predates this migration keeps its current
 * state and gets an empty history, which is the honest record: its earlier transitions were
 * never captured, and inventing an actor, a reason or a timestamp for them would manufacture
 * evidence. The read model reports that absence explicitly rather than showing a gap.
 */
export const registrationHistoryMigration: Migration = {
  version: '032-registration-history',
  description: 'Create the registration transition-history collection and the account-list index.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    if (!existing.has(REGISTRATIONS_COLLECTIONS.transitions)) await db.createCollection(REGISTRATIONS_COLLECTIONS.transitions);

    for (const declaration of REGISTRATION_HISTORY_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }
  }
};
