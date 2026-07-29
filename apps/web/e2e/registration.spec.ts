import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { uniqueMobile, uniqueSuffix } from './helpers.ts';

/**
 * Free-tournament registration journeys (TOURN-004..016): a participant registers
 * through the public UI and sees their status; a manual-approval tournament flows
 * through the admin queue. Both locales; no raw i18n key leaks.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

/** Signs a fresh account in through the UI and completes its profile (eligibility needs it). */
async function signInWithProfile(page: Page): Promise<void> {
  const mobile = uniqueMobile();
  await page.goto('/en/auth/mobile');
  await page.locator('#auth-mobile').fill(mobile);
  await page.getByTestId('request-code').click();
  await expect(page.getByTestId('code-sent')).toBeVisible();
  const inbox = await page.request.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await page.locator('#auth-code').fill(code);
  await page.getByTestId('verify-code').click();
  await expect(page).toHaveURL(/\/en\/account(?:\/profile)?$/);
  await page.goto('/en/account/profile');
  await page.locator('#profile-username').fill(`pl_${uniqueSuffix()}`);
  await page.locator('#profile-display-name').fill('Player');
  await page.locator('#profile-birth-date').fill('2000-01-01');
  await page.getByTestId('profile-submit').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);
}

/** Creates a published free tournament via the API and returns its id + slug. */
async function createTournament(api: APIRequestContext, approvalMode: 'automatic' | 'manual'): Promise<{ id: string; slug: string }> {
  const slug = `reg-game-${uniqueSuffix()}`;
  const game = await api.post('/api/v1/admin/games', { data: { slug, translations: { fa: { name: 'ب', description: 'د' }, en: { name: 'Game', description: 'd' } } } });
  expect(game.ok()).toBe(true);
  const gameId = ((await game.json()) as { id: string }).id;
  const pubGame = await api.post(`/api/v1/admin/games/${gameId}/status`, { data: { status: 'published', reason: 'go' } });
  expect(pubGame.ok()).toBe(true);

  const create = await api.post('/api/v1/admin/tournaments', {
    data: {
      gameId,
      translations: { fa: { name: `تورنمنت ${uniqueSuffix()}`, summary: 'خ' }, en: { name: `Open Cup ${uniqueSuffix()}`, summary: 'Summary' } },
      ruleProfile: { text: { fa: 'قوانین', en: 'Rules' } },
      capacity: 16,
      approvalMode,
      registration: { opensAt: '2000-01-01T00:00', closesAt: '2100-01-01T00:00' },
      schedule: { startAt: '2100-01-02T00:00', endAt: '2100-01-03T00:00' }
    }
  });
  expect(create.ok()).toBe(true);
  const created = await create.json() as { id: string; slug: string };
  const publish = await api.post(`/api/v1/admin/tournaments/${created.id}/transition`, { data: { to: 'published', reason: 'launch' } });
  expect(publish.ok()).toBe(true);
  return { id: created.id, slug: created.slug };
}

/** Signs an organizer in via the API request context and grants the roles needed to author. */
async function organizerApi(page: Page): Promise<APIRequestContext> {
  const mobile = uniqueMobile();
  await page.request.post('/api/v1/auth/otp/request', { data: { mobile } });
  const inbox = await page.request.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await page.request.post('/api/v1/auth/otp/verify', { data: { mobile, code } });
  for (const role of ['tournament_administrator', 'content_publisher']) {
    const grant = await page.request.post('/api/v1/dev/grant-role', { data: { mobile, role } });
    expect(grant.ok()).toBe(true);
  }
  return page.request;
}

test('a participant registers for an automatic-approval tournament and is approved', async ({ page, browser }) => {
  // Organizer sets up the tournament via a separate context's API session.
  const organizerContext = await browser.newContext();
  const organizerPage = await organizerContext.newPage();
  const api = await organizerApi(organizerPage);
  const { slug } = await createTournament(api, 'automatic');
  await organizerContext.close();

  await signInWithProfile(page);
  await page.goto(`/en/tournaments/${slug}`);
  await expect(page.getByTestId('registration-panel')).toBeVisible();
  // Entry now goes through a dialog, so the whole form (paged when the organizer built
  // one) is one focused step rather than a block on the page.
  await page.getByTestId('open-register-form').click();
  await expect(page.getByTestId('register-form')).toBeVisible();
  await page.getByTestId('register').click();
  await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'approved');

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);

  // Persian side renders RTL with the localized status.
  await page.goto(`/fa/tournaments/${slug}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'approved');
});

test('a manual-approval registration flows through the admin queue', async ({ page, browser }) => {
  const organizerContext = await browser.newContext();
  const organizerPage = await organizerContext.newPage();
  const api = await organizerApi(organizerPage);
  const { id, slug } = await createTournament(api, 'manual');

  // Participant registers → pending.
  await signInWithProfile(page);
  await page.goto(`/en/tournaments/${slug}`);
  await page.getByTestId('open-register-form').click();
  await expect(page.getByTestId('register-form')).toBeVisible();
  await page.getByTestId('register').click();
  await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'pending');

  // Organizer approves from the admin queue.
  await organizerPage.goto(`/en/admin/tournaments/${id}/registrations`);
  await expect(organizerPage.getByTestId('registration-queue')).toBeVisible();
  await organizerPage.getByTestId('approve').first().click();
  await expect(organizerPage.getByTestId('seat-summary')).toContainText('1 filled');
  await organizerContext.close();

  // Participant now sees approved.
  await page.reload();
  await expect(page.getByTestId('registration-status')).toHaveAttribute('data-state', 'approved');
});
