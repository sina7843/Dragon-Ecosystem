import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../config.ts';
import { buildAdmin, buildEconomy, buildHolds, buildIdentity, buildLedger, buildRecoveryDetector, buildServer, buildStore } from '../server.ts';
import { allMigrations } from '../migrations.ts';
import { runMigrations } from '../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../shared/db/seed.ts';
import { createTestDatabase, TEST_MONGO_URI, type TestDatabase } from '../shared/db/test-support.ts';
import { newId } from '../shared/ids.ts';
import { utcNow } from '../shared/events.ts';
import { createRequestContext } from '../shared/context.ts';
import { SESSION_COOKIE } from '../modules/identity/index.ts';
import { GLOBAL_SCOPE_ID, GLOBAL_SCOPE_TYPE, roleAssignments } from '../modules/admin/store.ts';
import type { LedgerService } from '../modules/ledger/index.ts';
import { ECONOMY_COLLECTIONS } from '../modules/economy/collections.ts';
import { DEFAULT_ECONOMY_LIMITS } from '../modules/economy/state.ts';
import { claimTransferWindow } from '../modules/economy/window.ts';
import { HOLDS_COLLECTIONS } from '../modules/holds/index.ts';
import { STORE_COLLECTIONS } from '../modules/store/collections.ts';
import type { StuckReservationDetector } from '../modules/operations/recovery.ts';

/**
 * Bounded local performance measurement (DRAGON-28).
 *
 * These are *contention* measurements, not a load test. Each scenario runs a small,
 * fixed number of concurrent operations against a disposable database on this machine
 * and reports both a latency distribution and the correctness invariant that must hold
 * while the contention is happening — a fast wrong answer is the failure mode that
 * matters here, so every scenario asserts its invariant as well as timing it.
 *
 * What these numbers are NOT: they are not production capacity, not evidence for the
 * PERF-001..003 response-time targets (which are stated "under agreed normal load", and
 * no such load profile exists yet), and not a substitute for PERF-014. `app.inject`
 * bypasses the network, TLS, nginx and the connection pool a deployed API would face,
 * so latencies here are a floor, not a forecast.
 *
 * Run: `npm run test:integration`. Output goes to the console only; nothing is written
 * to disk.
 */

let fixture: TestDatabase;
let app: FastifyInstance;
let physicalApp: FastifyInstance;
/**
 * One ledger, built once and shared by both apps.
 *
 * The two apps differ only in the physical-fulfilment gate and are wired to the same
 * database, so building a ledger per app would create two handles on one set of balances
 * and leave it ambiguous which one the money assertions read through. Sharing it makes the
 * answer unambiguous today and keeps it correct if the apps ever stop sharing a database.
 */
let ledgerDeps: ReturnType<typeof buildLedger>;
let ledger: LedgerService;
let detector: StuckReservationDetector;

/** Deliberately small. The point is contention, not throughput. */
const CONCURRENCY = 8;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
  ledgerDeps = buildLedger(fixture.database);
  ledger = ledgerDeps.service;
  app = buildApp(false);
  physicalApp = buildApp(true);
  detector = buildRecoveryDetector(fixture.database);
  await Promise.all([app.ready(), physicalApp.ready()]);
  report('environment', {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    // The host is named, never the connection string: `MONGODB_TEST_URI` may legitimately
    // carry credentials, and this line is written to a CI log.
    database: `MongoDB replica set at ${describeTestHost()} (disposable, dropped after the run)`,
    databaseName: fixture.name,
    transport: 'app.inject — in-process, no network/TLS/proxy'
  });
});

after(async () => {
  await Promise.all([app.close(), physicalApp.close()]);
  await fixture.dispose();
});

function buildApp(physicalFulfillmentEnabled: boolean): FastifyInstance {
  const config = { ...loadConfig({ NODE_ENV: 'test' }), physicalFulfillmentEnabled };
  const identity = buildIdentity(fixture.database, config);
  const holds = buildHolds(fixture.database, ledgerDeps);
  return buildServer(config, {
    database: fixture.database,
    identity,
    admin: buildAdmin(fixture.database),
    economy: buildEconomy(fixture.database, identity, ledgerDeps),
    store: buildStore(fixture.database, config, holds)
  });
}

// --- measurement helpers ---

interface Sample {
  readonly ms: number;
  readonly status: number;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] as number;
}

function stats(samples: readonly Sample[]): Record<string, unknown> {
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const round = (n: number): number => Math.round(n * 10) / 10;
  return {
    operations: samples.length,
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
    statuses: samples.reduce<Record<string, number>>((acc, s) => ({ ...acc, [String(s.status)]: (acc[String(s.status)] ?? 0) + 1 }), {})
  };
}

/**
 * One line per measurement, greppable and stable enough to diff between runs. Written
 * straight to stdout rather than through `console.log`, which the lint rule reserves for
 * warnings and errors — a measurement is neither.
 */
function report(label: string, fields: Record<string, unknown>): void {
  process.stdout.write(`[perf] ${label} :: ${JSON.stringify(fields)}\n`);
}

/** Host and port of the test server, with any userinfo dropped rather than logged. */
function describeTestHost(): string {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(TEST_MONGO_URI);
  return match?.[1] ?? 'the configured test server';
}

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = process.hrtime.bigint();
  const value = await work();
  return { value, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

// --- fixtures ---

let counter = 7_100_000;

interface Actor {
  cookie: string;
  accountId: string;
  username: string;
}

async function signUp(target: FastifyInstance, role?: string): Promise<Actor> {
  counter += 1;
  const mobile = `0913${String(counter)}`;
  const username = `perf${String(counter)}`;
  await target.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await target.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await target.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile, code } });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
  const session = await target.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie } });
  const accountId = session.json<{ account: { id: string } }>().account.id;
  const profile = await target.inject({
    method: 'PUT',
    url: '/api/v1/account/profile',
    cookies: { [SESSION_COOKIE]: cookie },
    payload: { username, displayName: `Perf ${String(counter)}`, birthDate: '2000-01-01', visibility: 'public' }
  });
  assert.equal(profile.statusCode, 200, profile.body);
  if (role !== undefined) {
    await roleAssignments(fixture.database.db).insertOne({
      _id: newId(),
      accountId,
      role,
      scopeType: GLOBAL_SCOPE_TYPE,
      scopeId: GLOBAL_SCOPE_ID,
      grantedBy: 'perf',
      grantedAt: utcNow(),
      revokedAt: null
    });
  }
  return { cookie, accountId, username };
}

const auth = (cookie: string) => ({ cookies: { [SESSION_COOKIE]: cookie } });

async function creditCoins(accountId: string, amount: number): Promise<void> {
  const context = createRequestContext(`perf-credit-${accountId}`);
  const userRef = { kind: 'user' as const, ownerId: accountId, accountType: 'user_dragon_coin' as const };
  const treasuryRef = { kind: 'system' as const, accountType: 'platform_dragon_coin_treasury' as const };
  await ledger.ensureAccounts([userRef, treasuryRef]);
  await ledger.post(context, {
    type: 'dragon_coin_issue',
    businessRef: `perf-credit:${accountId}:${String(amount)}`,
    idempotencyKey: `perf-credit:${accountId}:${String(amount)}`,
    description: 'Perf credit',
    entries: [
      { account: userRef, amount },
      { account: treasuryRef, amount: -amount }
    ]
  });
}

async function balanceOf(accountId: string): Promise<number> {
  const balance = await ledger.getBalanceByRef({ kind: 'user', ownerId: accountId, accountType: 'user_dragon_coin' });
  return balance?.availableBalance ?? 0;
}

/**
 * Counts ledger postings made for one sender *and one idempotency key*, so a double post
 * is visible. Scoped to the key rather than the sender: the sender may legitimately have
 * other transfers (a warm-up transfer, say), and counting those would report a duplicate
 * where there is none.
 */
async function postingsFor(senderId: string, idempotencyKey: string): Promise<number> {
  return fixture.database.db
    .collection('ledger_transactions')
    .countDocuments({ businessRef: `coin_transfer:${senderId}:${idempotencyKey}` });
}

// --- A. Transfer idempotency and concurrency ---

describe('A. transfer idempotency and concurrency', () => {
  async function race(label: string, options: { sameKey: boolean; warmWindow: boolean }): Promise<void> {
    const sender = await signUp(app);
    const recipient = await signUp(app);
    await creditCoins(sender.accountId, 5_000);

    if (options.warmWindow) {
      // One committed transfer first, so the concurrent burst meets an already-open window.
      const warm = await app.inject({
        method: 'POST',
        url: '/api/v1/me/coin-transfers',
        ...auth(sender.cookie),
        payload: { recipientUsername: recipient.username, amount: 1, idempotencyKey: `warm-${String(++counter)}` }
      });
      assert.equal(warm.statusCode, 201, warm.body);
    }

    const sharedKey = `same-${String(++counter)}`;
    const payloads = Array.from({ length: CONCURRENCY }, () => ({
      recipientUsername: recipient.username,
      amount: 10,
      idempotencyKey: options.sameKey ? sharedKey : `distinct-${String(++counter)}`
    }));

    const before = await balanceOf(recipient.accountId);
    const results = await Promise.all(
      payloads.map(async (payload) => {
        const { value, ms } = await timed(() => app.inject({ method: 'POST', url: '/api/v1/me/coin-transfers', ...auth(sender.cookie), payload }));
        return { ms, status: value.statusCode };
      })
    );
    const moved = (await balanceOf(recipient.accountId)) - before;
    const accepted = results.filter((r) => r.status === 201).length;

    report(`A. ${label}`, {
      ...stats(results),
      concurrency: CONCURRENCY,
      window: options.warmWindow ? 'already open' : 'cold',
      key: options.sameKey ? 'one shared key' : `${String(CONCURRENCY)} distinct keys`,
      accepted,
      refused: results.length - accepted,
      coinMoved: moved,
      duplicateFinancialPostings: options.sameKey ? (await postingsFor(sender.accountId, sharedKey)) - 1 : 0
    });

    if (options.sameKey) {
      assert.equal(moved, 10, 'one idempotency key moves value exactly once');
      assert.equal(await postingsFor(sender.accountId, sharedKey), 1, 'exactly one ledger transaction is posted for the key');
      assert.ok(
        results.every((r) => r.status === 201 || r.status === 409),
        `a losing racer is told the key is in flight, not given an error: ${JSON.stringify(results.map((r) => r.status))}`
      );
    } else {
      assert.equal(moved, accepted * 10, 'every accepted distinct key moved its own amount, and no other');
      assert.equal(accepted, CONCURRENCY, `all ${String(CONCURRENCY)} distinct keys are within the configured limits and must be accepted`);
    }
  }

  test('one key on a cold window moves value exactly once', async () => {
    await race('one key, cold window', { sameKey: true, warmWindow: false });
  });

  test('one key on an open window moves value exactly once', async () => {
    await race('one key, open window', { sameKey: true, warmWindow: true });
  });

  test('distinct keys on a cold window are all accepted', async () => {
    // The DRAGON-28 defect lived here: a cold-window race refused an ordinary transfer
    // with a limit error. If it returns, `accepted` drops below CONCURRENCY.
    await race('distinct keys, cold window', { sameKey: false, warmWindow: false });
  });

  test('distinct keys on an open window are all accepted', async () => {
    await race('distinct keys, open window', { sameKey: false, warmWindow: true });
  });
});

// --- B. Rolling-window claims at the configured limit ---

describe('B. rolling-window claims', () => {
  test('concurrent claims never admit more than the configured budget', async () => {
    const limits = DEFAULT_ECONOMY_LIMITS;
    const senderId = `perf-window-${String(++counter)}`;
    const attempts = limits.transfersPerWindow + 4;

    const results = await Promise.all(
      Array.from({ length: attempts }, async () => {
        const { value, ms } = await timed(() => claimTransferWindow(fixture.database.db, senderId, 10, limits));
        return { ms, status: value === 'claimed' ? 200 : 429, outcome: value };
      })
    );
    const admitted = results.filter((r) => r.outcome === 'claimed').length;
    const stored = await fixture.database.db
      .collection<{ count: number; amount: number }>(ECONOMY_COLLECTIONS.transferWindows)
      .findOne({ _id: `transfer_window:${senderId}` } as never);

    report('B. rolling-window claims', {
      ...stats(results),
      concurrency: attempts,
      configuredBudget: limits.transfersPerWindow,
      admitted,
      rejected: attempts - admitted,
      overshoot: Math.max(0, admitted - limits.transfersPerWindow),
      storedCount: stored?.count ?? 0,
      // A refused claim that incremented first must hand the increment back; if it did
      // not, the stored counter would exceed the number actually admitted.
      compensationsApplied: Math.max(0, (attempts - admitted) - ((stored?.count ?? 0) - admitted))
    });

    assert.ok(admitted <= limits.transfersPerWindow, `admitted ${String(admitted)} claims against a budget of ${String(limits.transfersPerWindow)}`);
    assert.equal(stored?.count ?? 0, admitted, 'the stored counter equals what was actually admitted — every refusal was compensated');
    assert.equal(stored?.amount ?? 0, admitted * 10, 'the stored amount matches the admitted claims');
  });
});

// --- C. Store last-unit contention ---

describe('C. store last-unit contention', () => {
  test('concurrent buyers for one remaining unit produce exactly one order', async () => {
    const operator = await signUp(physicalApp, 'shop_operator');
    counter += 1;
    const slug = `perf-product-${String(counter)}`;
    const created = await physicalApp.inject({
      method: 'POST',
      url: '/api/v1/admin/store/products',
      ...auth(operator.cookie),
      payload: {
        slug,
        type: 'physical',
        translations: { fa: { title: 'کالا', summary: 'خلاصه', description: 'توضیح' }, en: { title: 'Item', summary: 'Summary', description: 'Description' } }
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const productId = created.json<{ id: string }>().id;
    const variant = await physicalApp.inject({
      method: 'POST',
      url: `/api/v1/admin/store/products/${productId}/variants`,
      ...auth(operator.cookie),
      payload: { sku: `PERF-${String(counter)}`, translations: { fa: { name: 'گونه' }, en: { name: 'Standard' } }, price: { dragonCoinAmount: 50 }, stockOnHand: 1 }
    });
    assert.equal(variant.statusCode, 201, variant.body);
    const variantId = variant.json<{ id: string }>().id;
    const published = await physicalApp.inject({
      method: 'POST',
      url: `/api/v1/admin/store/products/${productId}/status`,
      ...auth(operator.cookie),
      payload: { state: 'published', reason: 'Perf measurement.' }
    });
    assert.equal(published.statusCode, 200, published.body);

    const address = { fullName: 'Perf Buyer', mobile: '09121234567', province: 'tehran', city: 'Tehran', postalCode: '1234567890', line1: 'Street 1' };
    const buyers = await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        const buyer = await signUp(physicalApp);
        await creditCoins(buyer.accountId, 500);
        const cart = await physicalApp.inject({ method: 'PATCH', url: '/api/v1/me/cart', ...auth(buyer.cookie), payload: { variantId, quantity: 1 } });
        assert.equal(cart.statusCode, 200, cart.body);
        return { buyer, cartVersion: cart.json<{ version: number }>().version };
      })
    );

    const results = await Promise.all(
      buyers.map(async ({ buyer, cartVersion }) => {
        const { value, ms } = await timed(() =>
          physicalApp.inject({
            method: 'POST',
            url: '/api/v1/orders',
            ...auth(buyer.cookie),
            payload: { cartVersion, idempotencyKey: `perf-order-${String(++counter)}`, consent: true, address }
          })
        );
        return { ms, status: value.statusCode };
      })
    );

    const won = results.filter((r) => r.status === 201).length;
    const finalStock = (await fixture.database.db.collection<{ stockOnHand: number }>(STORE_COLLECTIONS.variants).findOne({ _id: variantId } as never))?.stockOnHand ?? -1;
    // Line items live in their own collection, so a duplicate order for the contested
    // variant shows up as a second line, not a second field on one order document.
    const orderLines = await fixture.database.db.collection(STORE_COLLECTIONS.orderItems).countDocuments({ variantId } as never);

    report('C. store last-unit contention', {
      ...stats(results),
      concurrency: CONCURRENCY,
      startingStock: 1,
      successfulClaims: won,
      rejectedBuyers: results.length - won,
      finalStock,
      orderLinesForVariant: orderLines
    });

    assert.equal(won, 1, `exactly one buyer wins the last unit; got ${String(won)}`);
    assert.equal(finalStock, 0, 'stock never goes negative and never stays claimed twice');
    assert.equal(orderLines, 1, 'the contested unit produced exactly one order line, not a duplicate reservation');
  });
});

// --- D. Indexed stale-reservation scan ---

describe('D. stale-reservation scan', () => {
  const OLD = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
  const RECENT = new Date(Date.now() - 30 * 1000).toISOString();
  const STALE_SECONDS = 900;
  const STALE = 60;
  const RECENT_ACTIVE = 120;
  const TERMINAL = 120;

  test('the detector stays bounded and index-backed as the collection grows', async () => {
    const orders = fixture.database.db.collection(STORE_COLLECTIONS.orders);
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < STALE; i += 1) {
      rows.push({ _id: newId(), accountId: newId(), state: 'pending_payment', holdId: null, reference: `PS-${String(i)}`, createdAt: OLD, items: [] });
    }
    for (let i = 0; i < RECENT_ACTIVE; i += 1) {
      rows.push({ _id: newId(), accountId: newId(), state: 'pending_payment', holdId: null, reference: `PR-${String(i)}`, createdAt: RECENT, items: [] });
    }
    for (let i = 0; i < TERMINAL; i += 1) {
      // Terminal rows carry a reservation and an empty settlement total: enough to be a
      // well-formed finished order, without fabricating financial figures that never
      // corresponded to a real purchase.
      rows.push({ _id: newId(), accountId: newId(), state: 'paid', holdId: newId(), reference: `PP-${String(i)}`, createdAt: OLD, grandTotal: [], items: [] });
    }
    await orders.insertMany(rows as never);
    const total = await orders.countDocuments({});

    const { value: result, ms } = await timed(() => detector.inspect({ staleAfterSeconds: STALE_SECONDS, limit: 50 }));

    // Read-only explain on the disposable database, using the same threshold the detector
    // uses, to show the scan is index-backed rather than a collection sweep that happens
    // to be fast while the data is small.
    const olderThan = new Date(Date.now() - STALE_SECONDS * 1000).toISOString();
    const plan = await orders
      .find({ state: { $in: ['pending_payment'] }, createdAt: { $lt: olderThan } })
      .sort({ createdAt: 1 })
      .limit(50)
      .explain('executionStats');
    const stage = JSON.stringify((plan as { queryPlanner?: { winningPlan?: unknown } }).queryPlanner?.winningPlan ?? {});
    const exec = (plan as { executionStats?: { totalDocsExamined?: number; totalKeysExamined?: number; nReturned?: number } }).executionStats ?? {};

    report('D. stale-reservation scan', {
      datasetRows: total,
      stalePending: STALE,
      recentPending: RECENT_ACTIVE,
      terminal: TERMINAL,
      durationMs: Math.round(ms * 10) / 10,
      findingsReturned: result.findings.length,
      configuredLimit: 50,
      workflowsInspected: result.inspectedWorkflows.length,
      indexUsed: /IXSCAN/.test(stage) ? 'IXSCAN (order_state_created)' : 'COLLSCAN',
      docsExamined: exec.totalDocsExamined ?? null,
      keysExamined: exec.totalKeysExamined ?? null,
      returned: exec.nReturned ?? null
    });

    assert.ok(result.findings.length <= 50, 'the scan honours its configured result bound');
    assert.ok(result.findings.length > 0, 'the stale rows are actually detected');
    assert.match(stage, /IXSCAN/, 'the stale-reservation query is served by an index, not a collection scan');
  });
});

// --- E. One additional bounded query: store reconciliation ---

describe('E. bounded admin query', () => {
  test('store reconciliation stays bounded over the seeded dataset', async () => {
    const operator = await signUp(physicalApp, 'shop_operator');
    const samples: Sample[] = [];
    for (let i = 0; i < 10; i += 1) {
      const { value, ms } = await timed(() => physicalApp.inject({ method: 'GET', url: '/api/v1/admin/store/reconciliation', ...auth(operator.cookie) }));
      samples.push({ ms, status: value.statusCode });
    }
    const rows = await fixture.database.db.collection(STORE_COLLECTIONS.orders).countDocuments({});
    const paidRows = await fixture.database.db.collection(STORE_COLLECTIONS.orders).countDocuments({ state: 'paid' });
    const holdRows = await fixture.database.db.collection(HOLDS_COLLECTIONS.holds).countDocuments({});

    // The paid rows this file seeded carry no line items, so reconciliation finds no
    // differences over them. This measures the bounded query path, not the cost of
    // resolving a real difference.
    report('E. store reconciliation', { ...stats(samples), sequentialRuns: 10, orderRows: rows, paidRows, holdRows });
    assert.ok(samples.every((s) => s.status === 200), 'reconciliation answers for an authorized operator');
  });
});
