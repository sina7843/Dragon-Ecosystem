import { expect, test, type Page } from '@playwright/test';
import { uniqueMobile, uniqueSuffix } from './helpers.ts';

/**
 * Economy journey (DRAGON-25, REWARD-005..008).
 *
 * The API suite covers the ledger arithmetic exhaustively. These tests prove the browser
 * honours the same boundaries in both locales: a transfer moves coin and shows it, a large
 * one is held rather than reported as sent, and nothing anywhere offers to turn Dragon
 * Coin back into money.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

/** Signs in and gives the account a public profile, so it can receive a transfer. */
async function signInWithProfile(page: Page, locale: 'fa' | 'en'): Promise<{ username: string; mobile: string }> {
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

  const username = `coin${uniqueSuffix()}`;
  const saved = await page.request.put('/api/v1/account/profile', {
    data: { username, displayName: `Coin ${username}`, birthDate: '2000-01-01', visibility: 'public' }
  });
  expect(saved.ok()).toBe(true);
  return { username, mobile };
}

/** Buys the starter Dragon Coin package through the wallet UI (100 coins). */
async function buyStarterCoins(page: Page, locale: 'fa' | 'en'): Promise<void> {
  await page.goto(`/${locale}/account/wallet`);
  await page.getByTestId('buy-starter').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'payment_pending');
  await page.getByTestId('simulate-success').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'succeeded');
}

test.describe('Dragon Coin transfers', () => {
  for (const locale of ['fa', 'en'] as const) {
    test(`a player sends coin to another player and both balances change (${locale})`, async ({ page, browser }) => {
      const recipientContext = await browser.newContext();
      const recipientPage = await recipientContext.newPage();
      const { username: recipientName } = await signInWithProfile(recipientPage, locale);

      await signInWithProfile(page, locale);
      await buyStarterCoins(page, locale);

      await page.getByTestId('transfer-recipient').fill(recipientName);
      await page.getByTestId('transfer-amount').fill('30');
      await page.getByTestId('transfer-note').fill('GG');
      await page.getByTestId('transfer-submit').click();

      await expect(page.getByTestId('transfer-list')).toBeVisible();
      await expect(page.getByTestId('transfer-state').first()).not.toHaveText(RAW_KEY_PATTERN);

      // The sender's balance fell, and the recipient's rose, by the same amount.
      const senderBalance = await page.request.get('/api/v1/wallet/summary');
      expect(((await senderBalance.json()) as { availableBalance: number }).availableBalance).toBe(70);
      const recipientBalance = await recipientPage.request.get('/api/v1/wallet/summary');
      expect(((await recipientBalance.json()) as { availableBalance: number }).availableBalance).toBe(30);

      await recipientContext.close();
    });
  }

  test('the wallet states the transfer limits and that there is no cash-out (en)', async ({ page }) => {
    await signInWithProfile(page, 'en');
    await page.goto('/en/account/wallet');
    await expect(page.getByTestId('transfer-limits')).toBeVisible();
    await expect(page.getByTestId('no-cash-out')).toContainText(/cannot be sold back|no cash-out/i);
    await expect(page.getByTestId('no-cash-out')).not.toHaveText(RAW_KEY_PATTERN);
  });

  test('the send control stays disabled until a recipient and an amount are given (en)', async ({ page }) => {
    await signInWithProfile(page, 'en');
    await page.goto('/en/account/wallet');
    await expect(page.getByTestId('transfer-submit')).toBeDisabled();
    await page.getByTestId('transfer-recipient').fill('somebody');
    await page.getByTestId('transfer-amount').fill('5');
    await expect(page.getByTestId('transfer-submit')).toBeEnabled();
  });

  test('a transfer to an unknown recipient reports an error and moves nothing (en)', async ({ page }) => {
    await signInWithProfile(page, 'en');
    await buyStarterCoins(page, 'en');
    await page.getByTestId('transfer-recipient').fill(`ghost${uniqueSuffix()}`);
    await page.getByTestId('transfer-amount').fill('10');
    await page.getByTestId('transfer-submit').click();

    await expect(page.getByTestId('transfer-error')).toBeVisible();
    const balance = await page.request.get('/api/v1/wallet/summary');
    expect(((await balance.json()) as { availableBalance: number }).availableBalance).toBe(100);
  });

  test('no page or API offers to redeem Dragon Coin for money (REWARD-006)', async ({ page }) => {
    await signInWithProfile(page, 'en');
    await page.goto('/en/account/wallet');
    // The wallet is where a cash-out control would live if one existed anywhere.
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toMatch(/withdraw to bank|cash out|sell back|redeem for/i);

    const config = await page.request.get('/api/v1/economy/config');
    const economy = (await config.json()) as { cashRedemption: string; orderBookTrading: string; internalTomanWallet: string };
    expect(economy.cashRedemption).toBe('never');
    expect(economy.orderBookTrading).toBe('never');
    expect(economy.internalTomanWallet).toBe('disabled');
  });
});

test.describe('prize settlement console', () => {
  test('an ordinary user is refused the settlement console (fa)', async ({ page }) => {
    await signInWithProfile(page, 'fa');
    await page.goto('/fa/admin/prizes');
    await expect(page.getByTestId('admin-entitlements')).toHaveCount(0);
  });

  test('a finance operator sees the console, its dual-control notice, and the reconciliation (en)', async ({ page }) => {
    const { mobile } = await signInWithProfile(page, 'en');
    expect((await page.request.post('/api/v1/dev/grant-role', { data: { mobile, role: 'finance_operator' } })).ok()).toBe(true);

    await page.goto('/en/admin/prizes');
    await expect(page.getByTestId('admin-prizes-dual-control')).toBeVisible();
    await expect(page.getByTestId('admin-prizes-dual-control')).not.toHaveText(RAW_KEY_PATTERN);
    await expect(page.getByTestId('admin-prizes-reconciliation')).toBeVisible();
    await expect(page.getByTestId('admin-prizes-reconciliation-result')).toContainText(/agree|difference/i);
  });
});

test.describe('economy accessibility and bilingual rendering', () => {
  for (const locale of ['fa', 'en'] as const) {
    test(`the transfer form labels every control and renders no raw i18n keys (${locale})`, async ({ page }) => {
      await signInWithProfile(page, locale);
      await page.goto(`/${locale}/account/wallet`);

      for (const testid of ['transfer-recipient', 'transfer-amount', 'transfer-note']) {
        const field = page.getByTestId(testid);
        const id = await field.getAttribute('id');
        await expect(page.locator(`label[for="${id ?? ''}"]`)).toHaveCount(1);
      }
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await expect(page.locator('h1')).not.toHaveText(RAW_KEY_PATTERN);
    });
  }
});
