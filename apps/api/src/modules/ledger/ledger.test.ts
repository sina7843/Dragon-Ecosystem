import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildJournal, canonicalHash, MAX_ENTRIES, type PostCommand } from './journal.ts';
import { accountIdentityKey, type AccountRef } from './accounts.ts';

/**
 * Ledger accounting invariants and canonical hashing (DRAGON-11a) — database-free.
 * Every rule that keeps a journal balanced, single-asset, and safe is proven here
 * before any posting transaction can open.
 */

const treasury: AccountRef = { kind: 'system', accountType: 'platform_dragon_coin_treasury' };
const userAccount = (id: string): AccountRef => ({ kind: 'user', ownerId: id, accountType: 'user_dragon_coin' });

function issue(overrides: Partial<PostCommand> = {}): PostCommand {
  return {
    type: 'dragon_coin_issue',
    businessRef: 'ref-1',
    idempotencyKey: 'key-1',
    description: 'issue coins',
    entries: [
      { account: treasury, amount: -100 },
      { account: userAccount('u1'), amount: 100 }
    ],
    ...overrides
  };
}

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { fieldErrors?: Array<{ code: string }> }).fieldErrors?.[0]?.code;
  }
};

describe('journal invariants', () => {
  test('a balanced two-entry transaction is accepted', () => {
    const journal = buildJournal(issue());
    assert.equal(journal.assetCode, 'DRC');
    assert.equal(journal.legs.length, 2);
    assert.equal(journal.legs.reduce((s, l) => s + l.amount, 0), 0);
    assert.deepEqual(journal.legs.map((l) => l.lineNumber), [0, 1]);
  });

  test('a balanced multi-entry transaction is accepted', () => {
    const journal = buildJournal(
      issue({
        entries: [
          { account: treasury, amount: -100 },
          { account: userAccount('a'), amount: 40 },
          { account: userAccount('b'), amount: 60 }
        ]
      })
    );
    assert.equal(journal.legs.length, 3);
    assert.equal(journal.legs.reduce((s, l) => s + l.amount, 0), 0);
  });

  test('an unbalanced transaction is rejected', () => {
    assert.equal(code(() => buildJournal(issue({ entries: [{ account: treasury, amount: -100 }, { account: userAccount('u1'), amount: 90 }] }))), 'UNBALANCED_TRANSACTION');
  });

  test('fewer than two entries is rejected', () => {
    assert.equal(code(() => buildJournal(issue({ entries: [{ account: treasury, amount: 0 }] }))), 'TOO_FEW_ENTRIES');
  });

  test('more than the maximum entries is rejected', () => {
    const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ account: userAccount(`u${String(i)}`), amount: 1 }));
    assert.equal(code(() => buildJournal(issue({ entries: many }))), 'TOO_MANY_ENTRIES');
  });

  test('a zero-value entry is rejected', () => {
    assert.equal(code(() => buildJournal(issue({ entries: [{ account: treasury, amount: 0 }, { account: userAccount('u1'), amount: 0 }] }))), 'ZERO_ENTRY');
  });

  test('a non-safe-integer amount is rejected', () => {
    assert.equal(code(() => buildJournal(issue({ entries: [{ account: treasury, amount: -(2 ** 53) }, { account: userAccount('u1'), amount: 2 ** 53 }] }))), 'UNSAFE_INTEGER');
  });

  test('a running-sum overflow is rejected before the balance check', () => {
    const max = Number.MAX_SAFE_INTEGER;
    assert.equal(
      code(() => buildJournal(issue({ entries: [{ account: userAccount('a'), amount: max }, { account: userAccount('b'), amount: max }, { account: treasury, amount: -2 }] }))),
      'AMOUNT_OVERFLOW'
    );
  });

  test('mixing asset codes in one transaction is rejected', () => {
    // A DRC adjustment cannot include an IRR clearing account.
    const mixed: PostCommand = issue({
      type: 'compensation',
      entries: [
        { account: treasury, amount: -100 },
        { account: userAccount('u1'), amount: 100 },
        { account: { kind: 'system', accountType: 'cash_clearing' }, amount: 0 }
      ]
    });
    // The IRR leg trips either the mixed-asset guard or the zero guard first; assert it is rejected.
    assert.ok(code(() => buildJournal(mixed)) !== undefined);
    const mixedNonZero: PostCommand = issue({
      type: 'compensation',
      entries: [
        { account: treasury, amount: -100 },
        { account: userAccount('u1'), amount: 100 },
        { account: { kind: 'system', accountType: 'cash_clearing' }, amount: 50 }
      ]
    });
    assert.equal(code(() => buildJournal(mixedNonZero)), 'MIXED_ASSET');
  });

  test('an account type outside the transaction-type policy is rejected', () => {
    assert.equal(
      code(() => buildJournal(issue({ type: 'dragon_coin_transfer', entries: [{ account: { kind: 'system', accountType: 'cash_clearing' }, amount: -100 }, { account: userAccount('u1'), amount: 100 }] }))),
      'INVALID_ACCOUNT_RELATIONSHIP'
    );
  });

  test('an unsupported transaction type is rejected', () => {
    assert.equal(code(() => buildJournal(issue({ type: 'nope' as PostCommand['type'] }))), 'UNSUPPORTED_TRANSACTION_TYPE');
  });

  test('an empty business reference or description is rejected', () => {
    assert.equal(code(() => buildJournal(issue({ businessRef: '  ' }))), 'INVALID_BUSINESS_REFERENCE');
    assert.equal(code(() => buildJournal(issue({ description: '' }))), 'INVALID_DESCRIPTION');
  });

  test('metadata beyond the bounded schema is rejected', () => {
    assert.equal(code(() => buildJournal(issue({ metadata: { nested: { a: 1 } as unknown as string } }))), 'METADATA_INVALID');
  });
});

describe('canonical hashing', () => {
  test('is independent of entry order (order does not change the operation)', () => {
    const a = buildJournal(issue());
    const b = buildJournal(issue({ entries: [{ account: userAccount('u1'), amount: 100 }, { account: treasury, amount: -100 }] }));
    assert.equal(a.canonicalHash, b.canonicalHash);
  });

  test('changes when an amount changes', () => {
    const a = buildJournal(issue());
    const b = buildJournal(issue({ businessRef: 'ref-1', entries: [{ account: treasury, amount: -200 }, { account: userAccount('u1'), amount: 200 }] }));
    assert.notEqual(a.canonicalHash, b.canonicalHash);
  });

  test('changes when the business reference changes', () => {
    assert.notEqual(buildJournal(issue()).canonicalHash, buildJournal(issue({ businessRef: 'ref-2' })).canonicalHash);
  });

  test('does not depend on volatile metadata', () => {
    const a = buildJournal(issue({ metadata: { note: 'one' } }));
    const b = buildJournal(issue({ metadata: { note: 'two', extra: 5 } }));
    assert.equal(a.canonicalHash, b.canonicalHash);
  });

  test('account identity keys never embed a generated id', () => {
    assert.equal(accountIdentityKey(treasury), 'sys:platform_dragon_coin_treasury:DRC:0');
    assert.equal(accountIdentityKey(userAccount('u1')), 'usr:u1:user_dragon_coin:DRC:0');
  });
});

describe('property: generated balanced journals always sum to zero', () => {
  test('random balanced transactions of representative sizes stay exactly balanced', () => {
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const legCount = 2 + Math.floor(Math.random() * 8);
      const userLegs = Array.from({ length: legCount - 1 }, (_, i) => ({ account: userAccount(`u${String(i)}`), amount: 1 + Math.floor(Math.random() * 1000) }));
      const total = userLegs.reduce((s, l) => s + l.amount, 0);
      const journal = buildJournal(issue({ businessRef: `ref-${String(iteration)}`, entries: [{ account: treasury, amount: -total }, ...userLegs] }));
      assert.equal(journal.legs.reduce((s, l) => s + l.amount, 0), 0);
      // Reordered legs hash identically.
      const reordered = buildJournal(issue({ businessRef: `ref-${String(iteration)}`, entries: [...userLegs, { account: treasury, amount: -total }] }));
      assert.equal(journal.canonicalHash, reordered.canonicalHash);
    }
  });
});

describe('canonicalHash helper is stable', () => {
  test('same inputs produce the same digest', () => {
    const legs = [
      { account: treasury, identityKey: accountIdentityKey(treasury), amount: -100, lineNumber: 0, reference: null },
      { account: userAccount('u1'), identityKey: accountIdentityKey(userAccount('u1')), amount: 100, lineNumber: 1, reference: null }
    ];
    assert.equal(canonicalHash('dragon_coin_issue', 'ref-1', 'DRC', 0, legs), canonicalHash('dragon_coin_issue', 'ref-1', 'DRC', 0, legs));
  });
});
