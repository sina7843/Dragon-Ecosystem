import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Paid tournament checkout journey (DRAGON-12, OD-007 gate on in the test env): a
 * participant pays a Toman entry fee through the mock provider and is registered only
 * after the verified callback activates the checkout. Covered in fa RTL and en LTR.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;
function uniqueMobile(): string {
  return `0912${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
}
const uniqueSuffix = (): string => String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 1000));

async function organizerApi(browser: Browser): Promise<APIRequestContext> {
  const context = await browser.newContext();
  const api = context.request;
  const mobile = uniqueMobile();
  await api.post('/api/v1/auth/otp/request', { data: { mobile } });
  const inbox = await api.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await api.post('/api/v1/auth/otp/verify', { data: { mobile, code } });
  for (const role of ['tournament_administrator', 'content_publisher']) {
    expect((await api.post('/api/v1/dev/grant-role', { data: { mobile, role } })).ok()).toBe(true);
  }
  return api;
}

async function createPaidTournament(api: APIRequestContext): Promise<{ id: string; slug: string }> {
  const slug = `pay-game-${uniqueSuffix()}`;
  const game = await api.post('/api/v1/admin/games', { data: { slug, translations: { fa: { name: 'ب', description: 'د' }, en: { name: 'Game', description: 'd' } } } });
  const gameId = ((await game.json()) as { id: string }).id;
  await api.post(`/api/v1/admin/games/${gameId}/status`, { data: { status: 'published', reason: 'go' } });
  const create = await api.post('/api/v1/admin/tournaments', {
    data: {
      gameId,
      translations: { fa: { name: `مسابقهٔ پولی ${uniqueSuffix()}`, summary: 'خ' }, en: { name: `Paid Cup ${uniqueSuffix()}`, summary: 'S' } },
      ruleProfile: { text: { fa: 'ق', en: 'R' } }, capacity: 16, approvalMode: 'automatic',
      eligibility: { requireCompleteProfile: false, requireGameIdentity: false },
      fee: { kind: 'toman', tomanAmount: 100_000 },
      registration: { opensAt: '2000-01-01T00:00', closesAt: '2100-01-01T00:00' }, schedule: { startAt: '2100-01-02T00:00', endAt: '2100-01-03T00:00' }
    }
  });
  const created = (await create.json()) as { id: string; slug: string };
  expect((await api.post(`/api/v1/admin/tournaments/${created.id}/transition`, { data: { to: 'published', reason: 'launch' } })).ok()).toBe(true);
  return created;
}

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

test('a participant pays a Toman entry fee and is registered after the verified callback (en)', async ({ page, browser }) => {
  const organizer = await organizerApi(browser);
  const { slug } = await createPaidTournament(organizer);

  await signIn(page, 'en');
  await page.goto(`/en/tournaments/${slug}`);

  // Start the paid checkout; the registration is not active yet.
  await page.getByTestId('start-checkout').click();
  await expect(page.getByTestId('checkout-state')).toHaveAttribute('data-state', 'awaiting_payment');

  // Complete the mock payment; only the verified callback activates the registration.
  await page.getByTestId('checkout-pay').click();
  await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'approved');

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
});

test('a failed payment does not register the participant (en)', async ({ page, browser }) => {
  const organizer = await organizerApi(browser);
  const { slug } = await createPaidTournament(organizer);
  await signIn(page, 'en');
  await page.goto(`/en/tournaments/${slug}`);
  await page.getByTestId('start-checkout').click();
  await page.getByTestId('checkout-fail').click();
  await expect(page.getByTestId('checkout-state')).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('registration-status')).toHaveCount(0);
});

test('the paid checkout renders RTL and localized in Persian', async ({ page, browser }) => {
  const organizer = await organizerApi(browser);
  const { slug } = await createPaidTournament(organizer);
  await signIn(page, 'fa');
  await page.goto(`/fa/tournaments/${slug}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('start-checkout').click();
  await expect(page.getByTestId('checkout-state')).toHaveAttribute('data-state', 'awaiting_payment');
  await page.getByTestId('checkout-pay').click();
  await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'approved');
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
});
