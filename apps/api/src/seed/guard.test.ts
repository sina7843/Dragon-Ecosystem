import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSeedAllowed, databaseNameFromUri, SeedRefused } from './guard.ts';

test('database name is parsed from a mongodb URI', () => {
  assert.equal(databaseNameFromUri('mongodb://mongo:27017/dragon_dev?replicaSet=rs0'), 'dragon_dev');
  assert.equal(databaseNameFromUri('mongodb://127.0.0.1:27018/dragon_demo?directConnection=true'), 'dragon_demo');
  assert.equal(databaseNameFromUri('mongodb+srv://host/dragon_local'), 'dragon_local');
  assert.equal(databaseNameFromUri('mongodb://mongo:27017/'), '');
});

test('seeding is allowed only in development on a dev/demo/local database', () => {
  assert.equal(assertSeedAllowed({ env: 'development', mongoUri: 'mongodb://mongo:27017/dragon_dev?replicaSet=rs0' }), 'dragon_dev');
  assert.equal(assertSeedAllowed({ env: 'development', mongoUri: 'mongodb://x/dragon_demo' }), 'dragon_demo');
  assert.equal(assertSeedAllowed({ env: 'development', mongoUri: 'mongodb://x/dragon_local' }), 'dragon_local');
});

test('production and test environments fail closed', () => {
  assert.throws(() => assertSeedAllowed({ env: 'production', mongoUri: 'mongodb://x/dragon_dev' }), SeedRefused);
  assert.throws(() => assertSeedAllowed({ env: 'test', mongoUri: 'mongodb://x/dragon_dev' }), SeedRefused);
  assert.throws(() => assertSeedAllowed({ env: 'staging', mongoUri: 'mongodb://x/dragon_dev' }), SeedRefused);
});

test('a production-like database name is refused', () => {
  // The production database is exactly "dragon" (no dev/demo/local marker).
  assert.throws(() => assertSeedAllowed({ env: 'development', mongoUri: 'mongodb://mongo:27017/dragon?replicaSet=rs0' }), SeedRefused);
  // A name without "dragon" is refused even with a dev marker.
  assert.throws(() => assertSeedAllowed({ env: 'development', mongoUri: 'mongodb://x/prod_dev' }), SeedRefused);
  // A throwaway integration-test database (dragon_test_*) is refused — it has no dev marker.
  assert.throws(() => assertSeedAllowed({ env: 'development', mongoUri: 'mongodb://x/dragon_test_abc' }), SeedRefused);
  // No database path at all is refused.
  assert.throws(() => assertSeedAllowed({ env: 'development', mongoUri: 'mongodb://mongo:27017/' }), SeedRefused);
});
