import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MockPaymentProvider, type RawCallback } from './provider.ts';
import { canTransition, isTerminal, type PurchaseState } from './state.ts';
import { DRAGON_COIN_PACKAGES, PRICING_VERSION, findPackage, packageToman } from './packages.ts';

/** Payment state machine, package math, and callback signing/verification (DRAGON-11b) — database-free. */

const SECRET = 'test-only-payments-callback-secret-value';

function baseFields(over: Partial<Omit<RawCallback, 'signature'>> = {}): Omit<RawCallback, 'signature'> {
  return { provider: 'mock', providerRequestId: 'mock_p1', purchaseId: 'p1', rialAmount: 1_000_000, asset: 'IRR', eventType: 'success', eventId: 'evt1', ...over };
}

describe('purchase state machine', () => {
  test('valid transitions from payment_pending', () => {
    for (const to of ['succeeded', 'failed', 'cancelled', 'expired'] as PurchaseState[]) assert.ok(canTransition('payment_pending', to));
  });
  test('terminal states cannot return to pending or each other', () => {
    for (const from of ['succeeded', 'failed', 'cancelled', 'expired'] as PurchaseState[]) {
      assert.ok(isTerminal(from));
      assert.equal(canTransition(from, 'payment_pending'), false);
      assert.equal(canTransition(from, 'succeeded'), from === 'succeeded' ? false : false);
    }
  });
  test('only a succeeded purchase can be corrected', () => {
    assert.ok(canTransition('succeeded', 'corrected'));
    assert.equal(canTransition('failed', 'corrected'), false);
    assert.equal(canTransition('payment_pending', 'corrected'), false);
  });
});

describe('packages (integer, versioned, code-owned)', () => {
  test('every package is whole integers and derives Toman exactly', () => {
    for (const pkg of DRAGON_COIN_PACKAGES) {
      assert.ok(Number.isSafeInteger(pkg.dragonCoin) && pkg.dragonCoin > 0);
      assert.ok(Number.isSafeInteger(pkg.rial) && pkg.rial > 0);
      assert.equal(packageToman(pkg), pkg.rial / 10);
    }
  });
  test('lookup by code; unknown code is undefined; pricing is versioned', () => {
    assert.equal(findPackage('starter')?.dragonCoin, 100);
    assert.equal(findPackage('nope'), undefined);
    assert.equal(PRICING_VERSION, 1);
  });
});

describe('mock provider callback signing and verification', () => {
  const provider = new MockPaymentProvider(SECRET);

  test('a correctly signed callback verifies and returns the shaped result', () => {
    const fields = baseFields();
    const raw: RawCallback = { ...fields, signature: provider.sign(fields) };
    const verified = provider.verifyCallback(raw);
    assert.equal(verified.eventType, 'success');
    assert.equal(verified.purchaseId, 'p1');
    assert.equal(verified.rialAmount, 1_000_000);
  });

  test('a tampered amount fails verification (signature covers the amount)', () => {
    const fields = baseFields();
    const raw: RawCallback = { ...fields, signature: provider.sign(fields), rialAmount: 5 };
    assert.throws(() => provider.verifyCallback(raw), (e: { code?: string }) => e.code === 'CALLBACK_VERIFICATION_FAILED');
  });

  test('a wrong signature fails verification', () => {
    const raw: RawCallback = { ...baseFields(), signature: 'deadbeef'.repeat(8) };
    assert.throws(() => provider.verifyCallback(raw), (e: { code?: string }) => e.code === 'CALLBACK_VERIFICATION_FAILED');
  });

  test('a different secret produces a different signature', () => {
    const other = new MockPaymentProvider('another-secret-value-at-least-32ch!!');
    const fields = baseFields();
    assert.notEqual(provider.sign(fields), other.sign(fields));
  });

  test('a changed event id changes the signature (replay identity is bound)', () => {
    assert.notEqual(provider.sign(baseFields({ eventId: 'a' })), provider.sign(baseFields({ eventId: 'b' })));
  });

  test('an unrecognized event type is rejected even when signed', () => {
    const fields = baseFields({ eventType: 'refunded' });
    const raw: RawCallback = { ...fields, signature: provider.sign(fields) };
    assert.throws(() => provider.verifyCallback(raw), (e: { code?: string }) => e.code === 'CALLBACK_VERIFICATION_FAILED');
  });

  test('createRequest is deterministic and performs no network call', async () => {
    const request = await provider.createRequest({ purchaseId: 'abc', businessRef: 'dragon_coin_purchase:abc', rialAmount: 1, correlationId: 'c' });
    assert.equal(request.providerRequestId, 'mock_abc');
  });
});
