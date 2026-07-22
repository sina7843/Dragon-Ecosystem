import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { loadConfig } from '../../config.ts';
import { buildGames, buildIdentity, buildLedger, buildHolds, buildRegistrations, buildTeams, buildTournaments } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { CheckoutService } from './service.ts';
import { MockPaymentProvider, type RawCallback } from '../payments/index.ts';
import { LedgerReconciliation, LEDGER_COLLECTIONS } from '../ledger/index.ts';
import type { LedgerService } from '../ledger/index.ts';
import type { RegistrationsService } from '../registrations/index.ts';
import type { CheckoutRecord } from './state.ts';

/**
 * Paid checkout integration coverage (DRAGON-12): the OD-007 gate, server fee
 * recalculation, Toman/Dragon Coin/mixed fees, atomic registration activation,
 * idempotency, duplicate + failed callbacks, cancellation, expiry, reconciliation,
 * and cross-user IDOR. Requires `npm run db:test:up`.
 */

const SECRET = 'checkout-integration-callback-secret-value';

let fixture: TestDatabase;
let ledger: LedgerService;
let registrationsService: RegistrationsService;
let checkout: CheckoutService;
let checkoutDisabled: CheckoutService;
let provider: MockPaymentProvider;
let reconcile: LedgerReconciliation;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
  const config = loadConfig({ NODE_ENV: 'test', PAID_TOURNAMENTS_ENABLED: 'true', PAYMENTS_CALLBACK_SECRET: SECRET });
  const identity = buildIdentity(fixture.database, config);
  const games = buildGames(fixture.database);
  const teams = buildTeams(fixture.database, games, identity);
  const tournaments = buildTournaments(fixture.database, games);
  const registrations = buildRegistrations(fixture.database, tournaments, identity, teams);
  registrationsService = registrations.service;
  const ledgerBuilt = buildLedger(fixture.database);
  const holds = buildHolds(fixture.database, ledgerBuilt);
  ledger = ledgerBuilt.service;
  provider = new MockPaymentProvider(SECRET);
  const cfg = { ttlSeconds: 900 };
  checkout = new CheckoutService(fixture.database, { paidTournamentsEnabled: true, ...cfg }, tournaments.service, registrations.service, ledger, holds.service, provider);
  checkoutDisabled = new CheckoutService(fixture.database, { paidTournamentsEnabled: false, ...cfg }, tournaments.service, registrations.service, ledger, holds.service, provider);
  reconcile = new LedgerReconciliation(fixture.database);
});

after(async () => {
  await fixture.dispose();
});

function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

beforeEach(async () => {
  for (const name of ['registration_checkouts', 'registrations', 'tournament_seat_counters', 'tournaments', 'games', 'dragon_coin_holds', LEDGER_COLLECTIONS.accounts, LEDGER_COLLECTIONS.transactions, LEDGER_COLLECTIONS.entries, 'idempotency_keys', 'audit_events', 'domain_event_outbox']) {
    await coll(name).deleteMany({});
  }
});

const ctx = (accountId: string) => createRequestContext(newId(), { kind: 'account', accountId, roles: [] });

let counter = 9_100_000;
async function paidTournament(components: Array<{ assetCode: 'IRR' | 'DRC'; amountInteger: number }>, over: Record<string, unknown> = {}): Promise<string> {
  counter += 1;
  const gameId = newId();
  const now = utcNow();
  await coll('games').insertOne({ _id: gameId, slug: `co-g-${String(counter)}`, status: 'published', translations: { fa: { name: 'ب', description: '', seoTitle: '', seoDescription: '' }, en: { name: 'G', description: '', seoTitle: '', seoDescription: '' } }, coverImageUrl: null, version: 1, createdAt: now, updatedAt: now, publishedAt: now });
  const id = newId();
  const kind = components.length > 1 ? 'mixed' : components[0]?.assetCode === 'DRC' ? 'dragon_coin' : 'toman';
  await coll('tournaments').insertOne({
    _id: id, slug: `co-t-${String(counter)}`, state: 'published',
    translations: { fa: { name: 'ت', summary: 'خ', description: '', seoTitle: '', seoDescription: '' }, en: { name: 'T', summary: 'S', description: '', seoTitle: '', seoDescription: '' } },
    gameId, participantType: 'individual', capacity: 64,
    registration: { opensAt: null, closesAt: null }, schedule: { startAt: null, endAt: null },
    format: 'single_elimination', ruleProfile: { kind: 'custom', text: { fa: 'ق', en: 'R' } },
    approvalMode: 'automatic', waitlistMode: 'disabled',
    eligibility: { minAge: null, requireCompleteProfile: false, requireGameIdentity: false },
    questionSet: { version: 0, questions: [] }, fee: { kind, components: components.map((c) => ({ ...c, scale: 0 })) },
    refundPolicy: { kind: 'no_refund', text: { fa: '', en: '' } }, prizes: { version: 0, placements: [] },
    version: 1, organizerId: 'system', createdAt: now, updatedAt: now, publishedAt: now, cancelledAt: null, ...over
  });
  return id;
}

async function credit(ownerId: string, amount: number): Promise<void> {
  await ledger.post(ctx('system'), {
    type: 'dragon_coin_issue', businessRef: `credit-${ownerId}-${newId()}`, idempotencyKey: `credit-${newId()}`, description: 'seed',
    entries: [{ account: { kind: 'system', accountType: 'platform_dragon_coin_treasury' }, amount: -amount }, { account: { kind: 'user', ownerId, accountType: 'user_dragon_coin' }, amount }]
  });
}
async function drcBalance(ownerId: string): Promise<number> {
  return (await ledger.getBalanceByRef({ kind: 'user', ownerId, accountType: 'user_dragon_coin' }))?.balance ?? 0;
}
function feeCallback(c: CheckoutRecord, outcome: 'success' | 'failed' | 'cancelled', eventId = `evt-${newId()}`): RawCallback {
  const fields = { provider: c.provider, providerRequestId: c.providerRequestId as string, purchaseId: c._id, rialAmount: c.irrAmount, asset: 'IRR', eventType: outcome, eventId };
  return { ...fields, signature: provider.sign(fields) };
}
const regState = async (id: string): Promise<string | undefined> => (await coll('registrations').findOne({ _id: id }))?.['state'] as string | undefined;

describe('the OD-007 gate', () => {
  test('paid checkout is refused when the gate is off, with no effect', async () => {
    const account = newId();
    const tid = await paidTournament([{ assetCode: 'IRR', amountInteger: 1_000_000 }]);
    await assert.rejects(() => checkoutDisabled.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` }), (e: { code?: string }) => e.code === 'PAID_TOURNAMENTS_DISABLED');
    assert.equal(await coll('registration_checkouts').countDocuments({}), 0);
    assert.equal(await coll('registrations').countDocuments({}), 0);
  });
});

describe('Toman fee checkout', () => {
  test('server recalculates the fee; a verified success activates the registration atomically', async () => {
    const account = newId();
    const tid = await paidTournament([{ assetCode: 'IRR', amountInteger: 1_000_000 }]);
    const started = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` });
    assert.equal(started.state, 'awaiting_payment');
    assert.equal(started.irrAmount, 1_000_000);
    assert.equal(await regState(started.registrationId), 'pending_payment');

    const activated = await checkout.handleFeeCallback(feeCallback(started, 'success'));
    assert.equal(activated.state, 'activated');
    assert.equal(await regState(started.registrationId), 'approved');
    // The collected fee posts one balanced ledger transaction into fee holding.
    const feeTxId = (await coll('registration_checkouts').findOne({ _id: started._id }))?.['feeTransactionId'] as string;
    assert.ok(feeTxId);
    assert.deepEqual(await reconcile.reconcileTransaction(feeTxId), []);
    assert.equal(await coll('audit_events').countDocuments({ action: 'checkout.activated' }), 1);
  });

  test('a duplicate success callback does not activate or charge twice', async () => {
    const account = newId();
    const tid = await paidTournament([{ assetCode: 'IRR', amountInteger: 1_000_000 }]);
    const started = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` });
    await checkout.handleFeeCallback(feeCallback(started, 'success', 'same'));
    await checkout.handleFeeCallback(feeCallback(started, 'success', 'same'));
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ 'metadata.checkoutId': started._id }), 1);
    assert.equal(await coll('audit_events').countDocuments({ action: 'checkout.activated' }), 1);
  });

  test('a failed callback releases the seat and does not collect the fee', async () => {
    const account = newId();
    const tid = await paidTournament([{ assetCode: 'IRR', amountInteger: 1_000_000 }]);
    const started = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` });
    const failed = await checkout.handleFeeCallback(feeCallback(started, 'failed'));
    assert.equal(failed.state, 'failed');
    assert.equal(await regState(started.registrationId), 'cancelled');
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ 'metadata.checkoutId': started._id }), 0);
    assert.equal((await coll('tournament_seat_counters').findOne({ _id: tid }))?.['mainCount'], 0);
  });
});

describe('Dragon Coin and mixed fee checkout', () => {
  test('a Dragon Coin fee reserves a hold and captures it on confirmation', async () => {
    const account = newId();
    await credit(account, 500);
    const tid = await paidTournament([{ assetCode: 'DRC', amountInteger: 200 }]);
    const started = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` });
    assert.equal(started.state, 'awaiting_confirmation');
    // The reservation reduces available balance but not the ledger balance yet.
    assert.equal((await ledger.getBalanceByRef({ kind: 'user', ownerId: account, accountType: 'user_dragon_coin' }))?.availableBalance, 300);
    assert.equal(await drcBalance(account), 500);

    const confirmed = await checkout.confirmDragonCoin(ctx(account), account, started._id);
    assert.equal(confirmed.state, 'activated');
    assert.equal(await regState(started.registrationId), 'approved');
    assert.equal(await drcBalance(account), 300); // captured 200
  });

  test('a mixed fee holds coins and collects Toman, activating on the callback', async () => {
    const account = newId();
    await credit(account, 500);
    const tid = await paidTournament([{ assetCode: 'IRR', amountInteger: 1_000_000 }, { assetCode: 'DRC', amountInteger: 150 }]);
    const started = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` });
    assert.equal(started.state, 'awaiting_payment');
    assert.equal(started.drcAmount, 150);
    await checkout.handleFeeCallback(feeCallback(started, 'success'));
    assert.equal(await regState(started.registrationId), 'approved');
    assert.equal(await drcBalance(account), 350); // 500 − 150 captured
  });

  test('an insufficient Dragon Coin balance blocks the checkout with no effect', async () => {
    const account = newId();
    await credit(account, 100);
    const tid = await paidTournament([{ assetCode: 'DRC', amountInteger: 200 }]);
    await assert.rejects(() => checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` }), (e: { code?: string }) => e.code === 'INSUFFICIENT_AVAILABLE_BALANCE');
    assert.equal(await coll('registration_checkouts').countDocuments({}), 0);
    assert.equal(await coll('registrations').countDocuments({}), 0);
    assert.equal(await drcBalance(account), 100);
  });
});

describe('idempotency, cancellation, expiry, ownership', () => {
  test('starting twice with the same key returns the same checkout', async () => {
    const account = newId();
    const tid = await paidTournament([{ assetCode: 'IRR', amountInteger: 1_000_000 }]);
    const first = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: 'same-key' });
    const replay = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: 'same-key' });
    assert.equal(replay._id, first._id);
    assert.equal(await coll('registration_checkouts').countDocuments({}), 1);
  });

  test('cancellation releases the seat and the hold', async () => {
    const account = newId();
    await credit(account, 500);
    const tid = await paidTournament([{ assetCode: 'DRC', amountInteger: 200 }]);
    const started = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` });
    const cancelled = await checkout.cancelCheckout(ctx(account), account, started._id, 'changed my mind');
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(await regState(started.registrationId), 'cancelled');
    assert.equal((await ledger.getBalanceByRef({ kind: 'user', ownerId: account, accountType: 'user_dragon_coin' }))?.availableBalance, 500);
  });

  test('expiry settles overdue checkouts and frees the seat', async () => {
    const account = newId();
    const tid = await paidTournament([{ assetCode: 'IRR', amountInteger: 1_000_000 }]);
    const started = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` });
    await coll('registration_checkouts').updateOne({ _id: started._id }, { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    assert.deepEqual(await checkout.expireDueCheckouts(ctx('system'), { limit: 10 }), { expired: 1 });
    assert.equal(await regState(started.registrationId), 'cancelled');
    assert.equal((await coll('registration_checkouts').findOne({ _id: started._id }))?.['state'], 'expired');
  });

  test('a checkout is not readable by another account (IDOR closed)', async () => {
    const account = newId();
    const tid = await paidTournament([{ assetCode: 'IRR', amountInteger: 1_000_000 }]);
    const started = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` });
    assert.equal(await checkout.getCheckout(newId(), started._id), null);
    assert.ok(await checkout.getCheckout(account, started._id));
  });

  test('a free tournament cannot start a checkout', async () => {
    const account = newId();
    const tid = await paidTournament([{ assetCode: 'IRR', amountInteger: 0 }]);
    await coll('tournaments').updateOne({ _id: tid }, { $set: { fee: { kind: 'free', components: [] } } });
    await assert.rejects(() => checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` }), (e: { fieldErrors?: Array<{ code: string }> }) => e.fieldErrors?.[0]?.code === 'FREE_TOURNAMENT');
  });
});

describe('a payment-pending registration is owned by checkout, not the admin decision path', () => {
  test('an admin cannot approve a payment-pending registration (no free seat, no double capacity)', async () => {
    const account = newId();
    const tid = await paidTournament([{ assetCode: 'IRR', amountInteger: 1_000_000 }]);
    const started = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` });
    assert.equal(await regState(started.registrationId), 'pending_payment');
    assert.equal((await coll('tournament_seat_counters').findOne({ _id: tid }))?.['mainCount'], 1);

    await assert.rejects(() => registrationsService.approve(ctx('admin'), 'admin', tid, started.registrationId, 'trying to skip payment'), (e: { code?: string }) => e.code === 'REGISTRATION_PAYMENT_PENDING');
    // No second seat claimed, no free activation, no fee collected.
    assert.equal((await coll('tournament_seat_counters').findOne({ _id: tid }))?.['mainCount'], 1);
    assert.equal(await regState(started.registrationId), 'pending_payment');
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ 'metadata.checkoutId': started._id }), 0);

    // The proper checkout completion still works and collects the fee exactly once.
    await checkout.handleFeeCallback(feeCallback(started, 'success'));
    assert.equal(await regState(started.registrationId), 'approved');
    assert.equal((await coll('tournament_seat_counters').findOne({ _id: tid }))?.['mainCount'], 1);
  });

  test('an admin/self cancel cannot settle a payment-pending registration directly', async () => {
    const account = newId();
    const tid = await paidTournament([{ assetCode: 'IRR', amountInteger: 1_000_000 }]);
    const started = await checkout.startCheckout(ctx(account), account, tid, { idempotencyKey: `k-${newId()}` });
    await assert.rejects(() => registrationsService.cancel(ctx(account), account, tid, started.registrationId, { asAdmin: false, reason: 'x' }), (e: { code?: string }) => e.code === 'REGISTRATION_PAYMENT_PENDING');
    // Cancelling through the checkout releases the seat correctly.
    await checkout.cancelCheckout(ctx(account), account, started._id, 'changed mind');
    assert.equal(await regState(started.registrationId), 'cancelled');
    assert.equal((await coll('tournament_seat_counters').findOne({ _id: tid }))?.['mainCount'], 0);
  });
});
