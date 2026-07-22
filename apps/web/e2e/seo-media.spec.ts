import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';

/**
 * SEO + media journey (DRAGON-15): robots.txt is environment-aware (SEO-006, the test
 * API is nonproduction so it disallows crawling), the sitemap lists published resources
 * with locale alternates (SEO-005), an unknown route shows the localized 404 view with
 * navigation (SEO-010, useful localized navigation), and media is validated + served only
 * once published (MEDIA-002/003/007). Uses the dev role-grant + mock OTP helpers.
 */

const uniqueMobile = (): string => `0912${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const uniqueSuffix = (): string => String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 1000));
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A valid-signature PNG with unique trailing bytes so content-addressed dedup does not
 * collapse this upload into an asset another parallel project already published. */
function uniquePng(): string {
  const tail = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
  return Buffer.from([...PNG_HEADER, ...tail]).toString('base64');
}
/** A valid-signature PNG of `rawBytes` size, with a unique random tail so it never dedups. */
function pngOfSize(rawBytes: number): string {
  const body = Buffer.alloc(Math.max(0, rawBytes - PNG_HEADER.length));
  for (let i = 0; i < 8; i += 1) body[i] = Math.floor(Math.random() * 256);
  return Buffer.concat([Buffer.from(PNG_HEADER), body]).toString('base64');
}

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

async function createPublishedTournament(api: APIRequestContext): Promise<{ slug: string }> {
  const game = await api.post('/api/v1/admin/games', { data: { slug: `seo-game-${uniqueSuffix()}`, translations: { fa: { name: 'ب', description: 'د' }, en: { name: 'Game', description: 'd' } } } });
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

test('robots.txt disallows crawling in a nonproduction environment (SEO-006)', async ({ page }) => {
  const res = await page.request.get('/robots.txt');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('text/plain');
  expect(await res.text()).toContain('Disallow: /');
});

test('sitemap.xml lists a published tournament with locale alternates (SEO-005)', async ({ page, browser }) => {
  const organizer = await apiWithRoles(browser, ['tournament_administrator', 'content_publisher']);
  const { slug } = await createPublishedTournament(organizer);

  const res = await page.request.get('/sitemap.xml');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('xml');
  const xml = await res.text();
  expect(xml).toContain('<urlset');
  expect(xml).toContain(`/fa/tournaments/${slug}`);
  expect(xml).toContain(`/en/tournaments/${slug}`);
  expect(xml).toContain('hreflang="en"');
});

for (const locale of ['fa', 'en'] as const) {
  test(`an unknown route shows the localized 404 view with navigation (${locale})`, async ({ page }) => {
    // Establish the locale first (the catch-all 404 route carries no locale param, so it
    // renders in the active locale), then hit an unknown path under it.
    await page.goto(`/${locale}`);
    await page.goto(`/${locale}/this-route-does-not-exist-${uniqueSuffix()}`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    // A localized heading renders (not the raw i18n key).
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    expect((await heading.innerText()).trim()).not.toBe('state.notFound.heading');
    // Useful localized navigation: a link back into the localized app is present.
    await expect(page.getByRole('link', { name: /.+/ }).first()).toBeVisible();
  });
}

test('media is validated, stays nonpublic until published, then is served (MEDIA-002/003/007)', async ({ browser, request }) => {
  const publisher = await apiWithRoles(browser, ['content_publisher']);

  // A non-image is rejected by content signature (MEDIA-002).
  const bad = await publisher.post('/api/v1/admin/media', { data: { data: Buffer.from('not an image').toString('base64') } });
  expect(bad.status()).toBe(422);

  // A valid PNG is accepted and staged (nonpublic).
  const upload = await publisher.post('/api/v1/admin/media', { data: { data: uniquePng(), alt: { en: 'A dragon', fa: 'اژدها' } } });
  expect(upload.status()).toBe(201);
  const asset = (await upload.json()) as { id: string; state: string; url: string; version: number };
  expect(asset.state).toBe('staged');

  // Not served publicly while staged (MEDIA-003).
  expect((await request.get(asset.url)).status()).toBe(404);

  // Publish, then it is served with its real content-type and immutable cache headers (MEDIA-007).
  const published = await publisher.post(`/api/v1/admin/media/${asset.id}/publish`, { data: { expectedVersion: asset.version } });
  expect(published.ok()).toBe(true);
  const served = await request.get(asset.url);
  expect(served.ok()).toBe(true);
  expect(served.headers()['content-type']).toBe('image/png');
  expect(served.headers()['cache-control']).toContain('immutable');
  const etag = served.headers()['etag'] ?? '';
  expect(etag).toBeTruthy();

  // Conditional request with the matching validator returns 304 without re-transferring bytes.
  const revalidated = await request.get(asset.url, { headers: { 'if-none-match': etag } });
  expect(revalidated.status()).toBe(304);
  expect((await revalidated.body()).length).toBe(0);

  // An anonymous caller cannot upload (authorization, MEDIA-006).
  expect((await request.post('/api/v1/admin/media', { data: { data: uniquePng() } })).status()).toBe(401);

  // A ~900KB image (base64 > the default 1MB Fastify body limit) is accepted: the upload
  // route's body limit is derived from MEDIA_MAX_BYTES, so the configured cap is reachable.
  const big = await publisher.post('/api/v1/admin/media', { data: { data: pngOfSize(900_000) } });
  expect(big.status()).toBe(201);
});
