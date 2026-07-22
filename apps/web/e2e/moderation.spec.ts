import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Moderation UI journey (DRAGON-14): a signed-in user reports a published tournament;
 * repeating the report collapses into one open case; a moderator sees that case in the
 * queue with its state and severity and no leaked internal identifier; a user without
 * `moderation.manage` is refused the queue. Both locales; server gating is never weakened
 * (the queue is permission-gated server-side and the report route stays session-gated).
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;
const uniqueMobile = (): string => `0912${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const uniqueSuffix = (): string => String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 1000));

const LOCALES = [
  { locale: 'fa', direction: 'rtl', stateOpen: 'باز', severityLow: 'کم' },
  { locale: 'en', direction: 'ltr', stateOpen: 'Open', severityLow: 'Low' }
] as const;

/** OTP sign-in through an API request context, then grant tournament + content roles. */
async function organizerApi(browser: Browser): Promise<APIRequestContext> {
  const api = (await browser.newContext()).request;
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

/** Creates and publishes a free tournament and returns its id + slug. */
async function createPublishedTournament(api: APIRequestContext): Promise<{ id: string; slug: string }> {
  const game = await api.post('/api/v1/admin/games', { data: { slug: `mod-game-${uniqueSuffix()}`, translations: { fa: { name: 'ب', description: 'د' }, en: { name: 'Game', description: 'd' } } } });
  const gameId = ((await game.json()) as { id: string }).id;
  await api.post(`/api/v1/admin/games/${gameId}/status`, { data: { status: 'published', reason: 'go' } });
  const create = await api.post('/api/v1/admin/tournaments', {
    data: {
      gameId,
      translations: { fa: { name: `مسابقه ${uniqueSuffix()}`, summary: 'خ' }, en: { name: `Cup ${uniqueSuffix()}`, summary: 'S' } },
      ruleProfile: { text: { fa: 'ق', en: 'R' } }, capacity: 16, approvalMode: 'automatic',
      registration: { opensAt: '2000-01-01T00:00', closesAt: '2100-01-01T00:00' }, schedule: { startAt: '2100-01-02T00:00', endAt: '2100-01-03T00:00' }
    }
  });
  const created = (await create.json()) as { id: string; slug: string };
  expect((await api.post(`/api/v1/admin/tournaments/${created.id}/transition`, { data: { to: 'published', reason: 'launch' } })).ok()).toBe(true);
  return created;
}

/** Signs in on the page via OTP; optionally grants a role to that account. */
async function signIn(page: Page, locale: 'fa' | 'en', role?: string): Promise<void> {
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
  if (role !== undefined) {
    expect((await page.request.post('/api/v1/dev/grant-role', { data: { mobile, role } })).ok()).toBe(true);
  }
}

async function fileReport(page: Page): Promise<void> {
  await page.getByTestId('report-tournament').click();
  await page.locator('#report-reason').fill('This tournament looks rigged.');
  await page.getByTestId('report-submit').click();
  // Success closes the form and re-offers the report button.
  await expect(page.getByTestId('report-form')).toBeHidden();
  await expect(page.getByTestId('report-tournament')).toBeVisible();
}

for (const { locale, direction, stateOpen, severityLow } of LOCALES) {
  test(`report a tournament, collapse into one case, and a moderator sees it (${locale})`, async ({ page, browser }) => {
    const organizer = await organizerApi(browser);
    const { id, slug } = await createPublishedTournament(organizer);

    // --- Reporter (no moderation rights) ---
    await signIn(page, locale);
    await page.goto(`/${locale}/tournaments/${slug}`);
    await expect(page.locator('html')).toHaveAttribute('dir', direction);
    await expect(page.getByTestId('report-tournament')).toBeVisible();

    await fileReport(page);
    // A second report of the same tournament by the same user must not open a new case.
    await fileReport(page);

    // --- Moderator (separate session with moderation.manage) ---
    const modPage = await (await browser.newContext()).newPage();
    await signIn(modPage, locale, 'community_moderator');
    await modPage.goto(`/${locale}/admin/moderation`);

    await expect(modPage.locator('html')).toHaveAttribute('dir', direction);
    await expect(modPage.getByTestId('moderation-forbidden')).toHaveCount(0);

    // Exactly one queue row references this tournament — the two reports collapsed.
    const row = modPage.getByRole('row', { name: new RegExp(id) });
    await expect(row).toHaveCount(1);
    // Expected state and severity are shown, localized (not raw enum tokens or i18n keys).
    await expect(row).toContainText(stateOpen);
    await expect(row).toContainText(severityLow);

    // No leaked internal identifier: the queue never renders a correlation id, reporter id,
    // or the raw case document id, and no raw translation key leaks.
    const body = await modPage.locator('body').innerText();
    expect(body).not.toMatch(RAW_KEY_PATTERN);
    expect(body.toLowerCase()).not.toContain('correlationid');
    expect(body).not.toContain('reporterId');
  });

  test(`a signed-in user without moderation permission cannot access the queue (${locale})`, async ({ page }) => {
    await signIn(page, locale);
    await page.goto(`/${locale}/admin/moderation`);
    await expect(page.getByTestId('moderation-forbidden')).toBeVisible();
    // The queue table and its data are never rendered for an unpermitted caller.
    await expect(page.getByTestId('state-filter')).toHaveCount(0);
  });
}
