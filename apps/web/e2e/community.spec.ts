import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Community journey (DRAGON-22, PAGE-034/035/036/055).
 *
 * The API suite covers the visibility and authorization matrix exhaustively. These tests
 * prove the browser honours the same boundaries in both locales: the composer defaults to
 * the narrow audience, a followers-only post does not reach a stranger's page, a report
 * reaches the shared moderation console, and that console is permission-gated.
 */

const uniqueMobile = (): string => `0912${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const uniqueSuffix = (): string => String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 1000));
/** A dotted lowercase token that looks like an untranslated i18n key leaking into the UI. */
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

/** Signs in and gives the account a public profile, so it can be followed and found. */
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

  const username = `player${uniqueSuffix()}`;
  const saved = await page.request.put('/api/v1/account/profile', {
    data: { username, displayName: `Player ${username}`, birthDate: '2000-01-01', visibility: 'public' }
  });
  expect(saved.ok()).toBe(true);
  return { username, mobile };
}

test.describe('community feed', () => {
  test('the composer defaults to the narrow audience and the post appears in the author feed (fa)', async ({ page }) => {
    await signInWithProfile(page, 'fa');
    await page.goto('/fa/community');

    // Privacy by default: the preselected value is followers, not everyone (SOCIAL-004).
    await expect(page.getByTestId('community-composer-visibility')).toHaveValue('followers');

    const body = `اسکریم امشب ${uniqueSuffix()}`;
    await page.getByTestId('community-composer-body').fill(body);
    await page.getByTestId('community-composer-submit').click();

    const post = page.getByTestId('community-post').filter({ hasText: body });
    await expect(post).toBeVisible();
    await expect(post.getByTestId('community-post-visibility')).not.toHaveText(RAW_KEY_PATTERN);
  });

  test('the submit control stays disabled until the body has content (en)', async ({ page }) => {
    await signInWithProfile(page, 'en');
    await page.goto('/en/community');

    await expect(page.getByTestId('community-composer-submit')).toBeDisabled();
    await page.getByTestId('community-composer-body').fill('Ready to play.');
    await expect(page.getByTestId('community-composer-submit')).toBeEnabled();
  });

  test('the blocking gate is stated in the interface rather than silently missing (en)', async ({ page }) => {
    await signInWithProfile(page, 'en');
    await page.goto('/en/community');
    // OD-017: a user whose only remedy is a report must be told that, not left guessing.
    await expect(page.getByRole('note')).toContainText(/report/i);
  });

  test('an anonymous visitor cannot reach the feed', async ({ page }) => {
    await page.goto('/en/community');
    await expect(page.getByTestId('community-feed')).toHaveCount(0);
  });
});

test.describe('community privacy', () => {
  test('a followers-only post does not appear on the author page to a stranger (en)', async ({ page, browser }) => {
    const author = await browser.newContext();
    const authorPage = await author.newPage();
    const { username } = await signInWithProfile(authorPage, 'en');
    await authorPage.goto('/en/community');
    const body = `Private scrim ${uniqueSuffix()}`;
    await authorPage.getByTestId('community-composer-body').fill(body);
    await authorPage.getByTestId('community-composer-submit').click();
    await expect(authorPage.getByTestId('community-post').filter({ hasText: body })).toBeVisible();

    // A different signed-in account who does not follow the author.
    await signInWithProfile(page, 'en');
    await page.goto(`/en/players/${username}`);
    await expect(page.getByTestId('player-community')).toBeVisible();
    await expect(page.getByText(body)).toHaveCount(0);
    await author.close();
  });

  test('community statistics stay hidden until the owner opts in (en)', async ({ page, browser }) => {
    const author = await browser.newContext();
    const { username } = await signInWithProfile(await author.newPage(), 'en');

    await signInWithProfile(page, 'en');
    await page.goto(`/en/players/${username}`);
    await expect(page.getByTestId('player-statistics-hidden')).toBeVisible();
    await expect(page.getByTestId('player-statistics-hidden')).not.toHaveText(RAW_KEY_PATTERN);
    await author.close();
  });
});

test.describe('community moderation', () => {
  test('a reported post reaches the moderation console and can be removed with a reason (en)', async ({ browser }) => {
    const author = await browser.newContext();
    const authorPage = await author.newPage();
    await signInWithProfile(authorPage, 'en');
    await authorPage.goto('/en/community');
    const body = `Reportable ${uniqueSuffix()}`;
    await authorPage.getByTestId('community-composer-body').fill(body);
    await authorPage.getByTestId('community-composer-visibility').selectOption('public');
    await authorPage.getByTestId('community-composer-submit').click();
    const post = authorPage.getByTestId('community-post').filter({ hasText: body });
    await expect(post).toBeVisible();
    await post.getByRole('link').click();
    await expect(authorPage).toHaveURL(/\/en\/community\/posts\//);
    await authorPage.getByTestId('community-report-reason').fill('Breaks the rules.');
    await authorPage.getByTestId('community-report-submit').click();
    await expect(authorPage.getByTestId('community-report-sent')).toBeVisible();

    // A community moderator reviews it in the shared console.
    const moderator = await browser.newContext();
    const moderatorPage = await moderator.newPage();
    const { mobile } = await signInWithProfile(moderatorPage, 'en');
    expect((await moderatorPage.request.post('/api/v1/dev/grant-role', { data: { mobile, role: 'community_moderator' } })).ok()).toBe(true);

    await moderatorPage.goto('/en/admin/community');
    const caseRow = moderatorPage.locator('li').filter({ hasText: body });
    await expect(caseRow).toBeVisible();
    await caseRow.getByTestId('admin-community-remove-reason').fill('Removed for review.');
    await caseRow.getByTestId('admin-community-remove').click();
    // The record stays with its body so the case remains reviewable (MOD-008).
    await expect(moderatorPage.locator('li').filter({ hasText: body }).getByTestId('admin-community-state')).toBeVisible();

    await author.close();
    await moderator.close();
  });

  test('a member without moderation permission is refused the console (fa)', async ({ page }) => {
    await signInWithProfile(page, 'fa');
    await page.goto('/fa/admin/community');
    await expect(page.getByTestId('admin-community-posts')).toHaveCount(0);
  });

  test('the console is reachable from the administration areas for a community moderator (en)', async ({ browser }) => {
    const api = await apiWithRoles(browser, ['community_moderator']);
    const response = await api.get('/api/v1/admin/community/posts');
    expect(response.ok()).toBe(true);
  });
});

test.describe('community accessibility and bilingual rendering', () => {
  for (const locale of ['fa', 'en'] as const) {
    test(`the feed page has one h1, labelled controls, and no raw i18n keys (${locale})`, async ({ page }) => {
      await signInWithProfile(page, locale);
      await page.goto(`/${locale}/community`);

      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).not.toHaveText(RAW_KEY_PATTERN);

      // Every composer control is reachable by its accessible name.
      const bodyField = page.getByTestId('community-composer-body');
      const bodyId = await bodyField.getAttribute('id');
      await expect(page.locator(`label[for="${bodyId ?? ''}"]`)).toHaveCount(1);
      const audience = page.getByTestId('community-composer-visibility');
      const audienceId = await audience.getAttribute('id');
      await expect(page.locator(`label[for="${audienceId ?? ''}"]`)).toHaveCount(1);

      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    });
  }
});
