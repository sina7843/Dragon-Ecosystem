import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decideTransfer, DEFAULT_ECONOMY_LIMITS, type EconomyLimits } from './state.ts';
import { ECONOMY_COLLECTIONS } from './collections.ts';
import { canEntitlementTransition, ENTITLEMENT_STATES, isOutstandingEntitlement, isSettledEntitlement } from '../prizes/state.ts';

/** Pure transfer policy, the payout lifecycle, and the no-cash-redemption guardrails. */

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTE_RE = /\.(get|post|put|patch|delete|route|all)\(\s*[`'"]([^`'"]+)[`'"]/g;

function routeFiles(): string[] {
  return readdirSync(apiSrc, { recursive: true }).filter(
    (f): f is string => typeof f === 'string' && (f.endsWith('routes.ts') || f === 'server.ts')
  );
}

const LIMITS: EconomyLimits = {
  maxTransferAmount: 1000,
  transferAmountPerWindow: 2000,
  transfersPerWindow: 5,
  windowSeconds: 3600,
  manualReviewThreshold: 500,
  payoutReviewThreshold: 1_000_000
};
const NONE = { count: 0, amount: 0 };
const A = 'account-a';
const B = 'account-b';

describe('transfer policy (REWARD-005, REWARD-007, DEC-049)', () => {
  test('an ordinary transfer inside every limit is allowed', () => {
    assert.deepEqual(decideTransfer(LIMITS, { amount: 100, senderId: A, recipientId: B }, NONE), { outcome: 'allow' });
  });

  test('a transfer to yourself is refused', () => {
    const decision = decideTransfer(LIMITS, { amount: 10, senderId: A, recipientId: A }, NONE);
    assert.equal(decision.outcome, 'reject');
    assert.equal(decision.outcome === 'reject' ? decision.code : '', 'SELF_TRANSFER');
  });

  test('a non-integer or non-positive amount is refused rather than rounded', () => {
    for (const amount of [0, -5, 1.5, Number.NaN]) {
      const decision = decideTransfer(LIMITS, { amount, senderId: A, recipientId: B }, NONE);
      assert.equal(decision.outcome, 'reject', `amount ${String(amount)} must be refused`);
    }
  });

  test('a single transfer over the per-transfer cap is refused', () => {
    const decision = decideTransfer(LIMITS, { amount: 1001, senderId: A, recipientId: B }, NONE);
    assert.equal(decision.outcome === 'reject' ? decision.code : '', 'TRANSFER_LIMIT_EXCEEDED');
  });

  test('the window caps count and amount independently', () => {
    const byCount = decideTransfer(LIMITS, { amount: 10, senderId: A, recipientId: B }, { count: 5, amount: 50 });
    assert.equal(byCount.outcome === 'reject' ? byCount.code : '', 'TRANSFER_COUNT_LIMIT');
    const byAmount = decideTransfer(LIMITS, { amount: 100, senderId: A, recipientId: B }, { count: 1, amount: 1950 });
    assert.equal(byAmount.outcome === 'reject' ? byAmount.code : '', 'TRANSFER_WINDOW_LIMIT');
  });

  test('at the review threshold the transfer is held, not refused', () => {
    // Held rather than rejected: a large transfer may be legitimate, and refusing it
    // outright would leave no record of what was attempted.
    const decision = decideTransfer(LIMITS, { amount: 500, senderId: A, recipientId: B }, NONE);
    assert.equal(decision.outcome, 'review');
    assert.equal(decision.outcome === 'review' ? decision.reason.includes('500') : false, true);
  });

  test('the shipped defaults hold a large transfer and cap a larger one', () => {
    const held = decideTransfer(DEFAULT_ECONOMY_LIMITS, { amount: DEFAULT_ECONOMY_LIMITS.manualReviewThreshold, senderId: A, recipientId: B }, NONE);
    assert.equal(held.outcome, 'review');
    const capped = decideTransfer(DEFAULT_ECONOMY_LIMITS, { amount: DEFAULT_ECONOMY_LIMITS.maxTransferAmount + 1, senderId: A, recipientId: B }, NONE);
    assert.equal(capped.outcome, 'reject');
  });
});

describe('payout lifecycle (PAYOUT-007, PAYOUT-009, PAYOUT-010)', () => {
  test('every state named by the requirement exists', () => {
    for (const state of ['pending', 'manual_review', 'approved', 'processing', 'paid', 'failed', 'cancelled', 'reversed']) {
      assert.ok((ENTITLEMENT_STATES as readonly string[]).includes(state), `missing state "${state}"`);
    }
  });

  test('a failed settlement is retryable and returns to approved on the same record', () => {
    assert.equal(canEntitlementTransition('failed', 'approved'), true);
    assert.equal(canEntitlementTransition('failed', 'paid'), false, 'a retry must go back through approval');
  });

  test('a paid payout can only be undone by an explicit reversal', () => {
    assert.equal(canEntitlementTransition('paid', 'reversed'), true);
    assert.equal(canEntitlementTransition('paid', 'failed'), false);
    assert.equal(canEntitlementTransition('paid', 'pending'), false, 'a settled payout cannot be un-settled quietly');
    assert.equal(canEntitlementTransition('reversed', 'paid'), false, 'a reversal is terminal');
  });

  test('cancelled is terminal and cannot become a payment', () => {
    assert.equal(canEntitlementTransition('cancelled', 'approved'), false);
    assert.equal(canEntitlementTransition('cancelled', 'paid'), false);
  });

  test('an in-flight settlement is distinguishable from an untouched one', () => {
    assert.equal(canEntitlementTransition('approved', 'processing'), true);
    assert.equal(canEntitlementTransition('processing', 'paid'), true);
    assert.equal(canEntitlementTransition('processing', 'failed'), true);
  });

  test('outstanding and settled classifications do not overlap', () => {
    for (const state of ENTITLEMENT_STATES) {
      assert.ok(!(isOutstandingEntitlement(state) && isSettledEntitlement(state)), `state "${state}" is both outstanding and settled`);
    }
    assert.equal(isSettledEntitlement('paid'), true);
    assert.equal(isOutstandingEntitlement('reversed'), false, 'a reversed payout is not still owed');
  });
});

describe('REWARD-006 / DEC-023 / DEC-024: no cash-out and no order book', () => {
  /**
   * Asserted against the registered route surface, not documentation. A redemption path
   * is exactly the thing that must not exist, so the check is that no such route can be
   * registered anywhere — including by a future module.
   */
  /**
   * Deliberately narrow. `withdraw` on its own is not a money concept in this codebase —
   * a player withdraws from a tournament — so the money sense is matched only when the
   * segment is about coin, a wallet, or a balance.
   */
  const REDEMPTION_PATH = /^(redeem|redemption|cash-?out|sell-?back|order-?book|exchange)$/i;
  const MONEY_WITHDRAWAL = /(coin|wallet|balance|ledger).*(withdraw|payout)|withdraw.*(coin|wallet|balance)/i;

  test('no registered API route offers redemption, coin withdrawal, or an exchange', () => {
    const offenders: string[] = [];
    for (const relative of routeFiles()) {
      const source = readFileSync(join(apiSrc, relative), 'utf8');
      for (const match of source.matchAll(ROUTE_RE)) {
        const path = match[2] as string;
        if (path.split(/[/:]/).some((segment) => REDEMPTION_PATH.test(segment))) offenders.push(`${relative}: ${path} (redemption)`);
        if (MONEY_WITHDRAWAL.test(path)) offenders.push(`${relative}: ${path} (coin withdrawal)`);
      }
    }
    assert.deepEqual(offenders, [], `a cash-redemption or exchange route is registered: ${offenders.join('; ')}`);
  });

  test('the economy module stores no redemption, order, or exchange collection', () => {
    for (const name of Object.values(ECONOMY_COLLECTIONS)) {
      assert.ok(!/(redeem|redemption|cash|withdraw|sell|exchange|order)/i.test(name), `collection "${name}" implies a redemption or exchange concept`);
    }
  });

  test('the transfer contract carries no price, rate, or counter-asset', () => {
    // A transfer moves one asset between two people. A price or a counter-asset would make
    // it a trade, which DEC-023 explicitly says Dragon Coin trading is not.
    const source = readFileSync(join(apiSrc, 'modules', 'economy', 'state.ts'), 'utf8');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '')
      .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
    for (const term of ['price', 'rate', 'counterAsset', 'bid', 'ask', 'orderBook']) {
      assert.ok(!code.includes(term), `the transfer contract mentions "${term}", which implies an exchange`);
    }
  });

  test('the ledger offers no transaction type that could move coin out to cash', async () => {
    // The strongest form of the guarantee: even a future caller cannot post a cash-out,
    // because the ledger has no transaction type that would balance one.
    const { TRANSACTION_TYPES } = await import('../ledger/index.ts');
    for (const type of Object.keys(TRANSACTION_TYPES)) {
      assert.ok(!/(redeem|cash_?out|withdraw|sell)/i.test(type), `ledger transaction type "${type}" could move coin out to cash`);
    }
  });
});
