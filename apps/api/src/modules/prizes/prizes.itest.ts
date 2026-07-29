import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { runMigrations } from '../../shared/db/migrations.ts';
import { allMigrations } from '../../migrations.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { LedgerService, LEDGER_COLLECTIONS } from '../ledger/index.ts';
import { PrizesService } from './service.ts';
import { PRIZES_COLLECTIONS } from './collections.ts';
import type { TournamentRecord } from '../tournaments/index.ts';

/**
 * Prize integration coverage (DRAGON-12): versioned allocation from final standings,
 * immediate idempotent Dragon Coin crediting, pending cash entitlements, re-allocation
 * superseding prior unpaid cash, and the finance-only approve/pay(evidence)/fail
 * lifecycle. Requires `npm run db:test:up`.
 */

let fixture: TestDatabase;
let ledger: LedgerService;
let prizes: PrizesService;

// Mutable stubs so each test shapes the tournament prizes, standings, and roster.
let prizePlacements: Array<{ rank: number; rewards: Array<{ assetCode: 'IRR' | 'DRC'; amountInteger: number; scale: number }> }> = [];
let standings: { status: string; calculationVersion: number; rows: Array<{ participantId: string; rank: number }> } | null = null;
let accountByRegistration = new Map<string, string>();

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  ledger = new LedgerService(fixture.database);
  const tournaments = {
    getById: (): Promise<TournamentRecord | null> => Promise.resolve({ prizes: { version: 1, placements: prizePlacements } } as unknown as TournamentRecord)
  };
  const standingsAccess = { getStandings: (): Promise<typeof standings> => Promise.resolve(standings) };
  const registrations = { getById: (_t: string, regId: string): Promise<{ accountId: string } | null> => Promise.resolve(accountByRegistration.has(regId) ? { accountId: accountByRegistration.get(regId) as string } : null) };
  prizes = new PrizesService(fixture.database, tournaments, standingsAccess, registrations, ledger);
});

after(async () => {
  await fixture.dispose();
});

function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

beforeEach(async () => {
  for (const name of [PRIZES_COLLECTIONS.allocations, PRIZES_COLLECTIONS.entitlements, LEDGER_COLLECTIONS.accounts, LEDGER_COLLECTIONS.transactions, LEDGER_COLLECTIONS.entries, 'idempotency_keys', 'audit_events', 'domain_event_outbox']) {
    await coll(name).deleteMany({});
  }
  prizePlacements = [];
  standings = null;
  accountByRegistration = new Map();
});

const ctx = (accountId: string) => createRequestContext(newId(), { kind: 'account', accountId, roles: [] });
const drc = (n: number) => ({ assetCode: 'DRC' as const, amountInteger: n, scale: 0 });
const irr = (n: number) => ({ assetCode: 'IRR' as const, amountInteger: n, scale: 0 });
async function drcBalance(ownerId: string): Promise<number> {
  return (await ledger.getBalanceByRef({ kind: 'user', ownerId, accountType: 'user_dragon_coin' }))?.balance ?? 0;
}

describe('prize allocation', () => {
  test('allocates Dragon Coin credits immediately and cash prizes as pending entitlements', async () => {
    const tid = newId();
    const regA = newId();
    const regB = newId();
    const accA = newId();
    const accB = newId();
    accountByRegistration.set(regA, accA);
    accountByRegistration.set(regB, accB);
    prizePlacements = [{ rank: 1, rewards: [drc(1000), irr(5_000_000)] }, { rank: 2, rewards: [drc(500)] }];
    standings = { status: 'final', calculationVersion: 1, rows: [{ participantId: regA, rank: 1 }, { participantId: regB, rank: 2 }] };

    const summary = await prizes.allocate(ctx('finance'), tid);
    assert.deepEqual(summary, { version: 1, standingsVersion: 1, dragonCoinCredits: 2, cashEntitlements: 1 });
    assert.equal(await drcBalance(accA), 1000);
    assert.equal(await drcBalance(accB), 500);
    const cash = await coll(PRIZES_COLLECTIONS.entitlements).findOne({ tournamentId: tid, rank: 1 });
    assert.equal(cash?.['state'], 'pending');
    assert.equal(cash?.['amount'], 5_000_000);
    assert.equal(cash?.['accountId'], accA);
  });

  test('allocation is idempotent per standings version (no double Dragon Coin credit)', async () => {
    const tid = newId();
    const regA = newId();
    const accA = newId();
    accountByRegistration.set(regA, accA);
    prizePlacements = [{ rank: 1, rewards: [drc(1000)] }];
    standings = { status: 'final', calculationVersion: 3, rows: [{ participantId: regA, rank: 1 }] };
    const first = await prizes.allocate(ctx('finance'), tid);
    const replay = await prizes.allocate(ctx('finance'), tid);
    assert.deepEqual(first, replay);
    assert.equal(await drcBalance(accA), 1000);
    assert.equal(await coll(LEDGER_COLLECTIONS.transactions).countDocuments({ businessRef: `prize_drc:${tid}:1:${accA}` }), 1);
  });

  test('re-allocation after a standings correction supersedes prior unpaid cash and does not double-credit', async () => {
    const tid = newId();
    const regA = newId();
    const regC = newId();
    const accA = newId();
    const accC = newId();
    accountByRegistration.set(regA, accA);
    accountByRegistration.set(regC, accC);
    prizePlacements = [{ rank: 1, rewards: [drc(1000), irr(5_000_000)] }];
    standings = { status: 'final', calculationVersion: 1, rows: [{ participantId: regA, rank: 1 }] };
    await prizes.allocate(ctx('finance'), tid);

    // A correction changes the champion; standings version bumps.
    standings = { status: 'final', calculationVersion: 2, rows: [{ participantId: regC, rank: 1 }] };
    const v2 = await prizes.allocate(ctx('finance'), tid);
    assert.equal(v2.version, 2);
    // The new champion is credited; the prior champion's Dragon Coin prize is not clawed back.
    assert.equal(await drcBalance(accC), 1000);
    assert.equal(await drcBalance(accA), 1000);
    // The prior version's pending cash entitlement is superseded; a fresh pending exists.
    assert.equal((await coll(PRIZES_COLLECTIONS.entitlements).findOne({ tournamentId: tid, allocationVersion: 1, rank: 1 }))?.['state'], 'superseded');
    assert.equal((await coll(PRIZES_COLLECTIONS.entitlements).findOne({ tournamentId: tid, allocationVersion: 2, rank: 1 }))?.['state'], 'pending');
  });

  test('allocation requires final standings', async () => {
    standings = { status: 'provisional', calculationVersion: 1, rows: [] };
    await assert.rejects(() => prizes.allocate(ctx('finance'), newId()), (e: { code?: string }) => e.code === 'PRIZES_NOT_FINAL');
  });
});

describe('cash entitlement lifecycle (finance)', () => {
  async function pendingEntitlement(): Promise<{ id: string; accountId: string }> {
    const tid = newId();
    const regA = newId();
    const accA = newId();
    accountByRegistration.set(regA, accA);
    prizePlacements = [{ rank: 1, rewards: [irr(5_000_000)] }];
    standings = { status: 'final', calculationVersion: 1, rows: [{ participantId: regA, rank: 1 }] };
    await prizes.allocate(ctx('finance'), tid);
    const doc = await coll(PRIZES_COLLECTIONS.entitlements).findOne({ tournamentId: tid, rank: 1 });
    return { id: doc?._id as string, accountId: accA };
  }

  test('verify, approve, then pay with settlement evidence advances the entitlement', async () => {
    const { id } = await pendingEntitlement();
    const verified = await prizes.verifyRecipient(ctx('fin'), id, { expectedVersion: 1, reason: 'ID checked against the registration' });
    assert.equal(verified.state, 'pending', 'verification annotates without advancing the state');
    const approved = await prizes.approveEntitlement(ctx('fin'), id, { expectedVersion: 2, reason: 'verified winner' });
    assert.equal(approved.state, 'approved');
    const paid = await prizes.payEntitlement(ctx('fin2'), id, { expectedVersion: 3, reason: 'bank transfer done', settlementEvidence: 'REF-2026-0001' });
    assert.equal(paid.state, 'paid');
    assert.equal(paid.settlementEvidence, 'REF-2026-0001');
  });

  test('paying without settlement evidence is rejected', async () => {
    const { id } = await pendingEntitlement();
    await prizes.verifyRecipient(ctx('fin'), id, { expectedVersion: 1, reason: 'checked' });
    await prizes.approveEntitlement(ctx('fin'), id, { expectedVersion: 2, reason: 'ok' });
    await assert.rejects(() => prizes.payEntitlement(ctx('fin2'), id, { expectedVersion: 3, reason: 'x', settlementEvidence: '   ' }), (e: { fieldErrors?: Array<{ code: string }> }) => e.fieldErrors?.[0]?.code === 'SETTLEMENT_EVIDENCE_REQUIRED');
  });

  test('PAYOUT-006: the actor who approved cannot also settle', async () => {
    const { id } = await pendingEntitlement();
    await prizes.verifyRecipient(ctx('fin'), id, { expectedVersion: 1, reason: 'checked' });
    await prizes.approveEntitlement(ctx('same-actor'), id, { expectedVersion: 2, reason: 'approved' });
    await assert.rejects(
      () => prizes.payEntitlement(ctx('same-actor'), id, { expectedVersion: 3, reason: 'paying my own approval', settlementEvidence: 'REF' }),
      (error: Error) => /someone other than the actor who approved/.test(error.message)
    );
  });

  test('PAYOUT-006: an entitlement that reached approved without an approver cannot be settled', async () => {
    // Regression for a dual-control bypass: fail a never-approved payout, retry it back to
    // approved, and the approver comparison would have had nobody to compare against.
    const { id } = await pendingEntitlement();
    await prizes.verifyRecipient(ctx('fin'), id, { expectedVersion: 1, reason: 'checked' });
    await prizes.failEntitlement(ctx('solo'), id, { expectedVersion: 2, reason: 'bank rejected it' });
    const retried = await prizes.retryEntitlement(ctx('solo'), id, { expectedVersion: 3, reason: 'retry' });
    assert.equal(retried.state, 'approved');
    // The retrying actor becomes the approver of record, so settling as the same actor is
    // now refused by dual control rather than slipping past a null comparison.
    assert.equal(retried.approvedBy, 'solo');
    await assert.rejects(
      () => prizes.payEntitlement(ctx('solo'), id, { expectedVersion: 4, reason: 'settling my own retry', settlementEvidence: 'REF' }),
      (error: Error) => /someone other than the actor who approved/.test(error.message)
    );
  });

  test('PAYOUT-012: reconciliation names a settled payout that has no approver at all', async () => {
    const { id } = await pendingEntitlement();
    await prizes.verifyRecipient(ctx('fin'), id, { expectedVersion: 1, reason: 'checked' });
    await prizes.approveEntitlement(ctx('fin'), id, { expectedVersion: 2, reason: 'approved' });
    await prizes.payEntitlement(ctx('fin2'), id, { expectedVersion: 3, reason: 'settled', settlementEvidence: 'REF-OK' });
    // Force the condition: a paid entitlement whose approver is missing.
    await coll(PRIZES_COLLECTIONS.entitlements).updateOne({ _id: id }, { $set: { approvedBy: null } });
    const report = await prizes.reconcileFinance();
    assert.ok(report.differences.some((d) => d.kind === 'settled_without_approver'), 'the report names it rather than passing in silence');
  });

  test('PAYOUT-011: settlement is refused while the recipient is unverified', async () => {
    const { id } = await pendingEntitlement();
    await prizes.approveEntitlement(ctx('fin'), id, { expectedVersion: 1, reason: 'approved' });
    await assert.rejects(
      () => prizes.payEntitlement(ctx('fin2'), id, { expectedVersion: 2, reason: 'paying', settlementEvidence: 'REF' }),
      (error: { code?: string }) => error.code === 'RECIPIENT_NOT_VERIFIED'
    );
  });

  test('PAYOUT-009: a failed settlement is retried on the same record, not a new one', async () => {
    const { id } = await pendingEntitlement();
    await prizes.verifyRecipient(ctx('fin'), id, { expectedVersion: 1, reason: 'checked' });
    await prizes.approveEntitlement(ctx('fin'), id, { expectedVersion: 2, reason: 'approved' });
    const failed = await prizes.failEntitlement(ctx('fin2'), id, { expectedVersion: 3, reason: 'bank rejected the transfer' });
    assert.equal(failed.state, 'failed');

    const retried = await prizes.retryEntitlement(ctx('fin'), id, { expectedVersion: 4, reason: 'retry with corrected details' });
    assert.equal(retried.state, 'approved');
    assert.equal(retried._id, id, 'the same entitlement is reused, so a retry cannot become a second payment');

    const paid = await prizes.payEntitlement(ctx('fin2'), id, { expectedVersion: 5, reason: 'settled', settlementEvidence: 'REF-RETRY' });
    assert.equal(paid.state, 'paid');
    assert.equal(await coll(PRIZES_COLLECTIONS.entitlements).countDocuments({ _id: id }), 1, 'exactly one entitlement exists');
  });

  test('PAYOUT-010: a settled payout is reversed without altering the original evidence', async () => {
    const { id } = await pendingEntitlement();
    await prizes.verifyRecipient(ctx('fin'), id, { expectedVersion: 1, reason: 'checked' });
    await prizes.approveEntitlement(ctx('fin'), id, { expectedVersion: 2, reason: 'approved' });
    await prizes.payEntitlement(ctx('fin2'), id, { expectedVersion: 3, reason: 'settled', settlementEvidence: 'REF-ORIGINAL' });

    const reversed = await prizes.reverseEntitlement(ctx('fin3'), id, { expectedVersion: 4, reason: 'paid to the wrong account' });
    assert.equal(reversed.state, 'reversed');
    assert.equal(reversed.settlementEvidence, 'REF-ORIGINAL', 'the original evidence survives the reversal');
    assert.equal(reversed.reversalReason, 'paid to the wrong account');
    // A reversal is terminal: the record shows both that it was paid and that it was undone.
    await assert.rejects(() => prizes.payEntitlement(ctx('fin4'), id, { expectedVersion: 5, reason: 'again', settlementEvidence: 'REF-2' }));
  });

  test('PAYOUT-012: reconciliation names a dual-control violation rather than hiding it', async () => {
    const { id } = await pendingEntitlement();
    await prizes.verifyRecipient(ctx('fin'), id, { expectedVersion: 1, reason: 'checked' });
    await prizes.approveEntitlement(ctx('fin'), id, { expectedVersion: 2, reason: 'approved' });
    await prizes.payEntitlement(ctx('fin2'), id, { expectedVersion: 3, reason: 'settled', settlementEvidence: 'REF-OK' });

    const clean = await prizes.reconcileFinance();
    assert.deepEqual(clean.differences, [], 'a correctly settled payout raises nothing');
    assert.equal(clean.cash.settledAmount, 5_000_000);

    // Force the condition the report exists to catch: the same actor on both sides.
    await coll(PRIZES_COLLECTIONS.entitlements).updateOne({ _id: id }, { $set: { paidBy: 'fin' } });
    const dirty = await prizes.reconcileFinance();
    assert.ok(dirty.differences.some((d) => d.kind === 'dual_control_violation'), 'the report names the violation');
  });

  test('an invalid transition (pay while pending) is rejected', async () => {
    const { id } = await pendingEntitlement();
    await assert.rejects(() => prizes.payEntitlement(ctx('fin'), id, { expectedVersion: 1, reason: 'x', settlementEvidence: 'REF' }), (e: { code?: string }) => e.code === 'INVALID_ENTITLEMENT_TRANSITION');
  });

  test('entitlements list is owner-scoped', async () => {
    const { id, accountId } = await pendingEntitlement();
    const mine = await prizes.listAccountEntitlements(accountId);
    assert.equal(mine.items.length, 1);
    assert.equal(mine.items[0]?._id, id);
    assert.equal((await prizes.listAccountEntitlements(newId())).items.length, 0);
  });
});

describe('index definitions', () => {
  test('the declared unique allocation and entitlement indexes exist', async () => {
    const allocIndexes = await coll(PRIZES_COLLECTIONS.allocations).indexes();
    assert.equal(allocIndexes.find((i) => i.name === 'allocation_standings_unique')?.unique, true);
    const entIndexes = await coll(PRIZES_COLLECTIONS.entitlements).indexes();
    assert.equal(entIndexes.find((i) => i.name === 'entitlement_rank_unique')?.unique, true);
  });
});
