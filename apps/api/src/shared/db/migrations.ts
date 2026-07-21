import type { Db } from 'mongodb';
import { COLLECTIONS } from './collections.ts';
import { utcNow } from '../events.ts';

/**
 * Migration runner with version tracking (section 34.4).
 *
 * Migrations run through an explicit release step (`npm run migrate`) or the
 * controlled startup path, are idempotent, and multiple replicas must not race.
 */
export interface Migration {
  readonly version: string;
  readonly description: string;
  up(db: Db): Promise<void>;
}

type MigrationState = 'applying' | 'applied';

interface MigrationRecord {
  _id: string;
  description: string;
  state: MigrationState;
  startedAt: string;
  appliedAt: string | null;
}

const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export async function appliedVersions(db: Db): Promise<string[]> {
  const records = await db
    .collection<MigrationRecord>(COLLECTIONS.schemaMigrations)
    .find({ state: 'applied' }, { projection: { _id: 1 } })
    .toArray();
  return records.map((record) => record._id).sort();
}

/**
 * Applies every migration that has not been recorded yet and returns the versions
 * applied by this call. Already-applied versions are skipped, so re-running is safe.
 *
 * Concurrency: the claim is a unique `_id` insert, so a second replica loses the
 * race and skips instead of running the same migration twice.
 * ponytail: claim-by-insert only; if a process dies mid-migration the version stays
 * `applying` and is reported as stalled rather than silently retried. Add a lease
 * with an expiry if unattended recovery is ever required.
 */
export async function runMigrations(db: Db, migrations: readonly Migration[]): Promise<string[]> {
  assertUniqueVersions(migrations);
  const collection = db.collection<MigrationRecord>(COLLECTIONS.schemaMigrations);
  const applied: string[] = [];

  for (const migration of [...migrations].sort((a, b) => a.version.localeCompare(b.version))) {
    const existing = await collection.findOne({ _id: migration.version });
    if (existing?.state === 'applied') continue;
    if (existing?.state === 'applying') {
      throw new Error(
        `Migration ${migration.version} is recorded as "applying" since ${existing.startedAt}. ` +
          'Another process may be running it, or a previous run failed and needs manual review.'
      );
    }

    try {
      await collection.insertOne({
        _id: migration.version,
        description: migration.description,
        state: 'applying',
        startedAt: utcNow(),
        appliedAt: null
      });
    } catch (error) {
      // Another replica claimed this version first.
      if (isDuplicateKeyError(error)) continue;
      throw error;
    }

    await migration.up(db);
    await collection.updateOne(
      { _id: migration.version },
      { $set: { state: 'applied', appliedAt: utcNow() } }
    );
    applied.push(migration.version);
  }

  return applied;
}

function assertUniqueVersions(migrations: readonly Migration[]): void {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version ${migration.version}`);
    }
    seen.add(migration.version);
  }
}
