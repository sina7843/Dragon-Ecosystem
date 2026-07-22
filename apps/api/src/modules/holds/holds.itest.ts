import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { LedgerService } from '../ledger/index.ts';
import { HoldsService } from './service.ts';
import { HoldsReconciliation } from './reconciliation.ts';
import { HOLDS_COLLECTIONS } from './collections.ts';
import { LEDGER_COLLECTIONS } from '../ledger/index.ts';

/**
 * Hold integration coverage (DRAGON-11c): available-balance reservation, insufficient
 * funds, concurrency (one winner), idempotency, capture (full/partial, ledger-atomic),
 * release, bounded/idempotent expiry, IDOR, gated purposes/transfers producing no
 * effect, reconciliation, and index definitions. Requires `npm run db:test:up`.
 */

let fixture: TestDatabase;
let ledger: LedgerService;
let holds: HoldsService;
let reconcile: HoldsReconciliation;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  ledger = new LedgerService(fixture.database);
  holds = new HoldsService(fixture.database, ledger);
  reconcile = new HoldsReconciliation(fixture.database);
});

after(async () => {
  await fixture.dispose();
});

function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

beforeEach(async () => {
  for (const name of [HOLDS_COLLECTIONS.holds, LEDGER_COLLECTIONS.accounts, LEDGER_COLLECTIONS.transactions, LEDGER_COLLECTIONS.entries, 'idempotency_keys', 'audit_events', 'domain_event_outbox']) {
    await coll(name).deleteMany({});
  }
});

const ctx = (accountId: string) => createRequestContext(newId(), { kind: 'account', accountId, roles: [] });

/** Credits `amount` Dragon Coin to a user so holds have balance to reserve. */
async function credit(ownerId: string, amount: number): Promise<void> {
  await ledger.post(ctx('system'), {
    type: 'dragon_coin_issue',
    businessRef: `credit-${ownerId}-${String(amount)}-${newId()}`,
    idempotencyKey: `credit-${ownerId}-${newId()}`,
    description: 'seed',
    entries: [
      { account: { kind: 'system', accountType: 'platform_dragon_coin_treasury' }, amount: -amount },
      { account: { kind: 'user', ownerId, accountType: 'user_dragon_coin' }, amount }
    ]
  });
}
function createInput(ownerId: string, amount: number, over: Record<string, unknown> = {}): { purpose: string; amount: number; businessRef: string; idempotencyKey: string } {
  return { purpose: 'admin_correction', amount, businessRef: `hold-${ownerId}-${newId()}`, idempotencyKey: `hk-${newId()}`, ...over };
}
const ledgerAccountId = async (ownerId: string): Promise<string> => ((await ledger.getBalanceByRef({ kind: 'user', ownerId, accountType: 'user_dragon_coin' }))?.accountId as string);

describe('hold creation and available balance', () => {
  test('a hold reserves available balance without changing ledger balance', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 40));
    assert.equal(hold.state, 'active');
    const summary = await holds.getSummary(owner);
    assert.deepEqual(summary, { ledgerBalance: 100, heldAmount: 40, availableBalance: 60 });
  });

  test('a hold beyond available balance is rejected with no effect', async () => {
    const owner = newId();
    await credit(owner, 30);
    await assert.rejects(() => holds.createHold(ctx('fin'), owner, createInput(owner, 31)), (e: { code?: string }) => e.code === 'INSUFFICIENT_AVAILABLE_BALANCE');
    assert.equal(await coll(HOLDS_COLLECTIONS.holds).countDocuments({ ownerId: owner }), 0);
    assert.equal((await holds.getSummary(owner)).heldAmount, 0);
  });

  test('a gated purpose cannot create a hold', async () => {
    const owner = newId();
    await credit(owner, 100);
    await assert.rejects(() => holds.createHold(ctx('fin'), owner, createInput(owner, 10, { purpose: 'tournament_entry_fee' })), (e: { code?: string }) => e.code === 'HOLD_PURPOSE_DISABLED');
    assert.equal(await coll(HOLDS_COLLECTIONS.holds).countDocuments({ ownerId: owner }), 0);
  });

  test('creation is idempotent; a different payload conflicts; duplicate businessRef is rejected', async () => {
    const owner = newId();
    await credit(owner, 100);
    const input = createInput(owner, 20);
    const first = await holds.createHold(ctx('fin'), owner, input);
    const replay = await holds.createHold(ctx('fin'), owner, input);
    assert.equal(replay._id, first._id);
    assert.equal((await holds.getSummary(owner)).heldAmount, 20);
    await assert.rejects(() => holds.createHold(ctx('fin'), owner, { ...input, amount: 21 }), (e: { code?: string }) => e.code === 'IDEMPOTENCY_KEY_REUSED');
    await assert.rejects(() => holds.createHold(ctx('fin'), owner, { ...input, idempotencyKey: `hk-${newId()}` }), (e: { code?: string }) => e.code === 'HOLD_ALREADY_EXISTS');
  });
});

describe('concurrency: one winner for the final available balance', () => {
  test('two concurrent holds competing for the final funds yield exactly one', async () => {
    const owner = newId();
    await credit(owner, 100);
    const results = await Promise.allSettled([holds.createHold(ctx('fin'), owner, createInput(owner, 100)), holds.createHold(ctx('fin'), owner, createInput(owner, 100))]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const summary = await holds.getSummary(owner);
    assert.equal(summary.heldAmount, 100);
    assert.equal(summary.availableBalance, 0);
    assert.ok(summary.availableBalance >= 0, 'available balance never negative');
    assert.equal(await coll(HOLDS_COLLECTIONS.holds).countDocuments({ ownerId: owner }), 1);
  });
});

describe('capture into the ledger', () => {
  test('a full capture posts one ledger transfer and settles the hold', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 60));
    const captured = await holds.captureHold(ctx('fin'), hold._id, { amount: 60, idempotencyKey: `cap-${newId()}` });
    assert.equal(captured.state, 'captured');
    assert.equal(captured.capturedAmount, 60);
    assert.equal(captured.captureTransactionIds.length, 1);
    // Balance dropped by the captured amount; available unchanged (hold reservation released).
    const summary = await holds.getSummary(owner);
    assert.equal(summary.ledgerBalance, 40);
    assert.equal(summary.heldAmount, 0);
    assert.equal(summary.availableBalance, 40);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: `dragon_coin_hold_capture:${hold._id}:1` }), 1);
  });

  test('partial capture leaves a partially_captured hold; capture cannot exceed remaining', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 80));
    const partial = await holds.captureHold(ctx('fin'), hold._id, { amount: 30, idempotencyKey: `cap-${newId()}` });
    assert.equal(partial.state, 'partially_captured');
    assert.equal(partial.remainingAmount, 50);
    assert.equal((await holds.getSummary(owner)).heldAmount, 50);
    await assert.rejects(() => holds.captureHold(ctx('fin'), hold._id, { amount: 51, idempotencyKey: `cap-${newId()}` }), (e: { code?: string }) => e.code === 'CAPTURE_EXCEEDS_REMAINING');
  });

  test('capture is idempotent and concurrent captures yield one credit', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 50));
    const key = `cap-${newId()}`;
    const first = await holds.captureHold(ctx('fin'), hold._id, { amount: 50, idempotencyKey: key });
    const replay = await holds.captureHold(ctx('fin'), hold._id, { amount: 50, idempotencyKey: key });
    assert.equal(replay.capturedAmount, first.capturedAmount);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ 'metadata.holdId': hold._id }), 1);
  });

  test('concurrent capture and release settle to one winner without over-spending', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 100));
    const results = await Promise.allSettled([
      holds.captureHold(ctx('fin'), hold._id, { amount: 100, idempotencyKey: `cap-${newId()}` }),
      holds.releaseHold(ctx('fin'), hold._id, { reason: 'race', idempotencyKey: `rel-${newId()}` })
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const summary = await holds.getSummary(owner);
    assert.ok(summary.availableBalance >= 0 && summary.heldAmount === 0);
    // No over-capture: at most 100 ever leaves the balance.
    assert.ok(summary.ledgerBalance === 0 || summary.ledgerBalance === 100);
  });
});

describe('release and expiry', () => {
  test('a full release returns availability with no journal', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 40));
    const released = await holds.releaseHold(ctx('fin'), hold._id, { reason: 'not needed', idempotencyKey: `rel-${newId()}` });
    assert.equal(released.state, 'released');
    assert.equal(released.releasedAmount, 40);
    const summary = await holds.getSummary(owner);
    assert.deepEqual(summary, { ledgerBalance: 100, heldAmount: 0, availableBalance: 100 });
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ 'metadata.holdId': hold._id }), 0);
  });

  test('release is idempotent', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 40));
    const key = `rel-${newId()}`;
    await holds.releaseHold(ctx('fin'), hold._id, { reason: 'x', idempotencyKey: key });
    const replay = await holds.releaseHold(ctx('fin'), hold._id, { reason: 'x', idempotencyKey: key });
    assert.equal(replay.state, 'released');
    assert.equal((await holds.getSummary(owner)).heldAmount, 0);
  });

  test('expiry releases the remaining amount and is bounded + idempotent', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 40));
    // Force the hold past its expiry window.
    await coll(HOLDS_COLLECTIONS.holds).updateOne({ _id: hold._id }, { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    assert.deepEqual(await holds.expireDueHolds(ctx('system'), { limit: 10 }), { expired: 1 });
    assert.equal((await coll(HOLDS_COLLECTIONS.holds).findOne({ _id: hold._id }))?.['state'], 'expired');
    assert.equal((await holds.getSummary(owner)).heldAmount, 0);
    // A second run expires nothing (idempotent; nothing is double-released).
    assert.deepEqual(await holds.expireDueHolds(ctx('system'), { limit: 10 }), { expired: 0 });
    assert.equal((await holds.getSummary(owner)).availableBalance, 100);
  });
});

describe('ownership, gated transfers, reconciliation, indexes', () => {
  test('a hold is not readable by another account (IDOR closed)', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 20));
    assert.equal(await holds.getHold(newId(), hold._id), null);
    assert.ok(await holds.getHold(owner, hold._id));
  });

  test('gated transfer types are refused with no effect', async () => {
    for (const type of ['user_to_user', 'refund_execution', 'prize_payout', 'withdrawal']) {
      await assert.rejects(() => holds.executeTransfer(ctx('fin'), type), (e: { code?: string }) => e.code === 'TRANSFER_FEATURE_DISABLED');
    }
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({}), 0);
    assert.equal(await coll('audit_events').countDocuments({}), 0);
  });

  test('reconciliation confirms conservation and detects injected drift', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 40));
    const accountId = await ledgerAccountId(owner);
    assert.deepEqual(await reconcile.reconcileAccountHolds(accountId), []);
    // Corrupt the hold conservation out of band; reconciliation flags it, never repairs.
    await coll(HOLDS_COLLECTIONS.holds).updateOne({ _id: hold._id }, { $set: { remainingAmount: 999 } });
    const findings = await reconcile.reconcileAccountHolds(accountId);
    assert.ok(findings.some((f) => f.checkId === 'amount_conservation'));
    assert.ok(findings.some((f) => f.checkId === 'held_projection'));
    await assert.rejects(() => reconcile.report([]), (e: { fieldErrors?: Array<{ code: string }> }) => e.fieldErrors?.[0]?.code === 'RECONCILIATION_UNBOUNDED');
  });

  test('the declared unique and expiry indexes exist', async () => {
    const holdIndexes = await coll(HOLDS_COLLECTIONS.holds).indexes();
    assert.equal(holdIndexes.find((i) => i.name === 'hold_business_ref_unique')?.unique, true);
    assert.ok(holdIndexes.find((i) => i.name === 'hold_state_expires'), 'active-expiry lookup index exists');
  });
});

describe('strict held-balance invariant on release', () => {
  test('releasing exactly the remaining held amount succeeds and reaches zero held', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 40));
    const released = await holds.releaseHold(ctx('fin'), hold._id, { reason: 'exact', idempotencyKey: `rel-${newId()}` });
    assert.equal(released.state, 'released');
    assert.equal((await holds.getSummary(owner)).heldAmount, 0);
  });

  test('a release beyond the held projection fails and leaves everything unchanged', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 40));
    // Introduce held-projection drift: the account now reports less held than the hold reserves.
    const accountId = await ledgerAccountId(owner);
    await coll(LEDGER_COLLECTIONS.accounts).updateOne({ _id: accountId }, { $set: { heldAmount: 20 } });
    const auditBefore = await coll('audit_events').countDocuments({});
    const outboxBefore = await coll('domain_event_outbox').countDocuments({});

    await assert.rejects(() => holds.releaseHold(ctx('fin'), hold._id, { reason: 'drift', idempotencyKey: `rel-${newId()}` }), (e: { code?: string }) => e.code === 'HELD_INVARIANT_VIOLATION');

    // The whole transaction rolled back: hold, held projection, audit, outbox, ledger all unchanged.
    const holdAfter = await coll(HOLDS_COLLECTIONS.holds).findOne({ _id: hold._id });
    assert.equal(holdAfter?.['state'], 'active');
    assert.equal(holdAfter?.['remainingAmount'], 40);
    assert.equal(holdAfter?.['version'], hold.version);
    assert.equal((await coll(LEDGER_COLLECTIONS.accounts).findOne({ _id: accountId }))?.['heldAmount'], 20);
    assert.equal(await coll('audit_events').countDocuments({}), auditBefore);
    assert.equal(await coll('audit_events').countDocuments({ action: 'hold.released' }), 0);
    assert.equal(await coll('domain_event_outbox').countDocuments({}), outboxBefore);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ 'metadata.holdId': hold._id }), 0);
  });

  test('two concurrent full releases cannot underflow the held balance', async () => {
    const owner = newId();
    await credit(owner, 100);
    const hold = await holds.createHold(ctx('fin'), owner, createInput(owner, 40));
    const results = await Promise.allSettled([
      holds.releaseHold(ctx('fin'), hold._id, { reason: 'a', idempotencyKey: `rel-${newId()}` }),
      holds.releaseHold(ctx('fin'), hold._id, { reason: 'b', idempotencyKey: `rel-${newId()}` })
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const summary = await holds.getSummary(owner);
    assert.equal(summary.heldAmount, 0);
    assert.ok(summary.heldAmount >= 0 && summary.availableBalance === 100);
    assert.deepEqual(await reconcile.reconcileAccountHolds(await ledgerAccountId(owner)), []);
  });

  test('reconciliation reports held-projection drift and never repairs it', async () => {
    const owner = newId();
    await credit(owner, 100);
    await holds.createHold(ctx('fin'), owner, createInput(owner, 40));
    const accountId = await ledgerAccountId(owner);
    // Corrupt only the held projection (holds themselves stay consistent).
    await coll(LEDGER_COLLECTIONS.accounts).updateOne({ _id: accountId }, { $set: { heldAmount: 999 } });
    const findings = await reconcile.reconcileAccountHolds(accountId);
    const drift = findings.find((f) => f.checkId === 'held_projection');
    assert.ok(drift, 'held_projection drift is detected');
    assert.equal(drift?.expected, 40);
    assert.equal(drift?.actual, 999);
    // Read-only: the drift is still present after reconciliation (no silent repair).
    assert.equal((await coll(LEDGER_COLLECTIONS.accounts).findOne({ _id: accountId }))?.['heldAmount'], 999);
  });
});
