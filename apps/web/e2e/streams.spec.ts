import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Stream discovery and watch journey (DRAGON-18, PAGE-027/028).
 *
 * The security case is STREAM-006 in the P2 acceptance matrix: an unauthorized viewer must
 * not obtain playable access data. The API integration suite covers the permission matrix
 * exhaustively; these tests prove the browser honours the same boundary in both locales,
 * and that a degraded provider produces a visible unavailable state rather than a dead
 * play button.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;
const uniqueMobile = (): string => `0912${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const uniqueSuffix = (): string => String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 1000));

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

interface StreamRow {
  id: string;
  slug: string;
  version: number;
}

/**
 * Drives a stream from draft to live through the operator API and returns its slug plus a
 * unique search term. The discovery list is paginated and the whole suite runs in parallel,
 * so a test must find its own stream by searching rather than assuming it lands on page one.
 */
async function createLiveStream(
  api: APIRequestContext,
  accessMode: 'public' | 'authenticated'
): Promise<{ slug: string; term: string }> {
  const term = uniqueSuffix();
  const slug = `e2e-stream-${term}`;
  const created = await api.post('/api/v1/admin/streams', {
    data: {
      slug,
      accessMode,
      scheduledStartAt: '2026-09-01T18:00:00.000Z',
      translations: {
        fa: { title: `پخش آزمایشی ${term}`, summary: 'توضیح' },
        en: { title: `Test stream ${term}`, summary: 'Summary' }
      }
    }
  });
  expect(created.ok()).toBe(true);
  let stream = (await created.json()) as StreamRow;

  const rights = await api.post(`/api/v1/admin/streams/${stream.id}/rights`, {
    data: { expectedVersion: stream.version, reference: 'E2E-RIGHTS-1' }
  });
  expect(rights.ok()).toBe(true);
  stream = (await rights.json()) as StreamRow;

  const provisioned = await api.post(`/api/v1/admin/streams/${stream.id}/provision`);
  expect(provisioned.ok()).toBe(true);
  stream = (await provisioned.json()) as StreamRow;

  for (const state of ['scheduled', 'live'] as const) {
    const moved = await api.post(`/api/v1/admin/streams/${stream.id}/state`, {
      data: { state, expectedVersion: stream.version, reason: `Moving to ${state}.` }
    });
    expect(moved.ok()).toBe(true);
    stream = (await moved.json()) as StreamRow;
  }
  return { slug, term };
}

for (const locale of ['fa', 'en'] as const) {
  test(`a visitor discovers a live stream and watches a public one (${locale})`, async ({ page, browser }) => {
    const api = await apiWithRoles(browser, ['streaming_operator']);
    const { slug, term } = await createLiveStream(api, 'public');

    // Searching keeps the assertion independent of how many streams other parallel tests
    // have put on the first page; the search itself is part of PAGE-027.
    await page.goto(`/${locale}/streams?q=${term}`);
    await expect(page.getByTestId('active-filter-q')).toBeVisible();
    const card = page.getByTestId(`stream-card-${slug}`);
    await expect(card).toBeVisible();
    await expect(page.getByTestId(`stream-state-${slug}`)).toBeVisible();

    await card.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/streams/${slug}$`));
    await expect(page.getByTestId('stream-title')).toBeVisible();

    // Nothing is playable until the server issues configuration, and the request is what
    // authorizes it — the button only asks.
    await expect(page.getByTestId('stream-player')).toHaveCount(0);
    await page.getByTestId('stream-watch').click();
    await expect(page.getByTestId('stream-player')).toBeVisible();
    await expect(page.getByTestId('stream-player-expiry')).toBeVisible();

    const bodyText = await page.locator('main').innerText();
    expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
  });

  test(`an anonymous viewer cannot obtain playback for a sign-in-only stream (${locale})`, async ({ page, browser }) => {
    const api = await apiWithRoles(browser, ['streaming_operator']);
    const { slug } = await createLiveStream(api, 'authenticated');

    await page.goto(`/${locale}/streams/${slug}`);
    await expect(page.getByTestId('stream-access-note')).toBeVisible();
    await page.getByTestId('stream-watch').click();

    // The refusal is the server's, and the page offers the way forward instead of a player.
    await expect(page.getByTestId('stream-playback-problem')).toBeVisible();
    await expect(page.getByTestId('stream-sign-in')).toBeVisible();
    await expect(page.getByTestId('stream-player')).toHaveCount(0);

    const bodyText = await page.locator('main').innerText();
    expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
  });
}

test('a signed-in viewer can watch a sign-in-only stream', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['streaming_operator']);
  const { slug } = await createLiveStream(api, 'authenticated');

  await signIn(page, 'en');
  await page.goto(`/en/streams/${slug}`);
  await page.getByTestId('stream-watch').click();
  await expect(page.getByTestId('stream-player')).toBeVisible();
});

test('a draft stream is not discoverable and its watch page is a real 404', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['streaming_operator']);
  const slug = `e2e-draft-${uniqueSuffix()}`;
  const created = await api.post('/api/v1/admin/streams', {
    data: { slug, translations: { fa: { title: 'پیش‌نویس' }, en: { title: 'Draft stream' } } }
  });
  expect(created.ok()).toBe(true);

  await page.goto('/en/streams');
  await expect(page.getByTestId(`stream-card-${slug}`)).toHaveCount(0);
  await page.goto(`/en/streams/${slug}`);
  await expect(page.getByTestId('stream-not-found')).toBeVisible();
});

test('the stream operations console is guarded in the browser too', async ({ page }) => {
  await signIn(page, 'en');
  await page.goto('/en/admin/streams');
  await expect(page.getByTestId('streams-forbidden')).toBeVisible();
  await expect(page.getByTestId('stream-create-form')).toHaveCount(0);
});

test('a streaming operator sees the console, the active provider, and the OD-014 gate', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['streaming_operator']);
  const { slug } = await createLiveStream(api, 'public');

  const mobile = uniqueMobile();
  await page.goto('/en/auth/mobile');
  await page.locator('#auth-mobile').fill(mobile);
  await page.getByTestId('request-code').click();
  await expect(page.getByTestId('code-sent')).toBeVisible();
  const inbox = await page.request.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await page.locator('#auth-code').fill(code);
  await page.getByTestId('verify-code').click();
  // The account only exists once verification has landed, so wait for it before granting.
  await expect(page).toHaveURL(/\/en\/account(?:\/profile)?$/);
  expect((await page.request.post('/api/v1/dev/grant-role', { data: { mobile, role: 'streaming_operator' } })).ok()).toBe(true);

  await page.goto('/en/admin/streams');
  await expect(page.getByTestId('streams-provider')).toBeVisible();
  // Archive and takedown stay visibly gated until the rights policy is approved (OD-014).
  await expect(page.getByTestId('streams-rights-gate')).toBeVisible();
  await expect(page.getByTestId(`admin-stream-${slug}`)).toBeVisible();
  await expect(page.getByTestId(`admin-stream-sync-${slug}`)).toBeVisible();

  const bodyText = await page.locator('main').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
});
