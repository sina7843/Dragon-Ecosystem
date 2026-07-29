import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Commerce journey (DRAGON-24, PAGE-037..041, PAGE-056, PAGE-057).
 *
 * The API suite covers pricing, contention, and idempotency exhaustively. These tests
 * prove the browser honours the same boundaries in both locales: totals come from the
 * server, an unavailable variant cannot be added, a physical item cannot be bought while
 * OD-019 is unresolved, and the receipt reconciles to its own line items.
 */

const uniqueMobile = (): string => `0912${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const uniqueSuffix = (): string => String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 1000));
const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

async function apiWithRoles(browser: Browser, roles: string[]): Promise<APIRequestContext> {
  const api = (await browser.newContext()).request;
  const mobile = uniqueMobile();
  await api.post('/api/v1/auth/otp/request', { data: { mobile } });
  const inbox = await api.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await api.post('/api/v1/auth/otp/verify', { data: { mobile, code } });
  for (const role of roles) {
    expect((await api.post('/api/v1/dev/grant-role', { data: { mobile, role } })).ok()).toBe(true);
  }
  return api;
}

async function signIn(page: Page, locale: 'fa' | 'en'): Promise<{ mobile: string }> {
  const mobile = uniqueMobile();
  await page.goto(`/${locale}/auth/mobile`);
  await page.locator('#auth-mobile').fill(mobile);
  await page.getByTestId('request-code').click();
  await expect(page.getByTestId('code-sent')).toBeVisible();
  const inbox = await page.request.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await page.locator('#auth-code').fill(code);
  await page.getByTestId('verify-code').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/account(?:/profile)?$`));
  return { mobile };
}

/**
 * Buys the starter Dragon Coin package through the wallet UI (100 coins), the same path
 * the paid-course journey uses. Every price in this spec fits inside that balance.
 */
async function buyStarterCoins(page: Page, locale: 'fa' | 'en'): Promise<void> {
  await page.goto(`/${locale}/account/wallet`);
  await page.getByTestId('buy-starter').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'payment_pending');
  await page.getByTestId('simulate-success').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'succeeded');
}

interface Published {
  slug: string;
  variantId: string;
  productId: string;
}

async function publishProduct(
  api: APIRequestContext,
  options: { type?: 'physical' | 'digital'; price?: number; stock?: number; toman?: number } = {}
): Promise<Published> {
  const suffix = uniqueSuffix();
  const created = await api.post('/api/v1/admin/store/products', {
    data: {
      slug: `e2e-${suffix}`,
      type: options.type ?? 'digital',
      translations: {
        fa: { title: `کالای ${suffix}`, summary: 'خلاصهٔ کالا', description: 'توضیح کالا' },
        en: { title: `Item ${suffix}`, summary: 'Item summary', description: 'Item description' }
      }
    }
  });
  expect(created.ok()).toBe(true);
  const product = (await created.json()) as { id: string; slug: string };

  const variant = await api.post(`/api/v1/admin/store/products/${product.id}/variants`, {
    data: {
      sku: `E2E-${suffix}`,
      translations: { fa: { name: 'استاندارد' }, en: { name: 'Standard' } },
      price: { dragonCoinAmount: options.price ?? 100, ...(options.toman === undefined ? {} : { tomanAmount: options.toman }) },
      ...(options.type === 'physical' ? { stockOnHand: options.stock ?? 5 } : {})
    }
  });
  expect(variant.ok()).toBe(true);
  const variantId = ((await variant.json()) as { id: string }).id;

  const published = await api.post(`/api/v1/admin/store/products/${product.id}/status`, { data: { state: 'published', reason: 'Launch.' } });
  expect(published.ok()).toBe(true);
  return { slug: product.slug, variantId, productId: product.id };
}

test.describe('storefront', () => {
  for (const locale of ['fa', 'en'] as const) {
    test(`a customer buys a digital product and the receipt reconciles (${locale})`, async ({ page, browser }) => {
      const shop = await apiWithRoles(browser, ['shop_operator']);
      const product = await publishProduct(shop, { price: 40, toman: 25_000 });

      await signIn(page, locale);
      await buyStarterCoins(page, locale);

      await page.goto(`/${locale}/store/products/${product.slug}`);
      await expect(page.getByTestId('store-product-description')).toBeVisible();
      await page.getByTestId('store-quantity').fill('2');
      await page.getByTestId('store-add-to-cart').click();
      await expect(page.getByTestId('store-added')).toBeVisible();

      await page.goto(`/${locale}/cart`);
      // The total is the server's: 2 × 40 Dragon Coin.
      await expect(page.getByTestId('cart-grand-total')).toContainText(/8|۸/);
      await expect(page.getByTestId('cart-shipping')).toBeVisible();
      await page.getByTestId('cart-checkout').click();

      await expect(page).toHaveURL(new RegExp(`/${locale}/checkout$`));
      await expect(page.getByTestId('checkout-submit')).toBeDisabled();
      await page.getByTestId('checkout-consent').check();
      await page.getByTestId('checkout-submit').click();

      await expect(page).toHaveURL(new RegExp(`/${locale}/account/orders`));
      await expect(page.getByTestId('order-receipt')).toBeVisible();
      await expect(page.getByTestId('receipt-reconciles')).toBeVisible();
      await expect(page.getByTestId('receipt-entitlements')).toBeVisible();
      await expect(page.getByTestId('order-state')).not.toHaveText(RAW_KEY_PATTERN);
    });
  }

  test('the catalog distinguishes physical from digital and availability (en)', async ({ page, browser }) => {
    const shop = await apiWithRoles(browser, ['shop_operator']);
    const soldOut = await publishProduct(shop, { type: 'physical', price: 10, stock: 0 });

    await page.goto('/en/store?type=physical');
    const card = page.getByTestId('store-product-card').filter({ hasText: soldOut.slug.replace('e2e-', 'Item ') });
    await expect(card.getByTestId('store-card-type')).toHaveText('Physical');
    await expect(card.getByTestId('store-card-availability')).toHaveText('Sold out');

    // The availability filter agrees with the card it would hide.
    await page.goto('/en/store?type=physical&available=true');
    await expect(page.getByTestId('store-product-card').filter({ hasText: soldOut.slug.replace('e2e-', 'Item ') })).toHaveCount(0);
  });

  test('an out-of-stock variant cannot be added to the cart (en)', async ({ page, browser }) => {
    const shop = await apiWithRoles(browser, ['shop_operator']);
    const product = await publishProduct(shop, { type: 'physical', price: 10, stock: 0 });
    await signIn(page, 'en');
    await page.goto(`/en/store/products/${product.slug}`);
    await expect(page.getByTestId('store-add-to-cart')).toBeDisabled();
  });

  test('a physical item states the domestic limit and cannot be bought while OD-019 is open (fa)', async ({ page, browser }) => {
    const shop = await apiWithRoles(browser, ['shop_operator']);
    const product = await publishProduct(shop, { type: 'physical', price: 10, stock: 5 });

    await page.goto(`/fa/store/products/${product.slug}`);
    await expect(page.getByTestId('store-domestic-notice')).toBeVisible();
    await expect(page.getByTestId('store-not-purchasable')).toBeVisible();
    await expect(page.getByTestId('store-not-purchasable')).not.toHaveText(RAW_KEY_PATTERN);
    await expect(page.getByTestId('store-add-to-cart')).toBeDisabled();
  });

  test('an invalid coupon leaves the total unchanged and says why (en)', async ({ page, browser }) => {
    const shop = await apiWithRoles(browser, ['shop_operator']);
    const product = await publishProduct(shop, { price: 30 });
    await signIn(page, 'en');
    await page.goto(`/en/store/products/${product.slug}`);
    await page.getByTestId('store-add-to-cart').click();
    await expect(page.getByTestId('store-added')).toBeVisible();

    await page.goto('/en/cart');
    const before = await page.getByTestId('cart-grand-total').textContent();
    await page.getByTestId('cart-discount').fill('NOTREAL');
    await page.getByTestId('cart-apply-discount').click();
    await expect(page.getByTestId('cart-discount-problem')).toBeVisible();
    await expect(page.getByTestId('cart-discount-problem')).not.toHaveText(RAW_KEY_PATTERN);
    await expect(page.getByTestId('cart-grand-total')).toHaveText(before ?? '');
  });
});

test.describe('store operations', () => {
  test('a shop operator publishes a product and adjusts stock with a reason (en)', async ({ page }) => {
    const { mobile } = await signIn(page, 'en');
    expect((await page.request.post('/api/v1/dev/grant-role', { data: { mobile, role: 'shop_operator' } })).ok()).toBe(true);

    await page.goto('/en/admin/store');
    await expect(page.getByTestId('admin-store-physical-gate')).toBeVisible();

    const suffix = uniqueSuffix();
    await page.getByTestId('admin-product-title-fa').fill(`کنسولی ${suffix}`);
    await page.getByTestId('admin-product-title-en').fill(`Console ${suffix}`);
    await page.getByTestId('admin-product-sku').fill(`ADM-${suffix}`);
    await page.getByTestId('admin-product-price').fill('75');
    await page.getByTestId('admin-product-create').click();

    await expect(page.getByTestId('admin-store-products')).toContainText(`Console ${suffix}`);
  });

  test('an ordinary user is refused both store consoles (fa)', async ({ page }) => {
    await signIn(page, 'fa');
    await page.goto('/fa/admin/store');
    await expect(page.getByTestId('admin-product-create')).toHaveCount(0);
    await page.goto('/fa/admin/orders');
    await expect(page.getByTestId('admin-orders')).toHaveCount(0);
  });

  test('order operations reports reconciliation over paid orders (en)', async ({ page, browser }) => {
    const shop = await apiWithRoles(browser, ['shop_operator']);
    const product = await publishProduct(shop, { price: 20 });

    // A real purchase, so the reconciliation figure is not vacuously zero.
    const buyerContext = await browser.newContext();
    const buyerPage = await buyerContext.newPage();
    await signIn(buyerPage, 'en');
    await buyStarterCoins(buyerPage, 'en');
    await buyerPage.goto(`/en/store/products/${product.slug}`);
    await buyerPage.getByTestId('store-add-to-cart').click();
    await expect(buyerPage.getByTestId('store-added')).toBeVisible();
    await buyerPage.goto('/en/checkout');
    await buyerPage.getByTestId('checkout-consent').check();
    await buyerPage.getByTestId('checkout-submit').click();
    await expect(buyerPage.getByTestId('order-receipt')).toBeVisible();

    const { mobile } = await signIn(page, 'en');
    expect((await page.request.post('/api/v1/dev/grant-role', { data: { mobile, role: 'shop_operator' } })).ok()).toBe(true);
    await page.goto('/en/admin/orders');
    await expect(page.getByTestId('admin-reconciliation')).toBeVisible();
    await expect(page.getByTestId('admin-reconciliation-result')).toContainText(/match/i);
    await expect(page.getByTestId('admin-orders')).toBeVisible();
    await buyerContext.close();
  });
});

test.describe('store accessibility and bilingual rendering', () => {
  for (const locale of ['fa', 'en'] as const) {
    test(`the storefront has one h1, labelled controls, and no raw i18n keys (${locale})`, async ({ page }) => {
      await page.goto(`/${locale}/store`);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).not.toHaveText(RAW_KEY_PATTERN);

      const search = page.getByTestId('store-search');
      const searchId = await search.getAttribute('id');
      await expect(page.locator(`label[for="${searchId ?? ''}"]`)).toHaveCount(1);

      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    });
  }

  test('the cart table exposes a caption and per-row quantity labels (en)', async ({ page, browser }) => {
    const shop = await apiWithRoles(browser, ['shop_operator']);
    const product = await publishProduct(shop, { price: 15 });
    await signIn(page, 'en');
    await page.goto(`/en/store/products/${product.slug}`);
    await page.getByTestId('store-add-to-cart').click();
    await expect(page.getByTestId('store-added')).toBeVisible();

    await page.goto('/en/cart');
    await expect(page.locator('table caption')).toHaveCount(1);
    await expect(page.getByTestId('cart-quantity')).toHaveAttribute('aria-label', /Quantity for/);
  });
});
