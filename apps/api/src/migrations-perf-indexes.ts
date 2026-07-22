import type { Db } from 'mongodb';
import type { Migration } from './shared/db/migrations.ts';
import { GAMES_COLLECTIONS } from './modules/games/collections.ts';
import { TEAMS_COLLECTIONS } from './modules/teams/collections.ts';
import { IDENTITY_COLLECTIONS } from './modules/identity/collections.ts';
import { OPERATIONS_COLLECTIONS } from './modules/operations/collections.ts';

/**
 * Performance indexes for public-directory and operator query shapes (DRAGON-16c). Each
 * closes a residual/collection-scan gap identified by measurement; `createIndex` is
 * idempotent, so this safely (re)ensures the indexes on an already-migrated database. It
 * lives at application level (not the shared kernel) because it spans several modules.
 */
export const perfIndexesMigration: Migration = {
  version: '022-perf-indexes',
  description: 'Add compound indexes for public game/team/profile directory sorts and job-status counts.',

  async up(db: Db): Promise<void> {
    await db.collection(GAMES_COLLECTIONS.games).createIndex({ status: 1, slug: 1 }, { name: 'game_status_slug' });
    await db.collection(TEAMS_COLLECTIONS.teams).createIndex({ visibility: 1, status: 1, slug: 1 }, { name: 'team_public_slug' });
    await db.collection(IDENTITY_COLLECTIONS.userProfiles).createIndex({ visibility: 1, username: 1 }, { name: 'profile_public_username' });
    await db.collection(OPERATIONS_COLLECTIONS.jobExecutions).createIndex({ status: 1, startedAt: -1 }, { name: 'job_status_started' });
  }
};
