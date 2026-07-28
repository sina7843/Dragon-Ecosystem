// Runs the demo seeder against a throwaway development database and asserts its safety
// invariants: idempotency, exactly-once financial postings, no negative balances, no
// public draft leakage, reset scope, mock-only payments, and — critically — that a second
// run never mutates immutable/append-only records or writes a marker field onto them.
process.env['NODE_ENV'] = 'development';
process.env['PAYMENTS_MOCK_ENABLED'] = 'true';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../config.ts';
import { prepareDatabase } from '../server.ts';
import { createTestDatabase, type TestDatabase } from '../shared/db/test-support.ts';
import { SeedSummary } from './harness.ts';
import { DemoRegistry, resetDemo } from './registry.ts';
import { buildServices, type Services } from './wiring.ts';
import { seedUsers } from './users.ts';
import { seedCatalog } from './catalog.ts';
import { seedEconomy } from './economy.ts';
import { DEMO_IMMUTABLE_COLLECTIONS } from './collections.ts';

let fixture: TestDatabase;
let services: Services;
let registry: DemoRegistry;

const count = (c: string): Promise<number> => fixture.database.db.collection(c).countDocuments();
const markerCount = (c: string): Promise<number> =>
  fixture.database.db.collection(c).countDocuments({ demoSeedKey: { $exists: true } });

before(async () => {
  fixture = await createTestDatabase();
  await prepareDatabase(fixture.database);
  services = buildServices(fixture.database, loadConfig());
  registry = new DemoRegistry(fixture.database.db);
  await registry.ensureIndex();
});

after(async () => {
  await fixture.dispose();
});

describe('demo seeder', () => {
  test('seeds, is idempotent, and never mutates immutable records', async () => {
    const run = async (): Promise<void> => {
      const s = new SeedSummary();
      const users = await seedUsers(services, registry, s);
      const author = users.get('admin-content')?.accountId ?? users.get('admin-super')?.accountId;
      assert.ok(author !== undefined, 'an admin author exists');
      await seedCatalog(services, registry, s, author);
      // No tournaments are seeded in this fixture, so the paid-checkout step has nothing
      // to act on; an empty registry keeps the economy assertions focused on the ledger.
      await seedEconomy(services, registry, s, users, new Map());
    };

    await run();
    const accounts1 = await count('accounts');
    const ledger1 = await count('ledger_transactions');
    const purchases1 = await count('dragon_coin_purchases');
    const ledgerSnapshot = await fixture.database.db.collection('ledger_transactions').find().sort({ _id: 1 }).toArray();
    const auditSnapshot = await fixture.database.db.collection('audit_events').find().sort({ _id: 1 }).toArray();
    assert.ok(accounts1 >= 30, 'a meaningful number of accounts were created');

    // Idempotency: a second run creates no new accounts and no duplicate financial effect.
    await run();
    assert.equal(await count('accounts'), accounts1, 'idempotent: no new accounts on rerun');
    assert.equal(await count('ledger_transactions'), ledger1, 'exactly-once: no duplicate ledger postings');
    assert.equal(await count('dragon_coin_purchases'), purchases1, 'exactly-once: no duplicate purchases');

    // Immutable/append-only records are byte-for-byte unchanged after the second run.
    const ledgerAfter = await fixture.database.db.collection('ledger_transactions').find().sort({ _id: 1 }).toArray();
    const auditAfter = await fixture.database.db.collection('audit_events').find().sort({ _id: 1 }).toArray();
    assert.deepEqual(ledgerAfter, ledgerSnapshot, 'ledger transactions are not mutated by a rerun');
    assert.deepEqual(auditAfter, auditSnapshot, 'audit events are not mutated by a rerun');

    // No immutable/append-only collection ever carries a demo marker field.
    for (const c of DEMO_IMMUTABLE_COLLECTIONS) {
      assert.equal(await markerCount(c), 0, `no demoSeedKey marker on immutable collection ${c}`);
    }

    // No negative user balances.
    const negative = await fixture.database.db
      .collection('ledger_accounts')
      .countDocuments({ accountType: 'user_dragon_coin', balance: { $lt: 0 } });
    assert.equal(negative, 0, 'no negative user Dragon Coin balances');

    // No public draft leakage.
    const publicGames = await services.games.listPublished({ locale: 'en', limit: 50 });
    assert.ok(!publicGames.items.some((g) => g.slug === 'unreleased-quest'), 'draft game is not publicly listed');
    const publicContent = await services.content.listPublished({ locale: 'en', limit: 50 });
    assert.ok(!publicContent.items.some((c) => c.slug === 'draft-preview'), 'draft article is not publicly listed');

    // Reset scope: mutable demo content is removed; accounts and financial history preserved.
    assert.ok((await count('user_profiles')) > 0, 'demo profiles exist before reset');
    const report = await resetDemo(fixture.database.db, registry);
    assert.ok((report.mutableReset['user_profiles'] ?? 0) > 0, 'reset deletes demo profiles');
    assert.equal(await count('accounts'), accounts1, 'reset preserves accounts');
    assert.equal(await count('ledger_transactions'), ledger1, 'reset preserves immutable financial history');
    assert.equal(await count('dragon_coin_purchases'), purchases1, 'reset preserves purchase history');

    // Payments are mock-only — never a live provider.
    assert.equal(services.payments.provider.name, 'mock', 'only the mock payment provider is wired');
  });
});
