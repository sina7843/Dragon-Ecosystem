import { expect, test, type Page } from '@playwright/test';
import { uniqueMobile } from './helpers.ts';

/**
 * Dragon Coin wallet journey (DRAGON-11b): a signed-in user buys a package, the
 * purchase is shown as awaiting payment (never successful before the verified
 * callback), the mock payment completes, and the credited balance and history
 * appear. Covered in fa RTL and en LTR. No raw i18n keys leak.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

async function signIn(page: Page, locale: 'fa' | 'en'): Promise<void> {
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
}

test('a user buys Dragon Coin and the verified payment credits the balance (en)', async ({ page }) => {
  await signIn(page, 'en');
  await page.goto('/en/account/wallet');

  // Total, held, and available are shown; a fresh user has zero held (available == total).
  await expect(page.getByTestId('balance-available')).toContainText('0');
  await expect(page.getByTestId('balance-held')).toContainText('0');
  await expect(page.getByTestId('no-holds')).toBeVisible();
  await page.getByTestId('buy-starter').click();

  // The purchase is awaiting payment — success is NOT claimed before the callback.
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'payment_pending');
  await expect(page.getByTestId('purchase-history')).toBeVisible();

  // Complete the mock payment; only now is it verified and credited.
  await page.getByTestId('simulate-success').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'succeeded');
  await expect(page.getByTestId('balance-total')).toContainText('100');
  await expect(page.getByTestId('balance-available')).toContainText('100');
  await expect(page.getByTestId('balance-held')).toContainText('0');
  await expect(page.getByTestId('purchase-history').locator('tr[data-state="succeeded"]')).toHaveCount(1);

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
});

test('a failed mock payment does not credit the balance (en)', async ({ page }) => {
  await signIn(page, 'en');
  await page.goto('/en/account/wallet');
  await page.getByTestId('buy-plus').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'payment_pending');
  await page.getByTestId('simulate-failure').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('balance-available')).toContainText('0');
});

test('the wallet renders RTL and localized in Persian', async ({ page }) => {
  await signIn(page, 'fa');
  await page.goto('/fa/account/wallet');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('packages')).toBeVisible();
  await page.getByTestId('buy-starter').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'payment_pending');
  await page.getByTestId('simulate-success').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'succeeded');
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
});
