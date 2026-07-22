import { expect, test, type Page } from '@playwright/test';

/**
 * In-app notification journey (DRAGON-13): a user action emits a domain event, the
 * operator consume pass turns it into an inbox notification, and the user reads it.
 * Covered in fa RTL and en LTR. No raw i18n keys or recipient detail leak.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;
function uniqueMobile(): string {
  return `0912${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
}

async function signIn(page: Page, locale: 'fa' | 'en'): Promise<string> {
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
  return mobile;
}

/** Buy Dragon Coin (emits a domain event), then run the operator consume pass. */
async function buyCoinsAndConsume(page: Page, locale: 'fa' | 'en', mobile: string): Promise<void> {
  await page.goto(`/${locale}/account/wallet`);
  await page.getByTestId('buy-starter').click();
  await page.getByTestId('simulate-success').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'succeeded');
  // Grant this session the support/operator permission and drain the outbox (the
  // shared E2E database accumulates pending events; process oldest-first until empty).
  expect((await page.request.post('/api/v1/dev/grant-role', { data: { mobile, role: 'support_operator' } })).ok()).toBe(true);
  for (let i = 0; i < 40; i += 1) {
    const response = await page.request.post('/api/v1/admin/notifications/process', { data: { limit: 200 } });
    expect(response.ok()).toBe(true);
    if (((await response.json()) as { consumed: { processed: number } }).consumed.processed === 0) break;
  }
}

test('a purchase produces an in-app notification the user can read (en)', async ({ page }) => {
  const mobile = await signIn(page, 'en');
  await buyCoinsAndConsume(page, 'en', mobile);

  await page.goto('/en/account/notifications');
  await expect(page.getByTestId('notification-list')).toBeVisible();
  const first = page.getByTestId('notification-list').locator('li').first();
  await expect(first).toContainText('Dragon Coin');
  await expect(first).toHaveAttribute('data-read', 'unread');

  await page.getByTestId('mark-all-read').click();
  await expect(first).toHaveAttribute('data-read', 'read');

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
});

test('the notifications inbox renders RTL and localized in Persian', async ({ page }) => {
  const mobile = await signIn(page, 'fa');
  await buyCoinsAndConsume(page, 'fa', mobile);
  await page.goto('/fa/account/notifications');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('notification-list')).toBeVisible();
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
});

test('a signed-in user with no notifications sees the empty state (en)', async ({ page }) => {
  await signIn(page, 'en');
  await page.goto('/en/account/notifications');
  await expect(page.getByTestId('no-notifications')).toBeVisible();
});
