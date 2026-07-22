import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { runMigrations } from './migrations.ts';
import { allMigrations } from '../../migrations.ts';
import { createTestDatabase, type TestDatabase } from './test-support.ts';

/**
 * Index-shape guardrails (DRAGON-16c). Asserts the compound indexes that keep the public
 * directory list sorts and the operator job-status count off a full-collection scan are
 * actually created by the migrations. A regression that drops one of these reintroduces a
 * residual/collection scan, so this pins the query shape rather than a latency number.
 */

let fixture: TestDatabase;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
});
after(async () => {
  await fixture.dispose();
});

async function indexKeys(collection: string): Promise<string[]> {
  const indexes = await fixture.database.db.collection(collection).indexes();
  return indexes.map((i) => JSON.stringify(i.key));
}

test('public game catalog has a status+slug index for the published-sorted list', async () => {
  assert.ok((await indexKeys('games')).includes(JSON.stringify({ status: 1, slug: 1 })));
});

test('public team directory has a visibility+status+slug index', async () => {
  assert.ok((await indexKeys('teams')).includes(JSON.stringify({ visibility: 1, status: 1, slug: 1 })));
});

test('public profile directory has a visibility+username index', async () => {
  assert.ok((await indexKeys('user_profiles')).includes(JSON.stringify({ visibility: 1, username: 1 })));
});

test('job executions have a status index for the metrics/health failed-count', async () => {
  assert.ok((await indexKeys('job_executions')).includes(JSON.stringify({ status: 1, startedAt: -1 })));
});
