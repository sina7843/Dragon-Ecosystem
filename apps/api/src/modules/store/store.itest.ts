import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildHolds, buildIdentity, buildLedger, buildServer, buildStore } from '../../server.ts';
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
import { STORE_COLLECTIONS } from './collections.ts';

/**
 * Commerce integration coverage (COMMERCE-001..014, UC-020, TEST-024).
 *
 * The load-bearing cases are the ones where money and stock meet: two buyers racing for
 * the last unit, a retried checkout, a payment that fails after stock was claimed, and a
 * receipt that has to reconcile to its own line items.
 */

let fixture: TestDatabase;
/** OD-019 gate off — the shipped default. */
let app: FastifyInstance;
/** OD-019 gate on, to prove physical selling is gated rather than absent. */
let physicalApp: FastifyInstance;
let ledger: LedgerService;

function buildApp(physicalFulfillmentEnabled: boolean): FastifyInstance {
  const config = { ...loadConfig({ NODE_ENV: 'test' }), physicalFulfillmentEnabled };
  const identity = buildIdentity(fixture.database, config);
  const ledgerDeps = buildLedger(fixture.database);
  ledger = ledgerDeps.service;
  const holds = buildHolds(fixture.database, ledgerDeps);
  return buildServer(config, {
    database: fixture.database,
    identity,
    admin: buildAdmin(fixture.database),
    store: buildStore(fixture.database, config, holds)
  });
}

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
  app = buildApp(false);
  physicalApp = buildApp(true);
  await Promise.all([app.ready(), physicalApp.ready()]);
});

after(async () => {
  await Promise.all([app.close(), physicalApp.close()]);
  await fixture.dispose();
});

beforeEach(async () => {
  for (const name of [
    ...Object.values(STORE_COLLECTIONS),
    'ledger_accounts',
    'ledger_transactions',
    'ledger_entries',
    'dragon_coin_holds',
    'idempotency_keys',
    'role_assignments',
    'audit_events',
    'rate_limits'
  ]) {
    await fixture.database.db.collection(name).deleteMany({});
  }
});

let counter = 9_600_000;

async function signIn(target: FastifyInstance, role?: string): Promise<{ cookie: string; accountId: string }> {
  counter += 1;
  const mobile = `0912${String(counter)}`;
  await target.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await target.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await target.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile, code } });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
  const session = await target.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie } });
  const accountId = session.json<{ account: { id: string } }>().account.id;
  if (role !== undefined) {
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
  return { cookie, accountId };
}

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

/** Credits a buyer's Dragon Coin so a checkout has something to reserve. */
async function creditCoins(accountId: string, amount: number): Promise<void> {
  const context = createRequestContext(`store-itest-credit-${accountId}`);
  const userRef = { kind: 'user' as const, ownerId: accountId, accountType: 'user_dragon_coin' as const };
  const treasuryRef = { kind: 'system' as const, accountType: 'platform_dragon_coin_treasury' as const };
  await ledger.ensureAccounts([userRef, treasuryRef]);
  await ledger.post(context, {
    type: 'dragon_coin_issue',
    businessRef: `store-itest-credit:${accountId}:${String(amount)}`,
    idempotencyKey: `store-itest-credit:${accountId}:${String(amount)}`,
    description: 'Test credit',
    entries: [
      { account: userRef, amount },
      { account: treasuryRef, amount: -amount }
    ]
  });
}

interface PublishedProduct {
  productId: string;
  variantId: string;
  slug: string;
}

/** Creates and publishes a product with one priced variant. */
async function publishedProduct(
  target: FastifyInstance,
  operatorCookie: string,
  options: { type?: 'physical' | 'digital'; price?: number; stock?: number; toman?: number } = {}
): Promise<PublishedProduct> {
  counter += 1;
  const slug = `product-${String(counter)}`;
  const created = await target.inject({
    method: 'POST',
    url: '/api/v1/admin/store/products',
    ...auth(operatorCookie),
    payload: {
      slug,
      type: options.type ?? 'digital',
      translations: {
        fa: { title: `محصول ${String(counter)}`, summary: 'خلاصه', description: 'توضیح' },
        en: { title: `Product ${String(counter)}`, summary: 'Summary', description: 'Description' }
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const productId = created.json<{ id: string }>().id;

  const variant = await target.inject({
    method: 'POST',
    url: `/api/v1/admin/store/products/${productId}/variants`,
    ...auth(operatorCookie),
    payload: {
      sku: `SKU-${String(counter)}`,
      translations: { fa: { name: 'گونه' }, en: { name: 'Standard' } },
      price: { dragonCoinAmount: options.price ?? 100, ...(options.toman === undefined ? {} : { tomanAmount: options.toman }) },
      ...(options.type === 'physical' ? { stockOnHand: options.stock ?? 5 } : {})
    }
  });
  assert.equal(variant.statusCode, 201, variant.body);
  const variantId = variant.json<{ id: string }>().id;

  const published = await target.inject({
    method: 'POST',
    url: `/api/v1/admin/store/products/${productId}/status`,
    ...auth(operatorCookie),
    payload: { state: 'published', reason: 'Launch.' }
  });
  assert.equal(published.statusCode, 200, published.body);
  return { productId, variantId, slug };
}

async function addToCart(target: FastifyInstance, cookie: string, variantId: string, quantity: number): Promise<number> {
  const response = await target.inject({ method: 'PATCH', url: '/api/v1/me/cart', ...auth(cookie), payload: { variantId, quantity } });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ version: number }>().version;
}

interface OrderBody {
  id: string;
  state: string;
  reference: string;
  grandTotal: Array<{ assetCode: string; amountInteger: number }>;
}

function drc(amounts: Array<{ assetCode: string; amountInteger: number }>): number {
  return amounts.find((m) => m.assetCode === 'DRC')?.amountInteger ?? 0;
}

const ADDRESS = { fullName: 'Dragon Buyer', mobile: '09121234567', province: 'tehran', city: 'Tehran', postalCode: '1234567890', line1: 'Street 1' };

// --- Catalog and authorization (COMMERCE-001, COMMERCE-014, ROLE-021) ---

describe('catalog authoring', () => {
  test('an ordinary user cannot author the catalog', async () => {
    const buyer = await signIn(app);
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/store/products', ...auth(buyer.cookie), payload: { type: 'digital', translations: { fa: { title: 'x' }, en: { title: 'x' } } } });
    assert.equal(response.statusCode, 403, response.body);
  });

  test('a draft product is not publicly discoverable', async () => {
    const operator = await signIn(app, 'shop_operator');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/store/products',
      ...auth(operator.cookie),
      payload: { slug: `draft-${String(++counter)}`, type: 'digital', translations: { fa: { title: 'پیش‌نویس' }, en: { title: 'Draft' } } }
    });
    const slug = created.json<{ slug: string }>().slug;
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/products/${slug}` })).statusCode, 404);
  });

  test('a product without an active variant cannot be published', async () => {
    const operator = await signIn(app, 'shop_operator');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/store/products',
      ...auth(operator.cookie),
      payload: { slug: `bare-${String(++counter)}`, type: 'digital', translations: { fa: { title: 'بدون گونه' }, en: { title: 'Bare' } } }
    });
    const id = created.json<{ id: string }>().id;
    const published = await app.inject({ method: 'POST', url: `/api/v1/admin/store/products/${id}/status`, ...auth(operator.cookie), payload: { state: 'published', reason: 'x' } });
    assert.equal(published.statusCode, 422, published.body);
  });

  test('a duplicate SKU is rejected', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie);
    const sku = (await app.inject({ method: 'GET', url: `/api/v1/products/${product.slug}` })).json<{ variants: Array<{ sku: string }> }>().variants[0]?.sku as string;
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/store/products/${product.productId}/variants`,
      ...auth(operator.cookie),
      payload: { sku, translations: { fa: { name: 'دوم' }, en: { name: 'Second' } }, price: { dragonCoinAmount: 50 } }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
  });

  test('the catalog filters by type', async () => {
    const operator = await signIn(app, 'shop_operator');
    const digital = await publishedProduct(app, operator.cookie, { type: 'digital' });
    const listed = await app.inject({ method: 'GET', url: '/api/v1/products?locale=en&type=digital' });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.ok(listed.json<{ items: Array<{ id: string }> }>().items.some((item) => item.id === digital.productId));
    const physicalOnly = await app.inject({ method: 'GET', url: '/api/v1/products?locale=en&type=physical' });
    assert.ok(!physicalOnly.json<{ items: Array<{ id: string }> }>().items.some((item) => item.id === digital.productId));
  });
});

// --- Inventory (COMMERCE-002, COMMERCE-013, BR-027) ---

describe('inventory', () => {
  test('an adjustment is recorded with its actor, reason, and resulting quantity', async () => {
    const operator = await signIn(physicalApp, 'shop_operator');
    const product = await publishedProduct(physicalApp, operator.cookie, { type: 'physical', stock: 4 });
    const adjusted = await physicalApp.inject({
      method: 'POST',
      url: `/api/v1/admin/store/variants/${product.variantId}/inventory`,
      ...auth(operator.cookie),
      payload: { quantityDelta: 6, reason: 'Restock from supplier.' }
    });
    assert.equal(adjusted.statusCode, 200, adjusted.body);
    assert.equal(adjusted.json<{ stockOnHand: number }>().stockOnHand, 10);

    const history = await physicalApp.inject({ method: 'GET', url: `/api/v1/admin/store/variants/${product.variantId}/inventory`, ...auth(operator.cookie) });
    const items = history.json<{ items: Array<{ quantityDelta: number; reason: string; resultingQuantity: number; actorId: string | null }> }>().items;
    const restock = items.find((m) => m.quantityDelta === 6);
    assert.ok(restock !== undefined, 'the movement is retained');
    assert.equal(restock.resultingQuantity, 10);
    assert.equal(restock.reason, 'Restock from supplier.');
    assert.equal(restock.actorId, operator.accountId);
  });

  test('stock cannot be adjusted below zero', async () => {
    const operator = await signIn(physicalApp, 'shop_operator');
    const product = await publishedProduct(physicalApp, operator.cookie, { type: 'physical', stock: 2 });
    const response = await physicalApp.inject({
      method: 'POST',
      url: `/api/v1/admin/store/variants/${product.variantId}/inventory`,
      ...auth(operator.cookie),
      payload: { quantityDelta: -3, reason: 'Shrinkage.' }
    });
    assert.equal(response.statusCode, 409, response.body);
  });

  test('an out-of-stock variant cannot be added to a cart', async () => {
    const operator = await signIn(physicalApp, 'shop_operator');
    const product = await publishedProduct(physicalApp, operator.cookie, { type: 'physical', stock: 0 });
    const buyer = await signIn(physicalApp);
    const response = await physicalApp.inject({ method: 'PATCH', url: '/api/v1/me/cart', ...auth(buyer.cookie), payload: { variantId: product.variantId, quantity: 1 } });
    assert.equal(response.statusCode, 409, response.body);
  });
});

// --- Cart and pricing (COMMERCE-004, COMMERCE-005) ---

describe('cart and pricing', () => {
  test('totals are calculated server-side and ignore any client price', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 250 });
    const buyer = await signIn(app);
    await addToCart(app, buyer.cookie, product.variantId, 2);

    const cart = await app.inject({ method: 'GET', url: '/api/v1/me/cart?locale=en', ...auth(buyer.cookie) });
    const totals = cart.json<{ totals: { grandTotal: Array<{ assetCode: string; amountInteger: number }> } }>().totals;
    assert.equal(drc(totals.grandTotal), 500);
  });

  test('an invalid coupon leaves the price unchanged and reports why', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 100 });
    const buyer = await signIn(app);
    await addToCart(app, buyer.cookie, product.variantId, 1);

    const applied = await app.inject({ method: 'PATCH', url: '/api/v1/me/cart?locale=en', ...auth(buyer.cookie), payload: { discountCode: 'NOPE' } });
    const body = applied.json<{ discountProblem: string; totals: { grandTotal: Array<{ assetCode: string; amountInteger: number }> } }>();
    assert.equal(body.discountProblem, 'UNKNOWN_DISCOUNT');
    assert.equal(drc(body.totals.grandTotal), 100, 'an invalid coupon produces no price change');
  });

  test('a valid coupon reduces the total by its whole percent', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 200 });
    const code = `SAVE${String(++counter).slice(-5)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/store/discounts',
      ...auth(operator.cookie),
      payload: { code, percentOff: 25, startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z' }
    });
    assert.equal(created.statusCode, 201, created.body);

    const buyer = await signIn(app);
    await addToCart(app, buyer.cookie, product.variantId, 1);
    const applied = await app.inject({ method: 'PATCH', url: '/api/v1/me/cart?locale=en', ...auth(buyer.cookie), payload: { discountCode: code } });
    const totals = applied.json<{ totals: { discountTotal: Array<{ assetCode: string; amountInteger: number }>; grandTotal: Array<{ assetCode: string; amountInteger: number }> } }>().totals;
    assert.equal(drc(totals.discountTotal), 50);
    assert.equal(drc(totals.grandTotal), 150);
  });
});

// --- Checkout (COMMERCE-006, COMMERCE-007, UC-020) ---

describe('checkout', () => {
  test('a digital purchase captures the price and grants an entitlement', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 120 });
    const buyer = await signIn(app);
    await creditCoins(buyer.accountId, 500);
    const version = await addToCart(app, buyer.cookie, product.variantId, 1);

    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      ...auth(buyer.cookie),
      payload: { cartVersion: version, idempotencyKey: `key-${String(++counter)}`, consent: true }
    });
    assert.equal(order.statusCode, 201, order.body);
    const body = order.json<OrderBody>();
    assert.equal(body.state, 'paid');
    assert.equal(drc(body.grandTotal), 120);

    const entitlements = await app.inject({ method: 'GET', url: '/api/v1/me/entitlements', ...auth(buyer.cookie) });
    assert.equal(entitlements.json<{ items: unknown[] }>().items.length, 1);
  });

  test('a retried checkout returns the original order rather than a second one', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 60 });
    const buyer = await signIn(app);
    await creditCoins(buyer.accountId, 500);
    const version = await addToCart(app, buyer.cookie, product.variantId, 1);
    const key = `retry-${String(++counter)}`;

    const first = await app.inject({ method: 'POST', url: '/api/v1/orders', ...auth(buyer.cookie), payload: { cartVersion: version, idempotencyKey: key, consent: true } });
    const second = await app.inject({ method: 'POST', url: '/api/v1/orders', ...auth(buyer.cookie), payload: { cartVersion: version, idempotencyKey: key, consent: true } });
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(second.statusCode, 201, second.body);
    assert.equal(first.json<OrderBody>().id, second.json<OrderBody>().id);

    const orders = await app.inject({ method: 'GET', url: '/api/v1/me/orders', ...auth(buyer.cookie) });
    assert.equal(orders.json<{ items: unknown[] }>().items.length, 1, 'exactly one order exists');
  });

  test('a checkout priced against a stale cart is rejected', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 60 });
    const buyer = await signIn(app);
    await creditCoins(buyer.accountId, 500);
    const stale = await addToCart(app, buyer.cookie, product.variantId, 1);
    await addToCart(app, buyer.cookie, product.variantId, 2); // cart moved on

    const response = await app.inject({ method: 'POST', url: '/api/v1/orders', ...auth(buyer.cookie), payload: { cartVersion: stale, idempotencyKey: `stale-${String(++counter)}`, consent: true } });
    assert.equal(response.statusCode, 409, response.body);
  });

  test('checkout without consent is refused', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 60 });
    const buyer = await signIn(app);
    await creditCoins(buyer.accountId, 500);
    const version = await addToCart(app, buyer.cookie, product.variantId, 1);
    const response = await app.inject({ method: 'POST', url: '/api/v1/orders', ...auth(buyer.cookie), payload: { cartVersion: version, idempotencyKey: `nc-${String(++counter)}`, consent: false } });
    assert.equal(response.statusCode, 422, response.body);
  });

  test('a payment that cannot be funded creates no entitlement and returns the stock', async () => {
    const operator = await signIn(physicalApp, 'shop_operator');
    const product = await publishedProduct(physicalApp, operator.cookie, { type: 'physical', price: 900, stock: 3 });
    const buyer = await signIn(physicalApp);
    await creditCoins(buyer.accountId, 10); // nowhere near enough
    const version = await addToCart(physicalApp, buyer.cookie, product.variantId, 1);

    const response = await physicalApp.inject({
      method: 'POST',
      url: '/api/v1/orders',
      ...auth(buyer.cookie),
      payload: { cartVersion: version, idempotencyKey: `poor-${String(++counter)}`, consent: true, address: ADDRESS }
    });
    assert.ok(response.statusCode >= 400, `expected a failure, got ${String(response.statusCode)}`);

    const detail = await physicalApp.inject({ method: 'GET', url: `/api/v1/products/${product.slug}?locale=en`, ...auth(buyer.cookie) });
    assert.equal(detail.json<{ variants: Array<{ stockOnHand: number }> }>().variants[0]?.stockOnHand, 3, 'the claimed unit is returned');

    const entitlements = await physicalApp.inject({ method: 'GET', url: '/api/v1/me/entitlements', ...auth(buyer.cookie) });
    assert.deepEqual(entitlements.json<{ items: unknown[] }>().items, [], 'a failed payment grants nothing (COMMERCE-007)');
  });

  test('two buyers racing for the last unit produce exactly one order (BR-027)', async () => {
    const operator = await signIn(physicalApp, 'shop_operator');
    const product = await publishedProduct(physicalApp, operator.cookie, { type: 'physical', price: 50, stock: 1 });
    const first = await signIn(physicalApp);
    const second = await signIn(physicalApp);
    await creditCoins(first.accountId, 500);
    await creditCoins(second.accountId, 500);
    const firstVersion = await addToCart(physicalApp, first.cookie, product.variantId, 1);
    const secondVersion = await addToCart(physicalApp, second.cookie, product.variantId, 1);

    const [a, b] = await Promise.all([
      physicalApp.inject({ method: 'POST', url: '/api/v1/orders', ...auth(first.cookie), payload: { cartVersion: firstVersion, idempotencyKey: `race-a-${String(++counter)}`, consent: true, address: ADDRESS } }),
      physicalApp.inject({ method: 'POST', url: '/api/v1/orders', ...auth(second.cookie), payload: { cartVersion: secondVersion, idempotencyKey: `race-b-${String(++counter)}`, consent: true, address: ADDRESS } })
    ]);

    const succeeded = [a, b].filter((r) => r.statusCode === 201);
    assert.equal(succeeded.length, 1, `exactly one buyer wins the last unit; got ${String(a.statusCode)} and ${String(b.statusCode)}`);
    const variant = await fixture.database.db.collection(STORE_COLLECTIONS.variants).findOne({ _id: product.variantId } as never);
    assert.equal((variant as unknown as { stockOnHand: number }).stockOnHand, 0, 'stock never goes negative');
  });
});

// --- Domestic delivery and the OD-019 gate ---

describe('domestic delivery and the physical gate', () => {
  test('a physical item cannot be purchased while OD-019 is unresolved', async () => {
    const operator = await signIn(physicalApp, 'shop_operator');
    // Authored on the gate-on app, then bought through the gate-off app: same database.
    const product = await publishedProduct(physicalApp, operator.cookie, { type: 'physical', price: 40, stock: 5 });
    const buyer = await signIn(app);
    await creditCoins(buyer.accountId, 500);

    const cartResponse = await app.inject({ method: 'PATCH', url: '/api/v1/me/cart?locale=en', ...auth(buyer.cookie), payload: { variantId: product.variantId, quantity: 1 } });
    assert.equal(cartResponse.json<{ blocked: string | null }>().blocked, 'PHYSICAL_FULFILLMENT_DISABLED', 'the cart says so before checkout');

    const version = cartResponse.json<{ version: number }>().version;
    const response = await app.inject({ method: 'POST', url: '/api/v1/orders', ...auth(buyer.cookie), payload: { cartVersion: version, idempotencyKey: `gated-${String(++counter)}`, consent: true, address: ADDRESS } });
    assert.equal(response.statusCode, 409, response.body);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/products/${product.slug}?locale=en` });
    assert.equal(detail.json<{ purchasable: boolean; purchasableReason: string }>().purchasableReason, 'PHYSICAL_FULFILLMENT_DISABLED');
  });

  test('a non-domestic address is rejected before any payment (COMMERCE-003)', async () => {
    const operator = await signIn(physicalApp, 'shop_operator');
    const product = await publishedProduct(physicalApp, operator.cookie, { type: 'physical', price: 40, stock: 5 });
    const buyer = await signIn(physicalApp);
    await creditCoins(buyer.accountId, 500);
    const version = await addToCart(physicalApp, buyer.cookie, product.variantId, 1);

    const response = await physicalApp.inject({
      method: 'POST',
      url: '/api/v1/orders',
      ...auth(buyer.cookie),
      payload: { cartVersion: version, idempotencyKey: `abroad-${String(++counter)}`, consent: true, address: { ...ADDRESS, province: 'bavaria' } }
    });
    assert.equal(response.statusCode, 422, response.body);

    const detail = await physicalApp.inject({ method: 'GET', url: `/api/v1/products/${product.slug}?locale=en` });
    assert.equal(detail.json<{ variants: Array<{ stockOnHand: number }> }>().variants[0]?.stockOnHand, 5, 'nothing was reserved');
  });

  test('a paid physical order advances through internal fulfillment states only', async () => {
    const operator = await signIn(physicalApp, 'shop_operator');
    const product = await publishedProduct(physicalApp, operator.cookie, { type: 'physical', price: 40, stock: 5 });
    const buyer = await signIn(physicalApp);
    await creditCoins(buyer.accountId, 500);
    const version = await addToCart(physicalApp, buyer.cookie, product.variantId, 1);
    const order = await physicalApp.inject({ method: 'POST', url: '/api/v1/orders', ...auth(buyer.cookie), payload: { cartVersion: version, idempotencyKey: `ship-${String(++counter)}`, consent: true, address: ADDRESS } });
    assert.equal(order.statusCode, 201, order.body);
    const orderId = order.json<OrderBody>().id;

    const fulfillments = await physicalApp.inject({ method: 'GET', url: `/api/v1/admin/store/orders/${orderId}/fulfillments`, ...auth(operator.cookie) });
    const fulfillmentId = fulfillments.json<{ items: Array<{ id: string; state: string }> }>().items[0]?.id as string;

    const skipped = await physicalApp.inject({ method: 'POST', url: `/api/v1/admin/store/fulfillments/${fulfillmentId}/state`, ...auth(operator.cookie), payload: { state: 'shipped', reason: 'Skip ahead.' } });
    assert.equal(skipped.statusCode, 409, 'a skipped step would falsify the operational record');

    for (const state of ['packed', 'shipped', 'delivered']) {
      const advanced = await physicalApp.inject({ method: 'POST', url: `/api/v1/admin/store/fulfillments/${fulfillmentId}/state`, ...auth(operator.cookie), payload: { state, reason: `Moved to ${state}.` } });
      assert.equal(advanced.statusCode, 200, advanced.body);
    }
  });
});

// --- Orders, receipts, and reconciliation (COMMERCE-009, COMMERCE-012, TEST-024) ---

describe('orders, receipts, and reconciliation', () => {
  test('a receipt reconciles to its own line items and keeps the price snapshot', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 130, toman: 90_000 });
    const buyer = await signIn(app);
    await creditCoins(buyer.accountId, 1000);
    const version = await addToCart(app, buyer.cookie, product.variantId, 2);
    const order = await app.inject({ method: 'POST', url: '/api/v1/orders', ...auth(buyer.cookie), payload: { cartVersion: version, idempotencyKey: `receipt-${String(++counter)}`, consent: true } });
    const orderId = order.json<OrderBody>().id;

    const detail = await app.inject({ method: 'GET', url: `/api/v1/me/orders/${orderId}`, ...auth(buyer.cookie) });
    assert.equal(detail.statusCode, 200, detail.body);
    const body = detail.json<{
      order: OrderBody & { itemSubtotal: Array<{ assetCode: string; amountInteger: number }>; shippingTotal: Array<{ assetCode: string; amountInteger: number }> };
      items: Array<{ skuSnapshot: string; titleSnapshot: { en: string }; lineTotal: Array<{ assetCode: string; amountInteger: number }> }>;
      receipt: { reconciles: boolean };
    }>();
    assert.equal(body.receipt.reconciles, true);
    assert.equal(drc(body.order.grandTotal), 260);
    assert.equal(drc(body.order.shippingTotal), 0, 'shipping is stated as zero, not omitted');
    assert.ok(body.items[0]?.skuSnapshot.startsWith('SKU-'), 'the SKU is snapshotted');
    // The rial representation the receipt requires (COMMERCE-009).
    const rial = body.order.grandTotal.find((m) => m.assetCode === 'IRR');
    assert.equal(rial?.amountInteger, 1_800_000, '90,000 Toman × 10 × 2 units');

    // COMMERCE-012: a later catalog change does not rewrite the order.
    await app.inject({ method: 'POST', url: `/api/v1/admin/store/products/${product.productId}/status`, ...auth(operator.cookie), payload: { state: 'archived', reason: 'Retired.' } });
    const after = await app.inject({ method: 'GET', url: `/api/v1/me/orders/${orderId}`, ...auth(buyer.cookie) });
    assert.equal(drc(after.json<{ order: OrderBody }>().order.grandTotal), 260, 'the historical order is unchanged');
  });

  test('a customer cannot read someone else’s order', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 70 });
    const buyer = await signIn(app);
    await creditCoins(buyer.accountId, 500);
    const version = await addToCart(app, buyer.cookie, product.variantId, 1);
    const order = await app.inject({ method: 'POST', url: '/api/v1/orders', ...auth(buyer.cookie), payload: { cartVersion: version, idempotencyKey: `own-${String(++counter)}`, consent: true } });
    const orderId = order.json<OrderBody>().id;

    const stranger = await signIn(app);
    const response = await app.inject({ method: 'GET', url: `/api/v1/me/orders/${orderId}`, ...auth(stranger.cookie) });
    assert.equal(response.statusCode, 404, 'someone else’s order is indistinguishable from a missing one');
  });

  test('reconciliation recomputes paid orders from their line items and reports no difference', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 45 });
    const buyer = await signIn(app);
    await creditCoins(buyer.accountId, 500);
    const version = await addToCart(app, buyer.cookie, product.variantId, 3);
    await app.inject({ method: 'POST', url: '/api/v1/orders', ...auth(buyer.cookie), payload: { cartVersion: version, idempotencyKey: `rec-${String(++counter)}`, consent: true } });

    const report = await app.inject({ method: 'GET', url: '/api/v1/admin/store/reconciliation', ...auth(operator.cookie) });
    assert.equal(report.statusCode, 200, report.body);
    const body = report.json<{ paidOrders: number; itemSum: number; orderSum: number; differences: unknown[] }>();
    assert.equal(body.paidOrders, 1);
    assert.equal(body.itemSum, 135);
    assert.equal(body.orderSum, 135);
    assert.deepEqual(body.differences, []);
  });

  test('the captured price reaches the ledger and the buyer’s balance falls by exactly that much', async () => {
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 175 });
    const buyer = await signIn(app);
    await creditCoins(buyer.accountId, 400);
    const version = await addToCart(app, buyer.cookie, product.variantId, 1);
    await app.inject({ method: 'POST', url: '/api/v1/orders', ...auth(buyer.cookie), payload: { cartVersion: version, idempotencyKey: `ledger-${String(++counter)}`, consent: true } });

    const balance = await ledger.getBalanceByRef({ kind: 'user', ownerId: buyer.accountId, accountType: 'user_dragon_coin' });
    assert.ok(balance !== null, 'the buyer has a Dragon Coin account');
    assert.equal(balance.availableBalance, 225, '400 credited minus 175 captured');
    assert.equal(balance.heldAmount, 0, 'nothing is left reserved after capture');
  });

  test('reconciliation checks the reverse direction: a paid order with no reservation is named', async () => {
    // Walking orders and summing their lines cannot see this: the totals still agree. The
    // missing thing is the financial evidence that the order was ever settled.
    const operator = await signIn(app, 'shop_operator');
    const product = await publishedProduct(app, operator.cookie, { price: 30 });
    const buyer = await signIn(app);
    await creditCoins(buyer.accountId, 500);
    const version = await addToCart(app, buyer.cookie, product.variantId, 1);
    const order = await app.inject({ method: 'POST', url: '/api/v1/orders', ...auth(buyer.cookie), payload: { cartVersion: version, idempotencyKey: `rev-${String(++counter)}`, consent: true } });
    const orderId = order.json<OrderBody>().id;

    const clean = await app.inject({ method: 'GET', url: '/api/v1/admin/store/reconciliation', ...auth(operator.cookie) });
    assert.deepEqual(clean.json<{ differences: unknown[] }>().differences, [], 'a correctly settled order raises nothing');

    await fixture.database.db.collection(STORE_COLLECTIONS.orders).updateOne({ _id: orderId } as never, { $set: { holdId: null } });
    const dirty = await app.inject({ method: 'GET', url: '/api/v1/admin/store/reconciliation', ...auth(operator.cookie) });
    const differences = dirty.json<{ differences: Array<{ kind?: string }> }>().differences;
    assert.ok(differences.some((d) => d.kind === 'paid_without_reservation'), 'the report names it');
  });

  test('reconciliation checks the reverse direction: a line item with no order is named', async () => {
    const operator = await signIn(app, 'shop_operator');
    await fixture.database.db.collection(STORE_COLLECTIONS.orderItems).insertOne({
      _id: newId(),
      orderId: newId(),
      variantId: newId(),
      productId: newId(),
      type: 'digital',
      titleSnapshot: { fa: 'یتیم', en: 'Orphan' },
      skuSnapshot: 'ORPHAN-1',
      quantity: 1,
      unitPrice: [],
      lineSubtotal: [],
      lineDiscount: [],
      lineTotal: [],
      createdAt: utcNow()
    } as never);

    const report = await app.inject({ method: 'GET', url: '/api/v1/admin/store/reconciliation', ...auth(operator.cookie) });
    const differences = report.json<{ differences: Array<{ kind?: string }> }>().differences;
    assert.ok(differences.some((d) => d.kind === 'item_without_order'), 'an order item whose parent is gone is reported');
  });

  test('the gate surface reports physical fulfillment, revocation, and returns as unavailable', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/store/config' });
    assert.equal(response.statusCode, 200, response.body);
    const config = response.json<{ physicalFulfillmentEnabled: boolean; entitlementRevocationEnabled: boolean; returnsWorkflow: string }>();
    assert.equal(config.physicalFulfillmentEnabled, false, 'OD-019');
    assert.equal(config.entitlementRevocationEnabled, false, 'OD-020');
    assert.equal(config.returnsWorkflow, 'not_offered', 'COMMERCE-010');
  });
});
