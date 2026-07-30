import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { actAndAwaitApi, uniqueMobile, uniqueSuffix } from './helpers.ts';

/**
 * The participant's own registrations and matches (PAGE-017, PAGE-018).
 *
 * These are the two surfaces where a participant reads their own record, so the assertions
 * that matter most are the ones about what is *not* there: another account's entries, a
 * staff reason, or a dead link to a tournament that has gone.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

/** Signs a fresh account in through the UI and completes the profile eligibility needs. */
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
  const saved = await page.request.put('/api/v1/account/profile', {
    data: { username: `pt_${uniqueSuffix()}`, displayName: `Player ${uniqueSuffix()}`, birthDate: '2000-01-01', visibility: 'public' }
  });
  expect(saved.ok()).toBe(true);
}

/** An API context holding the given roles, for setting up tournaments as an organizer. */
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

/** A published free tournament open for registration. */
async function publishedTournament(api: APIRequestContext): Promise<{ id: string; slug: string }> {
  const gameSlug = `pt-game-${uniqueSuffix()}`;
  const game = await api.post('/api/v1/admin/games', {
    data: { slug: gameSlug, translations: { fa: { name: 'ب', description: 'د' }, en: { name: 'Game', description: 'd' } } }
  });
  expect(game.ok()).toBe(true);
  const gameId = ((await game.json()) as { id: string }).id;
  expect((await api.post(`/api/v1/admin/games/${gameId}/status`, { data: { status: 'published', reason: 'go' } })).ok()).toBe(true);

  const created = await api.post('/api/v1/admin/tournaments', {
    data: {
      gameId,
      translations: { fa: { name: `تورنمنت ${uniqueSuffix()}`, summary: 'خ' }, en: { name: `Cup ${uniqueSuffix()}`, summary: 'Summary' } },
      ruleProfile: { text: { fa: 'قوانین', en: 'Rules' } },
      capacity: 16,
      approvalMode: 'automatic',
      registration: { opensAt: '2000-01-01T00:00', closesAt: '2100-01-01T00:00' },
      schedule: { startAt: '2100-01-02T00:00', endAt: '2100-01-03T00:00' }
    }
  });
  expect(created.ok()).toBe(true);
  const tournament = (await created.json()) as { id: string; slug: string };
  expect((await api.post(`/api/v1/admin/tournaments/${tournament.id}/transition`, { data: { to: 'published', reason: 'launch' } })).ok()).toBe(true);
  return tournament;
}

/** Registers the signed-in page's account for a tournament through its public UI. */
async function enter(page: Page, locale: 'fa' | 'en', slug: string): Promise<void> {
  await page.goto(`/${locale}/tournaments/${slug}`);
  await page.getByTestId('open-register-form').click();
  await expect(page.getByTestId('register-form')).toBeVisible();
  await actAndAwaitApi(page, 'POST', /^\/api\/v1\/tournaments\/[^/]+\/registration$/, async () => {
    await page.getByTestId('register').click();
  });
  await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'approved');
}

test.describe('PAGE-017 account registrations', () => {
  for (const locale of ['fa', 'en'] as const) {
    test(`an account with no entries sees the empty state (${locale})`, async ({ page }) => {
      await signIn(page, locale);
      await page.goto(`/${locale}/account/registrations`);
      await expect(page.getByTestId('state-empty')).toBeVisible();
      await expect(page.getByTestId('my-registrations')).toHaveCount(0);
      await expect(page.locator('h1')).toHaveCount(1);
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(RAW_KEY_PATTERN);
    });
  }

  for (const locale of ['fa', 'en'] as const) {
    test(`a registration is listed with its status and history (${locale})`, async ({ page, browser }) => {
      const api = await apiWithRoles(browser, ['tournament_administrator', 'content_publisher']);
      const { slug } = await publishedTournament(api);
      await signIn(page, locale);
      await enter(page, locale, slug);

      await page.goto(`/${locale}/account/registrations`);
      const entry = page.getByTestId('my-registration');
      await expect(entry).toHaveCount(1);
      await expect(entry.getByTestId('registration-state')).toHaveAttribute('data-state', 'approved');
      await expect(entry.getByTestId('registration-tournament')).toHaveAttribute('href', new RegExp(slug));

      // The history is a real sequence, not a single current-state row.
      await entry.getByTestId('registration-history-toggle').click();
      await expect(page.getByTestId('registration-history')).toBeVisible();
      await expect(page.getByTestId('registration-history-entry').first()).toBeVisible();

      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(RAW_KEY_PATTERN);
    });
  }

  test('the history toggle is reachable and operable from the keyboard (en)', async ({ page, browser }) => {
    const api = await apiWithRoles(browser, ['tournament_administrator', 'content_publisher']);
    const { slug } = await publishedTournament(api);
    await signIn(page, 'en');
    await enter(page, 'en', slug);
    await page.goto('/en/account/registrations');

    const toggle = page.getByTestId('registration-history-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('registration-history')).toBeVisible();
  });

  test('an anonymous visitor is not shown another account’s registrations (en)', async ({ page }) => {
    await page.goto('/en/account/registrations');
    // The account shell offers sign-in rather than someone else's record.
    await expect(page.getByTestId('my-registration')).toHaveCount(0);
  });

  test('the page does not scroll horizontally at the 320px floor (en)', async ({ page, browser }) => {
    const api = await apiWithRoles(browser, ['tournament_administrator', 'content_publisher']);
    const { slug } = await publishedTournament(api);
    await signIn(page, 'en');
    await enter(page, 'en', slug);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/en/account/registrations');
    await expect(page.getByTestId('my-registration')).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('PAGE-018 account matches', () => {
  for (const locale of ['fa', 'en'] as const) {
    test(`an account with no fixtures sees the empty state (${locale})`, async ({ page }) => {
      await signIn(page, locale);
      await page.goto(`/${locale}/account/matches`);
      await expect(page.getByTestId('state-empty')).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(RAW_KEY_PATTERN);
    });
  }

  test('an entered tournament with a generated bracket shows an unscheduled fixture (en)', async ({ page, browser }) => {
    const api = await apiWithRoles(browser, ['tournament_administrator', 'content_publisher']);
    const { id, slug } = await publishedTournament(api);
    await signIn(page, 'en');
    await enter(page, 'en', slug);

    // A second entrant, so the bracket has a real fixture rather than a bye.
    const opponent = await browser.newContext();
    const opponentPage = await opponent.newPage();
    await signIn(opponentPage, 'en');
    await enter(opponentPage, 'en', slug);

    expect((await api.post(`/api/v1/admin/tournaments/${id}/competition`, { data: {} })).ok()).toBe(true);

    await page.goto('/en/account/matches');
    await expect(page.getByTestId('my-match')).toHaveCount(1);
    // Generation never invents a time (TOURN-019), so the fixture reads as unscheduled.
    await expect(page.getByTestId('match-unscheduled')).toBeVisible();
    await expect(page.getByTestId('match-rescheduled')).toHaveCount(0);
    await expect(page.getByTestId('match-tournament')).toHaveAttribute('href', new RegExp(slug));

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(RAW_KEY_PATTERN);
    await opponent.close();
  });

  for (const locale of ['fa', 'en'] as const) {
    test(`a rescheduled fixture shows its time and is marked as changed (${locale})`, async ({ page, browser }) => {
      const api = await apiWithRoles(browser, ['tournament_administrator', 'content_publisher']);
      const { id, slug } = await publishedTournament(api);
      await signIn(page, locale);
      await enter(page, locale, slug);
      const opponent = await browser.newContext();
      const opponentPage = await opponent.newPage();
      await signIn(opponentPage, locale);
      await enter(opponentPage, locale, slug);

      expect((await api.post(`/api/v1/admin/tournaments/${id}/competition`, { data: {} })).ok()).toBe(true);
      // The public bracket exposes seeds and keys, not ids or versions — an operator read
      // is what carries the identity and the version a schedule change needs.
      const competition = await api.get(`/api/v1/admin/tournaments/${id}/competition`);
      const match = ((await competition.json()) as { matches: Array<{ id: string; version: number }> }).matches[0];

      // First schedule, then move it: only the second is a change the participant is told about.
      expect(
        (await api.patch(`/api/v1/admin/tournaments/${id}/matches/${match?.id}/schedule`, {
          data: { expectedVersion: match?.version, scheduledAt: '2100-05-01T12:00:00.000Z', reason: 'Initial slot.' }
        })).ok()
      ).toBe(true);
      const afterFirst = await api.get(`/api/v1/admin/tournaments/${id}/competition`);
      const moved = ((await afterFirst.json()) as { matches: Array<{ id: string; version: number }> }).matches.find((m) => m.id === match?.id);
      expect(
        (await api.patch(`/api/v1/admin/tournaments/${id}/matches/${match?.id}/schedule`, {
          data: { expectedVersion: moved?.version, scheduledAt: '2100-05-02T15:30:00.000Z', reason: 'Venue clash — staff only.' }
        })).ok()
      ).toBe(true);

      await page.goto(`/${locale}/account/matches`);
      await expect(page.getByTestId('match-time')).toBeVisible();
      await expect(page.getByTestId('match-rescheduled')).toBeVisible();
      await expect(page.getByTestId('match-unscheduled')).toHaveCount(0);

      // The operator's reason is staff-facing and must never reach this page.
      const body = await page.locator('body').innerText();
      expect(body).not.toContain('Venue clash');
      expect(body).not.toContain('staff only');
      expect(body).not.toMatch(RAW_KEY_PATTERN);
      await opponent.close();
    });
  }

  test('the matches page does not scroll horizontally at the 320px floor (fa)', async ({ page, browser }) => {
    const api = await apiWithRoles(browser, ['tournament_administrator', 'content_publisher']);
    const { id, slug } = await publishedTournament(api);
    await signIn(page, 'fa');
    await enter(page, 'fa', slug);
    const opponent = await browser.newContext();
    const opponentPage = await opponent.newPage();
    await signIn(opponentPage, 'fa');
    await enter(opponentPage, 'fa', slug);
    expect((await api.post(`/api/v1/admin/tournaments/${id}/competition`, { data: {} })).ok()).toBe(true);

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/fa/account/matches');
    await expect(page.getByTestId('my-match')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await opponent.close();
  });
});
