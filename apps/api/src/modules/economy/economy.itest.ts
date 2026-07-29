import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildEconomy, buildIdentity, buildLedger, buildServer } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { createRequestContext } from '../../shared/context.ts';
import { SESSION_COOKIE } from '../identity/index.ts';
import { GLOBAL_SCOPE_ID, GLOBAL_SCOPE_TYPE, roleAssignments } from '../admin/store.ts';
import type { LedgerService } from '../ledger/index.ts';
import { ECONOMY_COLLECTIONS } from './collections.ts';
import { DEFAULT_ECONOMY_LIMITS } from './state.ts';

/**
 * Economy integration coverage (REWARD-002..008, TEST-024).
 *
 * The load-bearing cases are the ones where value moves: a transfer must debit and credit
 * together, the same key must never move value twice, a held transfer must move nothing,
 * and a reward must issue once per rule per account no matter how often it is requested.
 */

let fixture: TestDatabase;
let app: FastifyInstance;
let ledger: LedgerService;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);

  const config = loadConfig({ NODE_ENV: 'test' });
  const identity = buildIdentity(fixture.database, config);
  const ledgerDeps = buildLedger(fixture.database);
  ledger = ledgerDeps.service;
  app = buildServer(config, {
    database: fixture.database,
    identity,
    admin: buildAdmin(fixture.database),
    economy: buildEconomy(fixture.database, identity, ledgerDeps)
  });
  await app.ready();
});

after(async () => {
  await app.close();
  await fixture.dispose();
});

beforeEach(async () => {
  for (const name of [
    ...Object.values(ECONOMY_COLLECTIONS),
    'ledger_accounts',
    'ledger_transactions',
    'ledger_entries',
    'role_assignments',
    'audit_events',
    'rate_limits'
  ]) {
    await fixture.database.db.collection(name).deleteMany({});
  }
});

let counter = 9_800_000;

interface Actor {
  cookie: string;
  accountId: string;
  username: string;
}

async function signUp(roles?: string | readonly string[]): Promise<Actor> {
  counter += 1;
  const mobile = `0912${String(counter)}`;
  const username = `coin${String(counter)}`;
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await app.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile, code } });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie } });
  const accountId = session.json<{ account: { id: string } }>().account.id;
  const profile = await app.inject({
    method: 'PUT',
    url: '/api/v1/account/profile',
    cookies: { [SESSION_COOKIE]: cookie },
    payload: { username, displayName: `Coin ${String(counter)}`, birthDate: '2000-01-01', visibility: 'public' }
  });
  assert.equal(profile.statusCode, 200, profile.body);
  for (const role of roles === undefined ? [] : typeof roles === 'string' ? [roles] : roles) {
    await roleAssignments(fixture.database.db).insertOne({
      _id: newId(),
      accountId,
      role,
      scopeType: GLOBAL_SCOPE_TYPE,
      scopeId: GLOBAL_SCOPE_ID,
      grantedBy: 'test',
      grantedAt: utcNow(),
      revokedAt: null
    });
  }
  return { cookie, accountId, username };
}

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

async function creditCoins(accountId: string, amount: number): Promise<void> {
  const context = createRequestContext(`economy-itest-credit-${accountId}-${String(amount)}`);
  const userRef = { kind: 'user' as const, ownerId: accountId, accountType: 'user_dragon_coin' as const };
  const treasuryRef = { kind: 'system' as const, accountType: 'platform_dragon_coin_treasury' as const };
  await ledger.ensureAccounts([userRef, treasuryRef]);
  await ledger.post(context, {
    type: 'dragon_coin_issue',
    businessRef: `economy-itest-credit:${accountId}:${String(amount)}`,
    idempotencyKey: `economy-itest-credit:${accountId}:${String(amount)}`,
    description: 'Test credit',
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

const key = (): string => `key-${String(++counter)}-${String(Date.now()).slice(-6)}`;

// --- Transfers (REWARD-005) ---

describe('coin transfers', () => {
  test('a transfer debits the sender and credits the recipient by the same amount', async () => {
    const [sender, recipient] = [await signUp(), await signUp()];
    await creditCoins(sender.accountId, 500);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/coin-transfers',
      ...auth(sender.cookie),
      payload: { recipientUsername: recipient.username, amount: 120, note: 'Good game', idempotencyKey: key() }
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json<{ state: string }>().state, 'completed');

    assert.equal(await balanceOf(sender.accountId), 380, 'the sender is debited');
    assert.equal(await balanceOf(recipient.accountId), 120, 'the recipient is credited by the same amount');
  });

  test('the same idempotency key never moves value twice', async () => {
    const [sender, recipient] = [await signUp(), await signUp()];
    await creditCoins(sender.accountId, 500);
    const sameKey = key();
    const payload = { recipientUsername: recipient.username, amount: 60, idempotencyKey: sameKey };

    const first = await app.inject({ method: 'POST', url: '/api/v1/me/coin-transfers', ...auth(sender.cookie), payload });
    const second = await app.inject({ method: 'POST', url: '/api/v1/me/coin-transfers', ...auth(sender.cookie), payload });
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(second.statusCode, 201, second.body);
    assert.equal(first.json<{ id: string }>().id, second.json<{ id: string }>().id);
    assert.equal(await balanceOf(sender.accountId), 440, 'debited exactly once');
    assert.equal(await balanceOf(recipient.accountId), 60);
  });

  test('two concurrent requests under one key move the value exactly once', async () => {
    // Regression: keying the ledger post on a freshly generated record id let both racers
    // post, so the sender was debited twice while the API reported a single transfer.
    const [sender, recipient] = [await signUp(), await signUp()];
    await creditCoins(sender.accountId, 500);
    const payload = { recipientUsername: recipient.username, amount: 40, idempotencyKey: key() };

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/me/coin-transfers', ...auth(sender.cookie), payload }),
      app.inject({ method: 'POST', url: '/api/v1/me/coin-transfers', ...auth(sender.cookie), payload })
    ]);
    // One racer wins; the other may be told the key is already in flight (409). Either
    // answer is honest — what must not happen is the value moving twice.
    assert.ok([a.statusCode, b.statusCode].includes(201), `${String(a.statusCode)} / ${String(b.statusCode)}`);
    assert.ok([a.statusCode, b.statusCode].every((code) => code === 201 || code === 409), `${String(a.statusCode)} / ${String(b.statusCode)}`);
    assert.equal(await balanceOf(sender.accountId), 460, 'debited exactly once');
    assert.equal(await balanceOf(recipient.accountId), 40, 'credited exactly once');

    // Scoped to this sender and key: a broad `^coin_transfer:` count would also see
    // postings made by other suites sharing the run.
    const postings = await fixture.database.db
      .collection('ledger_transactions')
      .countDocuments({ businessRef: `coin_transfer:${sender.accountId}:${payload.idempotencyKey}` });
    assert.equal(postings, 1, 'exactly one ledger posting exists for the key');
  });

  test('concurrent transfers cannot collectively pass the rolling window', async () => {
    // Regression: the window was read, then decided on, then written — so racers each saw
    // the same pre-race totals and were all admitted.
    const [sender, recipient] = [await signUp(), await signUp()];
    await creditCoins(sender.accountId, 5000);
    const attempts = DEFAULT_ECONOMY_LIMITS.transfersPerWindow + 5;
    const responses = await Promise.all(
      Array.from({ length: attempts }, () =>
        app.inject({ method: 'POST', url: '/api/v1/me/coin-transfers', ...auth(sender.cookie), payload: { recipientUsername: recipient.username, amount: 1, idempotencyKey: key() } })
      )
    );
    const accepted = responses.filter((r) => r.statusCode === 201).length;
    assert.ok(accepted <= DEFAULT_ECONOMY_LIMITS.transfersPerWindow, `admitted ${String(accepted)} transfers past a limit of ${String(DEFAULT_ECONOMY_LIMITS.transfersPerWindow)}`);
    assert.equal(await balanceOf(recipient.accountId), accepted, 'the ledger agrees with what was admitted');
  });

  test('a transfer larger than the balance fails and moves nothing', async () => {
    const [sender, recipient] = [await signUp(), await signUp()];
    await creditCoins(sender.accountId, 10);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/coin-transfers',
      ...auth(sender.cookie),
      payload: { recipientUsername: recipient.username, amount: 100, idempotencyKey: key() }
    });
    assert.ok(response.statusCode >= 400, `expected a failure, got ${String(response.statusCode)}`);
    assert.equal(await balanceOf(sender.accountId), 10, 'the sender keeps their coin');
    assert.equal(await balanceOf(recipient.accountId), 0, 'the recipient gets nothing');
  });

  test('a transfer to yourself is refused', async () => {
    const sender = await signUp();
    await creditCoins(sender.accountId, 100);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/coin-transfers',
      ...auth(sender.cookie),
      payload: { recipientUsername: sender.username, amount: 10, idempotencyKey: key() }
    });
    assert.equal(response.statusCode, 422, response.body);
  });

  test('a private recipient cannot be found, so a transfer cannot probe for one', async () => {
    const sender = await signUp();
    await creditCoins(sender.accountId, 100);
    counter += 1;
    const hiddenMobile = `0912${String(counter)}`;
    const hiddenName = `hidden${String(counter)}`;
    await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile: hiddenMobile } });
    const inbox = await app.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${hiddenMobile}` });
    const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
    const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile: hiddenMobile, code } });
    const hiddenCookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
    await app.inject({
      method: 'PUT',
      url: '/api/v1/account/profile',
      cookies: { [SESSION_COOKIE]: hiddenCookie },
      payload: { username: hiddenName, displayName: 'Hidden', birthDate: '2000-01-01', visibility: 'private' }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/coin-transfers',
      ...auth(sender.cookie),
      payload: { recipientUsername: hiddenName, amount: 10, idempotencyKey: key() }
    });
    assert.equal(response.statusCode, 404, 'a private account is indistinguishable from a missing one');
  });

  test('an anonymous caller cannot transfer', async () => {
    const recipient = await signUp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/me/coin-transfers', payload: { recipientUsername: recipient.username, amount: 10, idempotencyKey: key() } });
    assert.equal(response.statusCode, 401);
  });
});

// --- Limits, holds, and manual review (REWARD-007, DEC-049) ---

describe('limits and manual review', () => {
  test('a transfer at the review threshold is held and moves no value', async () => {
    const [sender, recipient] = [await signUp(), await signUp()];
    await creditCoins(sender.accountId, DEFAULT_ECONOMY_LIMITS.manualReviewThreshold + 100);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/coin-transfers',
      ...auth(sender.cookie),
      payload: { recipientUsername: recipient.username, amount: DEFAULT_ECONOMY_LIMITS.manualReviewThreshold, idempotencyKey: key() }
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json<{ state: string }>().state, 'manual_review');
    assert.equal(response.json<{ ledgerTransactionId: string | null }>().ledgerTransactionId, null);
    // Holding the record while moving the coin would be the worst of both.
    assert.equal(await balanceOf(recipient.accountId), 0, 'nothing moved while the transfer is held');
  });

  test('a transfer over the single-transfer cap is refused outright', async () => {
    const [sender, recipient] = [await signUp(), await signUp()];
    await creditCoins(sender.accountId, DEFAULT_ECONOMY_LIMITS.maxTransferAmount * 2);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/coin-transfers',
      ...auth(sender.cookie),
      payload: { recipientUsername: recipient.username, amount: DEFAULT_ECONOMY_LIMITS.maxTransferAmount + 1, idempotencyKey: key() }
    });
    assert.equal(response.statusCode, 422, response.body);
  });

  test('a reviewer releases a held transfer and the value moves exactly once', async () => {
    const [sender, recipient, reviewer] = [await signUp(), await signUp(), await signUp(['finance_operator', 'financial_approver'])];
    await creditCoins(sender.accountId, DEFAULT_ECONOMY_LIMITS.manualReviewThreshold + 100);
    const held = await app.inject({
      method: 'POST',
      url: '/api/v1/me/coin-transfers',
      ...auth(sender.cookie),
      payload: { recipientUsername: recipient.username, amount: DEFAULT_ECONOMY_LIMITS.manualReviewThreshold, idempotencyKey: key() }
    });
    const transferId = held.json<{ id: string }>().id;

    const released = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/coin-transfers/${transferId}/approve`,
      ...auth(reviewer.cookie),
      payload: { reason: 'Reviewed and cleared.' }
    });
    assert.equal(released.statusCode, 200, released.body);
    assert.equal(await balanceOf(recipient.accountId), DEFAULT_ECONOMY_LIMITS.manualReviewThreshold);

    // A second release must not move the value again.
    const again = await app.inject({ method: 'POST', url: `/api/v1/admin/coin-transfers/${transferId}/approve`, ...auth(reviewer.cookie), payload: { reason: 'Again.' } });
    assert.equal(again.statusCode, 409, 'a released transfer is no longer awaiting review');
    assert.equal(await balanceOf(recipient.accountId), DEFAULT_ECONOMY_LIMITS.manualReviewThreshold);
  });

  test('a rejected transfer moves nothing and cannot be released afterwards', async () => {
    const [sender, recipient, reviewer] = [await signUp(), await signUp(), await signUp(['finance_operator', 'financial_approver'])];
    await creditCoins(sender.accountId, DEFAULT_ECONOMY_LIMITS.manualReviewThreshold + 100);
    const held = await app.inject({
      method: 'POST',
      url: '/api/v1/me/coin-transfers',
      ...auth(sender.cookie),
      payload: { recipientUsername: recipient.username, amount: DEFAULT_ECONOMY_LIMITS.manualReviewThreshold, idempotencyKey: key() }
    });
    const transferId = held.json<{ id: string }>().id;

    const rejected = await app.inject({ method: 'POST', url: `/api/v1/admin/coin-transfers/${transferId}/reject`, ...auth(reviewer.cookie), payload: { reason: 'Suspicious.' } });
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal(await balanceOf(recipient.accountId), 0);
    assert.equal(await balanceOf(sender.accountId), DEFAULT_ECONOMY_LIMITS.manualReviewThreshold + 100, 'the sender never lost the coin');

    const released = await app.inject({ method: 'POST', url: `/api/v1/admin/coin-transfers/${transferId}/approve`, ...auth(reviewer.cookie), payload: { reason: 'Change of mind.' } });
    assert.equal(released.statusCode, 409);
  });

  test('an ordinary user cannot reach the review queue or release a transfer', async () => {
    const member = await signUp();
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/coin-transfers/review', ...auth(member.cookie) })).statusCode, 403);
    assert.equal(
      (await app.inject({ method: 'POST', url: `/api/v1/admin/coin-transfers/${newId()}/approve`, ...auth(member.cookie), payload: { reason: 'x' } })).statusCode,
      403
    );
  });
});

// --- Reward rules and grants (REWARD-002, REWARD-003) ---

describe('reward rules and grants', () => {
  async function rule(operator: Actor, amount: number, maxGrants?: number): Promise<string> {
    counter += 1;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/reward-rules',
      ...auth(operator.cookie),
      payload: { code: `WELCOME${String(counter).slice(-6)}`, source: 'promotion', amount, description: 'Welcome reward', ...(maxGrants === undefined ? {} : { maxGrants }) }
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<{ id: string }>().id;
  }

  test('a grant issues coin once per rule per account, however often it is requested', async () => {
    const operator = await signUp(['finance_operator', 'financial_approver']);
    const player = await signUp();
    const ruleId = await rule(operator, 75);

    const first = await app.inject({ method: 'POST', url: `/api/v1/admin/reward-rules/${ruleId}/grants`, ...auth(operator.cookie), payload: { accountId: player.accountId, reason: 'Signup promotion.' } });
    const second = await app.inject({ method: 'POST', url: `/api/v1/admin/reward-rules/${ruleId}/grants`, ...auth(operator.cookie), payload: { accountId: player.accountId, reason: 'Signup promotion.' } });
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(second.statusCode, 201, second.body);
    assert.equal(first.json<{ id: string }>().id, second.json<{ id: string }>().id);
    assert.equal(await balanceOf(player.accountId), 75, 'issued exactly once');
  });

  test('a grant records the actor, the reason, and its ledger transaction', async () => {
    const operator = await signUp(['finance_operator', 'financial_approver']);
    const player = await signUp();
    const ruleId = await rule(operator, 40);
    const granted = await app.inject({ method: 'POST', url: `/api/v1/admin/reward-rules/${ruleId}/grants`, ...auth(operator.cookie), payload: { accountId: player.accountId, reason: 'Compensation for the outage.' } });
    const body = granted.json<{ grantedBy: string; reason: string; ledgerTransactionId: string }>();
    assert.equal(body.grantedBy, operator.accountId);
    assert.equal(body.reason, 'Compensation for the outage.');
    assert.ok(body.ledgerTransactionId.length > 0, 'the grant is linked to a ledger transaction (REWARD-003)');
  });

  test('a grant without a reason is refused', async () => {
    const operator = await signUp(['finance_operator', 'financial_approver']);
    const player = await signUp();
    const ruleId = await rule(operator, 20);
    const response = await app.inject({ method: 'POST', url: `/api/v1/admin/reward-rules/${ruleId}/grants`, ...auth(operator.cookie), payload: { accountId: player.accountId, reason: '   ' } });
    assert.ok(response.statusCode >= 400 && response.statusCode < 500, `expected a client error, got ${String(response.statusCode)}`);
    assert.equal(await balanceOf(player.accountId), 0);
  });

  test('a rule stops granting once it reaches its limit', async () => {
    const operator = await signUp(['finance_operator', 'financial_approver']);
    const [first, second] = [await signUp(), await signUp()];
    const ruleId = await rule(operator, 10, 1);
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/admin/reward-rules/${ruleId}/grants`, ...auth(operator.cookie), payload: { accountId: first.accountId, reason: 'First.' } })).statusCode, 201);
    const exhausted = await app.inject({ method: 'POST', url: `/api/v1/admin/reward-rules/${ruleId}/grants`, ...auth(operator.cookie), payload: { accountId: second.accountId, reason: 'Second.' } });
    assert.equal(exhausted.statusCode, 409, exhausted.body);
    assert.equal(await balanceOf(second.accountId), 0);
  });

  test('an ordinary user cannot define a rule or issue a grant', async () => {
    const member = await signUp();
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/v1/admin/reward-rules', ...auth(member.cookie), payload: { code: 'NOPE123', source: 'promotion', amount: 10, description: 'x' } })).statusCode,
      403
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: `/api/v1/admin/reward-rules/${newId()}/grants`, ...auth(member.cookie), payload: { accountId: member.accountId, reason: 'x' } })).statusCode,
      403
    );
  });
});

// --- Reporting and gates ---

describe('reporting and gates', () => {
  test('reconciliation sees every grant and transfer with its ledger transaction', async () => {
    const operator = await signUp(['finance_operator', 'financial_approver']);
    const [sender, recipient] = [await signUp(), await signUp()];
    await creditCoins(sender.accountId, 300);
    counter += 1;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/reward-rules',
      ...auth(operator.cookie),
      payload: { code: `REC${String(counter).slice(-6)}`, source: 'promotion', amount: 25, description: 'Reconciliation fixture' }
    });
    const ruleId = created.json<{ id: string }>().id;
    await app.inject({ method: 'POST', url: `/api/v1/admin/reward-rules/${ruleId}/grants`, ...auth(operator.cookie), payload: { accountId: recipient.accountId, reason: 'Fixture.' } });
    await app.inject({ method: 'POST', url: '/api/v1/me/coin-transfers', ...auth(sender.cookie), payload: { recipientUsername: recipient.username, amount: 30, idempotencyKey: key() } });

    const report = await app.inject({ method: 'GET', url: '/api/v1/admin/economy/reconciliation', ...auth(operator.cookie) });
    assert.equal(report.statusCode, 200, report.body);
    const body = report.json<{ grants: { count: number; amount: number }; transfers: { completed: number; amount: number }; differences: unknown[] }>();
    assert.equal(body.grants.count, 1);
    assert.equal(body.grants.amount, 25);
    assert.equal(body.transfers.completed, 1);
    assert.equal(body.transfers.amount, 30);
    assert.deepEqual(body.differences, [], 'nothing is unexplained');
  });

  test('the config surface states what the economy will never do', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/economy/config' });
    assert.equal(response.statusCode, 200, response.body);
    const config = response.json<{ cashRedemption: string; orderBookTrading: string; peerCommerce: string; internalTomanWallet: string; limits: { manualReviewThreshold: number } }>();
    assert.equal(config.cashRedemption, 'never', 'DEC-024');
    assert.equal(config.orderBookTrading, 'never', 'DEC-023');
    assert.equal(config.peerCommerce, 'gated', 'OD-030');
    assert.equal(config.internalTomanWallet, 'disabled', 'DEC-050');
    assert.ok(config.limits.manualReviewThreshold > 0, 'the configured controls are visible');
  });
});
