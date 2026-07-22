import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { LedgerService } from '../ledger/index.ts';
import { PaymentsService } from './service.ts';
import { MockPaymentProvider, type ProviderEventType, type RawCallback } from './provider.ts';
import { PAYMENTS_COLLECTIONS } from './collections.ts';
import { LEDGER_COLLECTIONS } from '../ledger/index.ts';
import type { PurchaseRecord } from './state.ts';

/**
 * Dragon Coin purchase integration coverage (DRAGON-11b): create, verified callback
 * with exactly-once crediting, duplicate/concurrent/conflicting callbacks, callback
 * verification and binding, expired/late policy, ownership/IDOR, finance correction
 * with compensation and insufficient-balance rejection, atomicity, and indexes.
 * Requires `npm run db:test:up`.
 */

const SECRET = 'integration-payments-callback-secret-value';

let fixture: TestDatabase;
let ledger: LedgerService;
let provider: MockPaymentProvider;
let payments: PaymentsService;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  ledger = new LedgerService(fixture.database);
  provider = new MockPaymentProvider(SECRET);
  payments = new PaymentsService(fixture.database, ledger, provider, { mockEnabled: true, purchaseTtlSeconds: 900 });
});

after(async () => {
  await fixture.dispose();
});

function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

beforeEach(async () => {
  for (const name of [PAYMENTS_COLLECTIONS.purchases, PAYMENTS_COLLECTIONS.providerEvents, LEDGER_COLLECTIONS.accounts, LEDGER_COLLECTIONS.transactions, LEDGER_COLLECTIONS.entries, 'idempotency_keys', 'audit_events', 'domain_event_outbox']) {
    await coll(name).deleteMany({});
  }
});

const ctx = (accountId: string) => createRequestContext(newId(), { kind: 'account', accountId, roles: [] });

async function createStarter(accountId: string, key = `k-${newId()}`): Promise<PurchaseRecord> {
  return payments.createPurchase(ctx(accountId), accountId, { packageCode: 'starter', idempotencyKey: key });
}

function rawCallback(purchase: PurchaseRecord, outcome: ProviderEventType, eventId: string, over: Partial<RawCallback> = {}): RawCallback {
  const fields = { provider: 'mock', providerRequestId: purchase.providerRequestId, purchaseId: purchase._id, rialAmount: purchase.rialAmount, asset: 'IRR', eventType: outcome, eventId, ...over };
  return { ...fields, signature: provider.sign({ provider: fields.provider, providerRequestId: fields.providerRequestId, purchaseId: fields.purchaseId, rialAmount: fields.rialAmount, asset: fields.asset, eventType: fields.eventType, eventId: fields.eventId }) };
}
async function deliver(purchase: PurchaseRecord, outcome: ProviderEventType, eventId: string): Promise<PurchaseRecord> {
  return payments.handleVerifiedCallback(provider.verifyCallback(rawCallback(purchase, outcome, eventId)));
}

describe('purchase creation', () => {
  test('creates a payment_pending purchase bound to the server-owned quote', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    assert.equal(purchase.state, 'payment_pending');
    assert.equal(purchase.dragonCoin, 100);
    assert.equal(purchase.rialAmount, 1_000_000);
    assert.equal(purchase.businessRef, `dragon_coin_purchase:${purchase._id}`);
    assert.equal(await coll(PAYMENTS_COLLECTIONS.purchases).countDocuments({ accountId: account }), 1);
  });

  test('creation is idempotent per (account, key)', async () => {
    const account = newId();
    const first = await createStarter(account, 'same-key');
    const replay = await createStarter(account, 'same-key');
    assert.equal(replay._id, first._id);
    assert.equal(await coll(PAYMENTS_COLLECTIONS.purchases).countDocuments({ accountId: account }), 1);
  });

  test('an unknown package is rejected', async () => {
    const account = newId();
    await assert.rejects(() => payments.createPurchase(ctx(account), account, { packageCode: 'nope', idempotencyKey: newId() }), (e: { fieldErrors?: Array<{ code: string }> }) => e.fieldErrors?.[0]?.code === 'INVALID_PACKAGE');
  });
});

describe('exactly-once crediting', () => {
  test('a verified success credits exactly one ledger transaction and updates the balance', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    const result = await deliver(purchase, 'success', 'evt-1');
    assert.equal(result.state, 'succeeded');
    assert.ok(result.ledgerTransactionId, 'a durable ledger link exists');
    assert.equal((await payments.getDragonCoinBalance(account)).balance, 100);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: purchase.businessRef }), 1);
    // Audit + outbox committed with the success.
    assert.equal(await coll('audit_events').countDocuments({ action: 'payment.purchase_succeeded' }), 1);
    assert.equal(await coll('domain_event_outbox').countDocuments({ 'event.eventName': 'payment.purchase_succeeded' }), 1);
  });

  test('a duplicate callback (same event id) adds no second credit', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    await deliver(purchase, 'success', 'evt-1');
    const replay = await deliver(purchase, 'success', 'evt-1');
    assert.equal(replay.state, 'succeeded');
    assert.equal((await payments.getDragonCoinBalance(account)).balance, 100);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: purchase.businessRef }), 1);
  });

  test('two concurrent identical callbacks create exactly one credit', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    await Promise.allSettled([deliver(purchase, 'success', 'evt-1'), deliver(purchase, 'success', 'evt-1')]);
    assert.equal((await payments.getDragonCoinBalance(account)).balance, 100);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: purchase.businessRef }), 1);
  });

  test('two concurrent callbacks with different event ids still create exactly one credit', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    const results = await Promise.allSettled([deliver(purchase, 'success', 'evt-a'), deliver(purchase, 'success', 'evt-b')]);
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal((await payments.getDragonCoinBalance(account)).balance, 100);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: purchase.businessRef }), 1);
    // The single credit is durably linked to the purchase (partial-unique ledger index).
    const fresh = await coll(PAYMENTS_COLLECTIONS.purchases).findOne({ _id: purchase._id });
    assert.equal(await coll(PAYMENTS_COLLECTIONS.purchases).countDocuments({ ledgerTransactionId: fresh?.['ledgerTransactionId'] }), 1);
  });

  test('a conflicting outcome after success is rejected and does not change state', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    await deliver(purchase, 'success', 'evt-1');
    await assert.rejects(() => deliver(purchase, 'failed', 'evt-2'), (e: { code?: string }) => e.code === 'CONFLICTING_PROVIDER_EVENT');
    assert.equal((await coll(PAYMENTS_COLLECTIONS.purchases).findOne({ _id: purchase._id }))?.['state'], 'succeeded');
  });
});

describe('callback verification and binding', () => {
  test('a wrong signature is rejected with no state change', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    const raw = { ...rawCallback(purchase, 'success', 'evt-1'), signature: 'bad'.repeat(20) };
    assert.throws(() => provider.verifyCallback(raw), (e: { code?: string }) => e.code === 'CALLBACK_VERIFICATION_FAILED');
    assert.equal((await coll(PAYMENTS_COLLECTIONS.purchases).findOne({ _id: purchase._id }))?.['state'], 'payment_pending');
  });

  test('a signed callback with the wrong amount is rejected and recorded', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    // Sign an amount that does not match the purchase (the signature is valid for that wrong amount).
    const verified = provider.verifyCallback(rawCallback(purchase, 'success', 'evt-1', { rialAmount: 5 } as Partial<RawCallback>));
    await assert.rejects(() => payments.handleVerifiedCallback(verified), (e: { code?: string }) => e.code === 'CALLBACK_AMOUNT_MISMATCH');
    assert.equal((await payments.getDragonCoinBalance(account)).balance, 0);
    assert.equal(await coll(PAYMENTS_COLLECTIONS.providerEvents).countDocuments({ purchaseId: purchase._id, verification: 'rejected' }), 1);
  });

  test('a callback for an unknown purchase is not found', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    const verified = provider.verifyCallback(rawCallback({ ...purchase, _id: 'unknown', providerRequestId: 'mock_unknown' }, 'success', 'evt-x'));
    await assert.rejects(() => payments.handleVerifiedCallback(verified), (e: { code?: string; message?: string }) => e.message === 'Unknown purchase.' || e.code === 'RESOURCE_NOT_FOUND');
  });
});

describe('failure, cancellation, and expiry', () => {
  test('a failed callback transitions without crediting', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    const result = await deliver(purchase, 'failed', 'evt-f');
    assert.equal(result.state, 'failed');
    assert.equal((await payments.getDragonCoinBalance(account)).balance, 0);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: purchase.businessRef }), 0);
  });

  test('a cancelled callback transitions without crediting', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    assert.equal((await deliver(purchase, 'cancelled', 'evt-c')).state, 'cancelled');
  });

  test('a late success after expiry does not credit (documented rule)', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    // Force the purchase past its expiry window.
    await coll(PAYMENTS_COLLECTIONS.purchases).updateOne({ _id: purchase._id }, { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    const result = await deliver(purchase, 'success', 'evt-late');
    assert.equal(result.state, 'expired');
    assert.equal((await payments.getDragonCoinBalance(account)).balance, 0);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: purchase.businessRef }), 0);
  });
});

describe('ownership and history', () => {
  test('a purchase is not readable by another account (IDOR closed)', async () => {
    const owner = newId();
    const other = newId();
    const purchase = await createStarter(owner);
    assert.equal(await payments.getPurchase(other, purchase._id), null);
    assert.ok(await payments.getPurchase(owner, purchase._id));
  });

  test('history is owner-scoped and paginates without gaps', async () => {
    const account = newId();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i += 1) ids.add((await createStarter(account, `hist-${String(i)}`))._id);
    await createStarter(newId(), 'other-account'); // a different account's purchase must not appear
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await payments.listPurchases(account, cursor === undefined ? { limit: 2 } : { cursor, limit: 2 });
      for (const p of page.items) seen.add(p._id);
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 10);
    assert.deepEqual([...seen].sort(), [...ids].sort());
  });
});

describe('finance correction via compensation', () => {
  test('correcting a succeeded purchase reverses the credit exactly once', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    await deliver(purchase, 'success', 'evt-1');
    assert.equal((await payments.getDragonCoinBalance(account)).balance, 100);

    const corrected = await payments.correctPurchase(ctx('finance-admin'), purchase._id, { expectedVersion: 2, reason: 'chargeback', correctionRef: 'correction-0001' });
    assert.equal(corrected.state, 'corrected');
    assert.equal((await payments.getDragonCoinBalance(account)).balance, 0);
    // One compensating ledger transaction, linked to the original credit.
    const original = await coll(PAYMENTS_COLLECTIONS.purchases).findOne({ _id: purchase._id });
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ reversalOf: original?.['ledgerTransactionId'] }), 1);
    assert.equal(await coll('audit_events').countDocuments({ action: 'payment.purchase_corrected' }), 1);
  });

  test('a duplicate correction is prevented', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    await deliver(purchase, 'success', 'evt-1');
    await payments.correctPurchase(ctx('finance-admin'), purchase._id, { expectedVersion: 2, reason: 'x', correctionRef: 'correction-0001' });
    await assert.rejects(
      () => payments.correctPurchase(ctx('finance-admin'), purchase._id, { expectedVersion: 3, reason: 'again', correctionRef: 'correction-0002' }),
      (e: { code?: string }) => e.code === 'INVALID_STATE_TRANSITION'
    );
  });

  test('correction is rejected when the user has already spent the coins', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    await deliver(purchase, 'success', 'evt-1');
    // The user spends 60 of the 100 credited coins (a transfer out).
    await ledger.post(ctx(account), {
      type: 'dragon_coin_transfer',
      businessRef: `spend-${account}`,
      idempotencyKey: `spend-${account}`,
      description: 'spend',
      entries: [
        { account: { kind: 'user', ownerId: account, accountType: 'user_dragon_coin' }, amount: -60 },
        { account: { kind: 'system', accountType: 'platform_dragon_coin_treasury' }, amount: 60 }
      ]
    });
    await assert.rejects(
      () => payments.correctPurchase(ctx('finance-admin'), purchase._id, { expectedVersion: 2, reason: 'chargeback', correctionRef: 'correction-0001' }),
      (e: { code?: string }) => e.code === 'INSUFFICIENT_BALANCE_FOR_CORRECTION'
    );
    // No partial effect: still succeeded, balance unchanged at 40.
    assert.equal((await coll(PAYMENTS_COLLECTIONS.purchases).findOne({ _id: purchase._id }))?.['state'], 'succeeded');
    assert.equal((await payments.getDragonCoinBalance(account)).balance, 40);
  });

  test('only a succeeded purchase can be corrected', async () => {
    const account = newId();
    const purchase = await createStarter(account);
    await deliver(purchase, 'failed', 'evt-f');
    await assert.rejects(
      () => payments.correctPurchase(ctx('finance-admin'), purchase._id, { expectedVersion: 2, reason: 'x', correctionRef: 'correction-9999' }),
      (e: { code?: string }) => e.code === 'INVALID_STATE_TRANSITION'
    );
  });
});

describe('index definitions', () => {
  test('the declared unique and partial payment indexes exist', async () => {
    const purchaseIndexes = await coll(PAYMENTS_COLLECTIONS.purchases).indexes();
    assert.equal(purchaseIndexes.find((i) => i.name === 'purchase_business_ref_unique')?.unique, true);
    const ledgerTx = purchaseIndexes.find((i) => i.name === 'purchase_ledger_tx_unique');
    assert.equal(ledgerTx?.unique, true);
    assert.ok(ledgerTx?.partialFilterExpression, 'the ledger-tx index is partial');
    const correction = purchaseIndexes.find((i) => i.name === 'purchase_correction_ref_unique');
    assert.ok(correction?.partialFilterExpression, 'the correction-ref index is partial');

    const eventIndexes = await coll(PAYMENTS_COLLECTIONS.providerEvents).indexes();
    assert.equal(eventIndexes.find((i) => i.name === 'provider_event_replay_unique')?.unique, true);
  });
});
