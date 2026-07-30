import type { Db } from 'mongodb';
import type { Migration } from './shared/db/migrations.ts';
import { COMPETITIONS_COLLECTIONS, COMPETITIONS_SCHEDULE_INDEXES } from './modules/competitions/collections.ts';

/**
 * Match scheduling and its append-only history (DRAGON-29D; TOURN-019, TOURN-020, API-043).
 *
 * Two additive changes, both idempotent:
 *
 * 1. `competition_match_schedules` and its safeguards — the immutable revision trail that
 *    makes "record old/new time, actor, reason" a queryable fact rather than a log line.
 * 2. `scheduledAt: null` on existing matches, so the field is present everywhere rather
 *    than absent on old rows and null on new ones. This **backfills nothing but the
 *    absence**: a match that was never scheduled reads as "not scheduled", which is true.
 *    No time is invented, and no schedule-history row is fabricated for a match that was
 *    never rescheduled — an empty history is the honest record of a match nobody moved.
 *
 * The `$exists: false` filter is what makes the backfill idempotent and cheap on a second
 * run: once every match carries the field, the update matches nothing.
 */
export const matchSchedulingMigration: Migration = {
  version: '031-match-scheduling',
  description: 'Create the match-schedule history collection and add scheduledAt to existing matches.',

  async up(db: Db): Promise<void> {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    if (!existing.has(COMPETITIONS_COLLECTIONS.schedules)) await db.createCollection(COMPETITIONS_COLLECTIONS.schedules);

    for (const declaration of COMPETITIONS_SCHEDULE_INDEXES) {
      await db.collection(declaration.collection).createIndex(declaration.keys, { name: declaration.name, ...declaration.options });
    }

    await db
      .collection(COMPETITIONS_COLLECTIONS.matches)
      .updateMany({ scheduledAt: { $exists: false } }, { $set: { scheduledAt: null } });
  }
};
