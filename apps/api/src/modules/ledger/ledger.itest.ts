import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext, SYSTEM_ACTOR } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { LedgerService } from './service.ts';
import { LedgerReconciliation } from './reconciliation.ts';
import { LEDGER_COLLECTIONS } from './collections.ts';
import type { AccountRef } from './accounts.ts';
import type { PostCommand } from './journal.ts';

/**
 * Ledger integration coverage (DRAGON-11a): atomic posting, rollback, idempotency,
 * duplicate/business-reference and compensation safeguards, overspending
 * concurrency, account-creation races, immutable history, reconciliation,
 * pagination, and index definitions. Requires `npm run db:test:up`.
 */

let fixture: TestDatabase;
let ledger: LedgerService;
let reconcile: LedgerReconciliation;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  ledger = new LedgerService(fixture.database);
  reconcile = new LedgerReconciliation(fixture.database);
});

after(async () => {
  await fixture.dispose();
});

function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

beforeEach(async () => {
  for (const name of [LEDGER_COLLECTIONS.accounts, LEDGER_COLLECTIONS.transactions, LEDGER_COLLECTIONS.entries, 'idempotency_keys', 'audit_events', 'domain_event_outbox']) {
    await coll(name).deleteMany({});
  }
});

const ctx = () => createRequestContext(newId(), SYSTEM_ACTOR);
const treasury: AccountRef = { kind: 'system', accountType: 'platform_dragon_coin_treasury' };
const user = (id: string): AccountRef => ({ kind: 'user', ownerId: id, accountType: 'user_dragon_coin' });

function issueTo(ownerId: string, amount: number, over: Partial<PostCommand> = {}): PostCommand {
  return {
    type: 'dragon_coin_issue',
    businessRef: `issue-${ownerId}-${String(amount)}`,
    idempotencyKey: `key-${ownerId}-${String(amount)}`,
    description: 'issue',
    entries: [
      { account: treasury, amount: -amount },
      { account: user(ownerId), amount }
    ],
    ...over
  };
}
function transfer(from: string, to: string, amount: number, over: Partial<PostCommand> = {}): PostCommand {
  return {
    type: 'dragon_coin_transfer',
    businessRef: `xfer-${from}-${to}-${String(amount)}`,
    idempotencyKey: `xk-${from}-${to}-${String(amount)}`,
    description: 'transfer',
    entries: [
      { account: user(from), amount: -amount },
      { account: user(to), amount }
    ],
    ...over
  };
}

describe('atomic posting', () => {
  test('a balanced posting writes the header, entries, balances, audit, and outbox together', async () => {
    const posted = await ledger.post(ctx(), issueTo('u1', 100));
    assert.equal(posted.entries.length, 2);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: 'issue-u1-100' }), 1);
    assert.equal(await coll(LEDGER_COLLECTIONS.entries).countDocuments({ transactionId: posted.transaction._id }), 2);

    const userBalance = await ledger.getBalanceByRef(user('u1'));
    assert.equal(userBalance?.balance, 100);
    const treasuryBalance = await ledger.getBalanceByRef(treasury);
    assert.equal(treasuryBalance?.balance, -100);

    assert.equal(await coll('audit_events').countDocuments({ resourceId: posted.transaction._id }), 1);
    assert.equal(await coll('domain_event_outbox').countDocuments({ 'event.aggregateId': posted.transaction._id }), 1);
  });
});

describe('rollback leaves no financial effect', () => {
  test('an insufficient-funds spend rolls back the header and entries it already wrote', async () => {
    // u1 has no balance; transferring 100 inserts the header and both entries, then
    // the atomic balance guard rejects the spend and the whole transaction aborts.
    await assert.rejects(() => ledger.post(ctx(), transfer('u1', 'u2', 100)), (e: { code?: string }) => e.code === 'INSUFFICIENT_FUNDS');
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: 'xfer-u1-u2-100' }), 0);
    assert.equal(await coll(LEDGER_COLLECTIONS.entries).countDocuments({ amount: 100 }), 0);
    assert.equal(await coll('audit_events').countDocuments({ action: 'ledger.transaction_posted' }), 0);
    assert.equal(await coll('domain_event_outbox').countDocuments({}), 0);
    // No account dropped below zero.
    const u1 = await ledger.getBalanceByRef(user('u1'));
    assert.equal(u1?.balance ?? 0, 0);
  });
});

describe('idempotency', () => {
  test('an identical replay returns the original transaction and posts exactly one effect', async () => {
    const first = await ledger.post(ctx(), issueTo('u1', 100));
    const replay = await ledger.post(ctx(), issueTo('u1', 100));
    assert.equal(replay.transaction._id, first.transaction._id);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: 'issue-u1-100' }), 1);
    assert.equal(await coll(LEDGER_COLLECTIONS.entries).countDocuments({ transactionId: first.transaction._id }), 2);
    assert.equal((await ledger.getBalanceByRef(user('u1')))?.balance, 100);
    assert.equal(await coll('audit_events').countDocuments({ resourceId: first.transaction._id }), 1);
  });

  test('the same key with a different payload is a conflict', async () => {
    await ledger.post(ctx(), issueTo('u1', 100));
    await assert.rejects(
      () => ledger.post(ctx(), issueTo('u1', 100, { entries: [{ account: treasury, amount: -200 }, { account: user('u1'), amount: 200 }] })),
      (e: { code?: string }) => e.code === 'IDEMPOTENCY_KEY_REUSED'
    );
  });

  test('concurrent identical postings create exactly one journal transaction', async () => {
    const results = await Promise.allSettled([ledger.post(ctx(), issueTo('u1', 100)), ledger.post(ctx(), issueTo('u1', 100))]);
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: 'issue-u1-100' }), 1);
    assert.equal(await coll(LEDGER_COLLECTIONS.entries).countDocuments({}), 2);
    assert.equal((await ledger.getBalanceByRef(user('u1')))?.balance, 100);
  });
});

describe('the compensation type is not reachable from post()', () => {
  test('post() rejects a caller-supplied compensation transaction', async () => {
    await assert.rejects(
      () => ledger.post(ctx(), issueTo('u1', 100, { type: 'compensation' })),
      (e: { fieldErrors?: Array<{ code: string }> }) => e.fieldErrors?.[0]?.code === 'UNSUPPORTED_TRANSACTION_TYPE'
    );
  });
});

describe('idempotent replay short-circuits before account checks', () => {
  test('a replay returns the original even after a referenced account is disabled', async () => {
    const first = await ledger.post(ctx(), issueTo('u1', 100));
    // Disable the treasury account out of band; a genuine replay must still succeed.
    await coll(LEDGER_COLLECTIONS.accounts).updateOne({ identityKey: 'sys:platform_dragon_coin_treasury:DRC:0' }, { $set: { status: 'disabled' } });
    const replay = await ledger.post(ctx(), issueTo('u1', 100));
    assert.equal(replay.transaction._id, first.transaction._id);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: 'issue-u1-100' }), 1);
  });
});

describe('duplicate safeguards beyond idempotency', () => {
  test('a second posting with the same business reference is rejected', async () => {
    await ledger.post(ctx(), issueTo('u1', 100));
    await assert.rejects(
      () => ledger.post(ctx(), issueTo('u1', 100, { idempotencyKey: 'a-different-key' })),
      (e: { code?: string }) => e.code === 'DUPLICATE_BUSINESS_REFERENCE'
    );
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: 'issue-u1-100' }), 1);
  });
});

describe('overspending concurrency', () => {
  test('exactly one of two concurrent final-balance spends succeeds', async () => {
    await ledger.post(ctx(), issueTo('u1', 100));
    const spendA = transfer('u1', 'u2', 100, { businessRef: 'spend-a', idempotencyKey: 'spend-a' });
    const spendB = transfer('u1', 'u3', 100, { businessRef: 'spend-b', idempotencyKey: 'spend-b' });
    const results = await Promise.allSettled([ledger.post(ctx(), spendA), ledger.post(ctx(), spendB)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    assert.equal(fulfilled, 1);
    assert.equal(rejected.length, 1);
    assert.equal((rejected[0]?.reason as { code?: string }).code, 'INSUFFICIENT_FUNDS');
    // The spender ends at exactly zero; no account went negative.
    assert.equal((await ledger.getBalanceByRef(user('u1')))?.balance, 0);
    const recon = await reconcile.reconcileAccount((await ledger.getBalanceByRef(user('u1')))?.accountId as string);
    assert.deepEqual(recon, []);
  });

  test('a direct overspend is rejected with no entries written', async () => {
    await ledger.post(ctx(), issueTo('u1', 50));
    await assert.rejects(() => ledger.post(ctx(), transfer('u1', 'u2', 51)), (e: { code?: string }) => e.code === 'INSUFFICIENT_FUNDS');
    assert.equal((await ledger.getBalanceByRef(user('u1')))?.balance, 50);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: 'xfer-u1-u2-51' }), 0);
  });
});

describe('account creation races', () => {
  test('concurrent first-touch of the same account collapses to one record', async () => {
    const results = await Promise.allSettled([
      ledger.post(ctx(), issueTo('race', 10, { businessRef: 'race-1', idempotencyKey: 'race-1' })),
      ledger.post(ctx(), issueTo('race', 20, { businessRef: 'race-2', idempotencyKey: 'race-2' }))
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
    assert.equal(await coll(LEDGER_COLLECTIONS.accounts).countDocuments({ ownerId: 'race', accountType: 'user_dragon_coin' }), 1);
    assert.equal((await ledger.getBalanceByRef(user('race')))?.balance, 30);
  });
});

describe('immutable history and compensation', () => {
  test('a compensating transaction reverses balances without mutating the original', async () => {
    const original = await ledger.post(ctx(), issueTo('u1', 100));
    const originalEntries = await coll(LEDGER_COLLECTIONS.entries).find({ transactionId: original.transaction._id }).toArray();

    const compensation = await ledger.compensate(ctx(), { transactionId: original.transaction._id, businessRef: 'comp-1', idempotencyKey: 'comp-1', reason: 'reverse the issue' });
    assert.equal(compensation.transaction.reversalOf, original.transaction._id);
    assert.equal(compensation.transaction.type, 'compensation');

    // Net balances back to zero; the original entries are byte-for-byte unchanged.
    assert.equal((await ledger.getBalanceByRef(user('u1')))?.balance, 0);
    const afterEntries = await coll(LEDGER_COLLECTIONS.entries).find({ transactionId: original.transaction._id }).toArray();
    assert.deepEqual(afterEntries, originalEntries);
    const originalHeader = await coll(LEDGER_COLLECTIONS.transactions).findOne({ _id: original.transaction._id });
    assert.equal(originalHeader?.['status'], 'posted');
  });

  test('a transaction cannot be compensated twice', async () => {
    const original = await ledger.post(ctx(), issueTo('u1', 100));
    await ledger.compensate(ctx(), { transactionId: original.transaction._id, businessRef: 'comp-1', idempotencyKey: 'comp-1', reason: 'first' });
    await assert.rejects(
      () => ledger.compensate(ctx(), { transactionId: original.transaction._id, businessRef: 'comp-2', idempotencyKey: 'comp-2', reason: 'second' }),
      (e: { code?: string }) => e.code === 'DUPLICATE_COMPENSATION'
    );
  });
});

describe('reconciliation', () => {
  test('reconcileTransaction confirms a posting balances to zero', async () => {
    const posted = await ledger.post(ctx(), issueTo('u1', 100));
    assert.deepEqual(await reconcile.reconcileTransaction(posted.transaction._id), []);
  });

  test('recompute matches the projection and detects an injected drift', async () => {
    await ledger.post(ctx(), issueTo('u1', 100));
    const account = await ledger.getBalanceByRef(user('u1'));
    const recomputed = await reconcile.recomputeAccountBalance(account?.accountId as string);
    assert.equal(recomputed.sum, 100);
    assert.deepEqual(await reconcile.reconcileAccount(account?.accountId as string), []);

    // Corrupt the projection out of band; reconciliation must flag the drift, not repair it.
    await coll(LEDGER_COLLECTIONS.accounts).updateOne({ _id: account?.accountId as string }, { $set: { balance: 999 } });
    const findings = await reconcile.reconcileAccount(account?.accountId as string);
    assert.equal(findings.find((f) => f.checkId === 'balance_projection')?.actual, 999);
    assert.equal(findings.find((f) => f.checkId === 'balance_projection')?.expected, 100);
  });

  test('a bounded report is required', async () => {
    await assert.rejects(() => reconcile.report([]), (e: { fieldErrors?: Array<{ code: string }> }) => e.fieldErrors?.[0]?.code === 'RECONCILIATION_UNBOUNDED');
  });
});

describe('pagination', () => {
  test('cursor pagination returns every entry once with no gaps', async () => {
    for (let i = 0; i < 25; i += 1) await ledger.post(ctx(), issueTo(`p${String(i)}`, 5, { businessRef: `page-${String(i)}`, idempotencyKey: `page-${String(i)}` }));
    // Every issue credits the treasury account once, so it has 25 entries.
    const treasuryAccount = await ledger.getBalanceByRef(treasury);
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await ledger.listEntries(treasuryAccount?.accountId as string, cursor === undefined ? { limit: 10 } : { cursor, limit: 10 });
      for (const entry of page.items) seen.add(entry._id);
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 10);
    assert.equal(seen.size, 25);
  });
});

describe('index definitions', () => {
  test('the declared unique and partial indexes exist', async () => {
    const accountIndexes = await coll(LEDGER_COLLECTIONS.accounts).indexes();
    assert.equal(accountIndexes.find((i) => i.name === 'account_identity_unique')?.unique, true);

    const txIndexes = await coll(LEDGER_COLLECTIONS.transactions).indexes();
    assert.equal(txIndexes.find((i) => i.name === 'transaction_business_ref_unique')?.unique, true);
    const reversal = txIndexes.find((i) => i.name === 'transaction_reversal_unique');
    assert.equal(reversal?.unique, true);
    assert.ok(reversal?.partialFilterExpression, 'the reversal index is partial');

    const entryIndexes = await coll(LEDGER_COLLECTIONS.entries).indexes();
    assert.equal(entryIndexes.find((i) => i.name === 'entry_transaction_line_unique')?.unique, true);
  });
});
