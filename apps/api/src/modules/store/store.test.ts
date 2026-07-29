import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { newId } from '../../shared/ids.ts';
import { ValidationError } from '../../shared/errors.ts';
import { DOMESTIC_PROVINCES, buildVariantPrice, discountProblem, priceCart, settlementAmount, validAddress } from './pricing.ts';
import { STORE_COLLECTIONS } from './collections.ts';
import { DEFAULT_STORE_CONFIG } from './service.ts';
import { canFulfillmentTransition, canOrderTransition, canProductTransition, type DiscountRecord, type ProductVariantRecord } from './state.ts';
import { HOLD_PURPOSES } from '../holds/purposes.ts';

/** Pure pricing, address, and lifecycle rules, plus the OD-019/OD-020/COMMERCE-010 guardrails. */

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTE_RE = /\.(get|post|put|patch|delete|route|all)\(\s*[`'"]([^`'"]+)[`'"]/g;

function routeFiles(): string[] {
  return readdirSync(apiSrc, { recursive: true }).filter(
    (f): f is string => typeof f === 'string' && (f.endsWith('routes.ts') || f === 'server.ts')
  );
}

function variant(overrides: Partial<ProductVariantRecord> = {}): ProductVariantRecord {
  return {
    _id: newId(),
    productId: newId(),
    sku: 'DRG-TEE-M',
    translations: { fa: { name: 'تی‌شرت' }, en: { name: 'Tee' } },
    price: [{ assetCode: 'DRC', amountInteger: 100, scale: 0 }],
    stockOnHand: 5,
    state: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  };
}

function discount(overrides: Partial<DiscountRecord> = {}): DiscountRecord {
  return {
    _id: newId(),
    code: 'LAUNCH10',
    version: 1,
    percentOff: 10,
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-09-01T00:00:00.000Z',
    productIds: [],
    maxRedemptions: null,
    redemptionCount: 0,
    state: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  };
}

const NOW = '2026-08-15T12:00:00.000Z';

describe('server-side pricing (COMMERCE-004, COMMERCE-009)', () => {
  test('a line total is quantity times the catalog price, exactly', () => {
    const priced = priceCart([{ variant: variant(), productId: 'p1', quantity: 3 }], null, NOW);
    assert.equal(settlementAmount(priced.itemSubtotal), 300);
    assert.equal(settlementAmount(priced.grandTotal), 300);
    assert.equal(settlementAmount(priced.discountTotal), 0);
  });

  test('the receipt reconciles: line totals sum to the grand total', () => {
    const priced = priceCart(
      [
        { variant: variant({ price: [{ assetCode: 'DRC', amountInteger: 100, scale: 0 }] }), productId: 'p1', quantity: 2 },
        { variant: variant({ price: [{ assetCode: 'DRC', amountInteger: 55, scale: 0 }] }), productId: 'p2', quantity: 1 }
      ],
      discount(),
      NOW
    );
    const summed = priced.lines.reduce((total, line) => total + settlementAmount(line.lineTotal), 0);
    assert.equal(summed, settlementAmount(priced.grandTotal));
    assert.equal(settlementAmount(priced.itemSubtotal) - settlementAmount(priced.discountTotal), settlementAmount(priced.grandTotal));
  });

  test('shipping is present and zero rather than omitted, so the receipt has no silent gap', () => {
    const priced = priceCart([{ variant: variant(), productId: 'p1', quantity: 1 }], null, NOW);
    assert.equal(priced.shippingTotal.length, priced.itemSubtotal.length);
    assert.equal(settlementAmount(priced.shippingTotal), 0);
  });

  test('a Toman list price rides alongside the Dragon Coin price without mixing into it', () => {
    const priced = priceCart(
      [{ variant: variant({ price: buildVariantPrice({ dragonCoinAmount: 100, tomanAmount: 250_000 }) }), productId: 'p1', quantity: 2 }],
      null,
      NOW
    );
    assert.equal(settlementAmount(priced.grandTotal), 200, 'Dragon Coin settles');
    const rial = priced.grandTotal.find((m) => m.assetCode === 'IRR');
    assert.equal(rial?.amountInteger, 5_000_000, 'the rial representation is exact (250,000 Toman × 10 × 2)');
  });

  test('a discount reduces by whole percent and rounds the reduction down', () => {
    // 55 × 10% = 5.5 → the customer is charged 50, never 49.
    const priced = priceCart([{ variant: variant({ price: [{ assetCode: 'DRC', amountInteger: 55, scale: 0 }] }), productId: 'p1', quantity: 1 }], discount(), NOW);
    assert.equal(settlementAmount(priced.discountTotal), 5);
    assert.equal(settlementAmount(priced.grandTotal), 50);
  });

  test('a discount limited to other products changes nothing here', () => {
    const priced = priceCart([{ variant: variant(), productId: 'p1', quantity: 1 }], discount({ productIds: ['other'] }), NOW);
    assert.equal(settlementAmount(priced.discountTotal), 0);
    assert.equal(priced.discountApplied, null);
  });

  test('an invalid quantity is rejected rather than clamped', () => {
    assert.throws(() => priceCart([{ variant: variant(), productId: 'p1', quantity: 0 }], null, NOW), ValidationError);
    assert.throws(() => priceCart([{ variant: variant(), productId: 'p1', quantity: 1.5 }], null, NOW), ValidationError);
  });
});

describe('discount validity (COMMERCE-005)', () => {
  test('period, state, usage limit, and audience each disqualify a coupon', () => {
    assert.equal(discountProblem(discount(), NOW, ['p1']), null);
    assert.equal(discountProblem(null, NOW, ['p1']), 'UNKNOWN_DISCOUNT');
    assert.equal(discountProblem(discount({ state: 'disabled' }), NOW, ['p1']), 'DISCOUNT_DISABLED');
    assert.equal(discountProblem(discount({ startsAt: '2026-12-01T00:00:00.000Z' }), NOW, ['p1']), 'DISCOUNT_NOT_STARTED');
    assert.equal(discountProblem(discount({ endsAt: '2026-08-02T00:00:00.000Z' }), NOW, ['p1']), 'DISCOUNT_EXPIRED');
    assert.equal(discountProblem(discount({ maxRedemptions: 2, redemptionCount: 2 }), NOW, ['p1']), 'DISCOUNT_EXHAUSTED');
    assert.equal(discountProblem(discount({ productIds: ['other'] }), NOW, ['p1']), 'DISCOUNT_NOT_APPLICABLE');
  });

  test('the end of the window is exclusive, so a coupon does not survive its last instant', () => {
    const ends = '2026-09-01T00:00:00.000Z';
    assert.equal(discountProblem(discount({ endsAt: ends }), '2026-08-31T23:59:59.000Z', ['p1']), null);
    assert.equal(discountProblem(discount({ endsAt: ends }), ends, ['p1']), 'DISCOUNT_EXPIRED');
  });
});

describe('domestic delivery (COMMERCE-003, BR-026, CON-008)', () => {
  const valid = { fullName: 'Dragon Buyer', mobile: '09121234567', province: 'tehran', city: 'Tehran', postalCode: '1234567890', line1: 'Street 1, No. 2' };

  test('a valid Iranian address is accepted and normalized', () => {
    const address = validAddress({ ...valid, province: 'TEHRAN' });
    assert.equal(address.province, 'tehran');
    assert.equal(address.postalCode, '1234567890');
  });

  test('a province outside the domestic list is rejected before any payment', () => {
    assert.throws(
      () => validAddress({ ...valid, province: 'bavaria' }),
      (error: unknown) => error instanceof ValidationError && /region|address/i.test(error.message)
    );
  });

  test('every configured province is domestic and none is a carrier or rate', () => {
    assert.ok(DOMESTIC_PROVINCES.includes('tehran'));
    assert.ok(DOMESTIC_PROVINCES.length >= 31, 'the list covers the country');
    for (const province of DOMESTIC_PROVINCES) {
      assert.match(province, /^[a-z_]+$/, `"${province}" is not a plain region code`);
    }
  });

  test('a malformed postal code or mobile is rejected', () => {
    assert.throws(() => validAddress({ ...valid, postalCode: '123' }), ValidationError);
    assert.throws(() => validAddress({ ...valid, mobile: '+441234567890' }), ValidationError);
  });
});

describe('lifecycles', () => {
  test('a product archives from either state and never leaves archived', () => {
    assert.equal(canProductTransition('draft', 'published'), true);
    assert.equal(canProductTransition('published', 'draft'), true);
    assert.equal(canProductTransition('published', 'archived'), true);
    assert.equal(canProductTransition('archived', 'published'), false, 'an order snapshot may still reference it');
    assert.equal(canProductTransition('draft', 'draft'), false);
  });

  test('an order leaves pending_payment once and never returns', () => {
    assert.equal(canOrderTransition('pending_payment', 'paid'), true);
    assert.equal(canOrderTransition('pending_payment', 'failed'), true);
    assert.equal(canOrderTransition('paid', 'pending_payment'), false);
    assert.equal(canOrderTransition('failed', 'paid'), false, 'a failed payment cannot be talked into success');
  });

  test('fulfillment advances in order, and delivered is terminal (COMMERCE-008)', () => {
    assert.equal(canFulfillmentTransition('pending', 'packed'), true);
    assert.equal(canFulfillmentTransition('packed', 'shipped'), true);
    assert.equal(canFulfillmentTransition('shipped', 'delivered'), true);
    assert.equal(canFulfillmentTransition('pending', 'shipped'), false, 'a skipped step would falsify the operational record');
    assert.equal(canFulfillmentTransition('delivered', 'shipped'), false);
    assert.equal(canFulfillmentTransition('failed', 'pending'), true, 'a failure can be retried');
  });
});

describe('OD-019 / OD-020 / COMMERCE-010 gates', () => {
  test('both gates are fail-closed by default', () => {
    assert.equal(DEFAULT_STORE_CONFIG.physicalFulfillmentEnabled, false, 'OD-019');
    assert.equal(DEFAULT_STORE_CONFIG.entitlementRevocationEnabled, false, 'OD-020');
  });

  test('no registered route exposes a customer return or entitlement revocation', () => {
    // COMMERCE-010 and OD-020 are about what a customer can reach, so this is asserted
    // against the real Fastify path literals. Unrelated existing `revoke` routes — a role
    // assignment, a course enrolment, a session — are not entitlement revocation and are
    // matched precisely rather than by the bare word.
    const RETURNS = /^(returns?|rma|refunds?)$/i;
    const offenders: string[] = [];
    for (const relative of routeFiles()) {
      const source = readFileSync(join(apiSrc, relative), 'utf8');
      for (const match of source.matchAll(ROUTE_RE)) {
        const path = match[2] as string;
        const segments = path.split(/[/:]/);
        if (segments.some((segment) => RETURNS.test(segment))) offenders.push(`${relative}: ${path} (returns)`);
        if (/entitlement/i.test(path) && /revoke/i.test(path)) offenders.push(`${relative}: ${path} (revocation)`);
      }
    }
    assert.deepEqual(offenders, [], `a return or entitlement-revocation route is registered: ${offenders.join('; ')}`);
  });

  test('no carrier or shipping-rate concept exists in store code', () => {
    // OD-019 has selected no carrier, so naming one in *code* would imply a relationship
    // and a price rule that do not exist. Comments and route summaries legitimately
    // explain the absence, so both are stripped before the check — the assertion is about
    // identifiers and values, not prose.
    const CARRIER = /(carrier|tipax|courier|shipping_?rate|shippingRate|shippingPrice)/i;
    for (const file of ['state.ts', 'pricing.ts', 'service.ts', 'routes.ts', 'collections.ts']) {
      const source = readFileSync(join(apiSrc, 'modules', 'store', file), 'utf8');
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '')
        .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
      assert.ok(!CARRIER.test(code), `${file} names a carrier or shipping rate while OD-019 is open`);
    }
  });

  test('the store owns no return, refund, or revocation collection', () => {
    for (const name of Object.values(STORE_COLLECTIONS)) {
      assert.ok(!/(return|refund|revocation)/i.test(name), `collection "${name}" implies a workflow that is out of scope`);
    }
  });
});

describe('money boundary (ROLE-021, DEC-024)', () => {
  test('the store hold purpose captures to the platform treasury and allows no partial capture', () => {
    const policy = HOLD_PURPOSES['store_order'];
    assert.equal(policy.enabled, true);
    assert.equal(policy.captureDestination, 'platform_dragon_coin_treasury');
    // A partial capture would be a partial refund by another name, and DEC-034 approves
    // no return workflow — so an order is captured in full or not at all.
    assert.equal(policy.partialCaptureAllowed, false);
  });

  test('the store module never posts to the ledger itself', () => {
    const source = readFileSync(join(apiSrc, 'modules', 'store', 'service.ts'), 'utf8');
    assert.ok(!/ledger/i.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')), 'the store reaches money only through the holds port');
  });
});
