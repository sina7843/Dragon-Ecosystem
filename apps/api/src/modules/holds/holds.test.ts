import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canHoldTransition, isHoldOpen, isHoldTerminal, type HoldState } from './state.ts';
import { HOLD_PURPOSES, TRANSFER_TYPES, isHoldPurpose, isTransferType } from './purposes.ts';

/** Hold state machine, purpose/transfer gates, and amount conservation (DRAGON-11c) — database-free. */

describe('hold state machine', () => {
  test('open states can capture/release/expire; terminal states cannot change', () => {
    assert.ok(isHoldOpen('active') && isHoldOpen('partially_captured'));
    for (const terminal of ['captured', 'released', 'expired', 'cancelled'] as HoldState[]) {
      assert.ok(isHoldTerminal(terminal));
      assert.equal(isHoldOpen(terminal), false);
      assert.equal(canHoldTransition(terminal, 'active'), false);
      assert.equal(canHoldTransition(terminal, 'captured'), false);
    }
  });
  test('active can reach every settlement; partial capture stays capturable', () => {
    for (const to of ['partially_captured', 'captured', 'released', 'expired', 'cancelled'] as HoldState[]) assert.ok(canHoldTransition('active', to));
    assert.ok(canHoldTransition('partially_captured', 'captured'));
  });
});

describe('purpose and transfer gates (fail-closed)', () => {
  test('only admin_correction is enabled; gated purposes carry a reason', () => {
    assert.equal(HOLD_PURPOSES.admin_correction.enabled, true);
    assert.equal(HOLD_PURPOSES.tournament_entry_fee.enabled, false);
    assert.equal(HOLD_PURPOSES.prize_reservation.enabled, false);
    assert.ok(HOLD_PURPOSES.tournament_entry_fee.gateReason);
    assert.ok(isHoldPurpose('admin_correction') && !isHoldPurpose('nope'));
  });
  test('every declared transfer type is gated in this slice', () => {
    for (const type of Object.keys(TRANSFER_TYPES)) {
      assert.equal(TRANSFER_TYPES[type as keyof typeof TRANSFER_TYPES].enabled, false, `${type} must be disabled`);
    }
    assert.ok(isTransferType('user_to_user') && !isTransferType('nope'));
  });
});

/** A pure model of the hold arithmetic, mirroring the service, for the conservation property. */
interface Amounts {
  original: number;
  captured: number;
  released: number;
  remaining: number;
}
function capture(a: Amounts, amount: number): Amounts {
  if (amount <= 0 || amount > a.remaining) throw new Error('invalid capture');
  return { ...a, captured: a.captured + amount, remaining: a.remaining - amount };
}
function release(a: Amounts, amount: number): Amounts {
  if (amount <= 0 || amount > a.remaining) throw new Error('invalid release');
  return { ...a, released: a.released + amount, remaining: a.remaining - amount };
}
const conserves = (a: Amounts): boolean => a.original === a.captured + a.released + a.remaining;

describe('amount conservation property', () => {
  test('every valid capture/release sequence keeps original = captured + released + remaining', () => {
    for (let iteration = 0; iteration < 500; iteration += 1) {
      const original = 1 + Math.floor(Math.random() * 10_000);
      let amounts: Amounts = { original, captured: 0, released: 0, remaining: original };
      assert.ok(conserves(amounts));
      while (amounts.remaining > 0) {
        const amount = 1 + Math.floor(Math.random() * amounts.remaining);
        amounts = Math.random() < 0.5 ? capture(amounts, amount) : release(amounts, amount);
        assert.ok(conserves(amounts), 'conservation must hold after every operation');
        assert.ok(amounts.remaining >= 0 && amounts.captured >= 0 && amounts.released >= 0);
      }
      assert.equal(amounts.captured + amounts.released, original);
    }
  });
});
