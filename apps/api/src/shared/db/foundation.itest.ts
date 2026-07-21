import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { COLLECTIONS, INDEX_DECLARATIONS } from './collections.ts';
import { appliedVersions, runMigrations, type Migration } from './migrations.ts';
import { migrations } from './migrations/001-foundation.ts';
import { seedSystemConfiguration, ROLE_SEED } from './seed.ts';
import { readPendingEvents } from './outbox.ts';
import { withIdempotency } from './idempotency.ts';
import { runUnitOfWork } from './unit-of-work.ts';
import { createTestDatabase, type TestDatabase } from './test-support.ts';
import { createRequestContext, SYSTEM_ACTOR } from '../context.ts';
import { newId } from '../ids.ts';
import type { Database } from './client.ts';

/**
 * Integration coverage for the data foundation.
 * Requires the disposable test database: `npm run db:test:up`.
 */

let fixture: TestDatabase;
let database: Database;

before(async () => {
  fixture = await createTestDatabase();
  database = fixture.database;
});

after(async () => {
  await fixture.dispose();
});

const context = createRequestContext('itest-correlation', SYSTEM_ACTOR);

describe('migrations', () => {
  test('apply once and record their version', async () => {
    const applied = await runMigrations(database.db, migrations);
    assert.deepEqual(applied, ['001-foundation']);
    assert.deepEqual(await appliedVersions(database.db), ['001-foundation']);
  });

  test('re-running is a no-op (idempotent)', async () => {
    const applied = await runMigrations(database.db, migrations);
    assert.deepEqual(applied, [], 'an already-applied migration must not run again');
    assert.deepEqual(await appliedVersions(database.db), ['001-foundation']);
  });

  test('duplicate versions are rejected before anything runs', async () => {
    const duplicate: Migration = { version: '001-foundation', description: 'clash', up: async () => {} };
    await assert.rejects(
      () => runMigrations(database.db, [...migrations, duplicate]),
      /Duplicate migration version/
    );
  });

  test('a concurrent runner does not apply the same migration twice', async () => {
    const fresh = await createTestDatabase();
    try {
      let runCount = 0;
      const counted: Migration[] = [
        {
          version: '900-counted',
          description: 'counts executions',
          up: async () => {
            runCount += 1;
          }
        }
      ];

      const results = await Promise.allSettled([
        runMigrations(fresh.database.db, counted),
        runMigrations(fresh.database.db, counted)
      ]);

      assert.equal(runCount, 1, 'migration body executed more than once');
      const applied = results
        .filter((r): r is PromiseFulfilledResult<string[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value);
      assert.deepEqual(applied, ['900-counted'], 'exactly one runner may claim the version');
    } finally {
      await fresh.dispose();
    }
  });
});

describe('indexes', () => {
  test('every declared index exists after migration', async () => {
    for (const declaration of INDEX_DECLARATIONS) {
      const indexes = await database.db.collection(declaration.collection).indexes();
      const found = indexes.find((index) => index.name === declaration.name);
      assert.ok(found, `missing index ${declaration.name} on ${declaration.collection}`);
    }
  });

  test('unique and TTL options are actually applied', async () => {
    const idempotencyIndexes = await database.db.collection(COLLECTIONS.idempotencyKeys).indexes();
    const unique = idempotencyIndexes.find((i) => i.name === 'idempotency_scope_key_unique');
    const ttl = idempotencyIndexes.find((i) => i.name === 'idempotency_expiresAt_ttl');
    assert.equal(unique?.unique, true);
    assert.equal(ttl?.expireAfterSeconds, 0);
  });
});

describe('seed', () => {
  test('creates the role catalogue and is idempotent', async () => {
    const first = await seedSystemConfiguration(database.db);
    const second = await seedSystemConfiguration(database.db);
    assert.equal(first, ROLE_SEED.length);
    assert.equal(second, ROLE_SEED.length, 're-seeding must not duplicate roles');
  });

  test('does not overwrite permissions already assigned', async () => {
    await database.db
      .collection(COLLECTIONS.roleDefinitions)
      .updateOne({ _id: 'referee' as never }, { $set: { permissions: ['match.result.enter'] } });

    await seedSystemConfiguration(database.db);

    const role = await database.db
      .collection<{ permissions: string[] }>(COLLECTIONS.roleDefinitions)
      .findOne({ _id: 'referee' as never });
    assert.deepEqual(role?.permissions, ['match.result.enter']);
  });
});

describe('transactions and the unit of work', () => {
  test('audit rows and outbox events commit atomically with the write', async () => {
    const accountId = newId();

    await runUnitOfWork(database, context, async (uow) => {
      await uow.db
        .collection('accounts_probe')
        .insertOne({ _id: accountId as never, state: 'active' }, { session: uow.session });
      uow.audit({ action: 'account.created', resourceType: 'account', resourceId: accountId });
      uow.publish({ eventName: 'account.created', eventVersion: 1, aggregateId: accountId, payload: {} });
    });

    const audit = await database.db
      .collection(COLLECTIONS.auditEvents)
      .findOne({ resourceId: accountId });
    assert.ok(audit, 'audit row was not written');
    assert.equal(audit?.['correlationId'], 'itest-correlation');

    const pending = await readPendingEvents(database.db);
    const event = pending.find((record) => record.event.aggregateId === accountId);
    assert.ok(event, 'outbox event was not written');
    assert.equal(event?.state, 'pending');
    assert.equal(event?.event.correlationId, 'itest-correlation');
  });

  test('a failed unit of work leaves no state, no audit row, and no event', async () => {
    const accountId = newId();

    await assert.rejects(
      runUnitOfWork(database, context, async (uow) => {
        await uow.db
          .collection('accounts_probe')
          .insertOne({ _id: accountId as never, state: 'active' }, { session: uow.session });
        uow.audit({ action: 'account.created', resourceType: 'account', resourceId: accountId });
        uow.publish({ eventName: 'account.created', eventVersion: 1, aggregateId: accountId, payload: {} });
        throw new Error('domain rule violated');
      }),
      /domain rule violated/
    );

    assert.equal(await database.db.collection('accounts_probe').countDocuments({ _id: accountId as never }), 0);
    assert.equal(await database.db.collection(COLLECTIONS.auditEvents).countDocuments({ resourceId: accountId }), 0);
    assert.equal(
      await database.db.collection(COLLECTIONS.domainEventOutbox).countDocuments({ 'event.aggregateId': accountId }),
      0
    );
  });
});

describe('idempotency', () => {
  test('runs the work once and replays the stored result', async () => {
    let executions = 0;
    const request = { amount: 1000 };
    const options = { scope: 'payment.create', key: newId(), request };

    const first = await withIdempotency(database.db, options, async () => {
      executions += 1;
      return { paymentId: 'p-1' };
    });
    const second = await withIdempotency(database.db, options, async () => {
      executions += 1;
      return { paymentId: 'p-2' };
    });

    assert.equal(executions, 1, 'the work must run exactly once per key');
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.deepEqual(second.result, { paymentId: 'p-1' }, 'replay must return the original result');
  });

  test('reusing a key with a different request is rejected', async () => {
    const key = newId();
    await withIdempotency(database.db, { scope: 'payment.create', key, request: { amount: 1000 } }, async () => 'ok');

    await assert.rejects(
      withIdempotency(database.db, { scope: 'payment.create', key, request: { amount: 9999 } }, async () => 'ok'),
      /IDEMPOTENCY_KEY_REUSED|already used with a different request/
    );
  });

  test('the same key in a different scope is independent', async () => {
    const key = newId();
    const a = await withIdempotency(database.db, { scope: 'scope.a', key, request: {} }, async () => 'a');
    const b = await withIdempotency(database.db, { scope: 'scope.b', key, request: {} }, async () => 'b');
    assert.equal(a.result, 'a');
    assert.equal(b.result, 'b');
    assert.equal(b.replayed, false);
  });

  test('a failed attempt releases the key so a retry can succeed', async () => {
    const options = { scope: 'payment.create', key: newId(), request: { amount: 1 } };

    await assert.rejects(
      withIdempotency(database.db, options, async () => {
        throw new Error('provider timeout');
      }),
      /provider timeout/
    );

    const retry = await withIdempotency(database.db, options, async () => 'recovered');
    assert.equal(retry.result, 'recovered');
    assert.equal(retry.replayed, false);
  });

  test('concurrent requests with one key produce exactly one effect', async () => {
    let executions = 0;
    const options = { scope: 'coin.transfer', key: newId(), request: { amount: 5 } };

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        withIdempotency(database.db, options, async () => {
          executions += 1;
          return 'done';
        })
      )
    );

    assert.equal(executions, 1, 'concurrent duplicates must not double-execute');
    const succeeded = attempts.filter((a) => a.status === 'fulfilled');
    assert.ok(succeeded.length >= 1);
    // Losers are rejected as in-progress conflicts rather than silently duplicating work.
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') {
        assert.match(String(attempt.reason), /in progress|still being processed/i);
      }
    }
  });
});
