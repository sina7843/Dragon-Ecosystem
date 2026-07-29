import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { uniqueMobile, uniqueSuffix } from './helpers.ts';

/**
 * Competition standings journey (DRAGON-09c): participants register for an
 * automatic-approval single-elimination tournament, an organizer generates and
 * plays the bracket, and the public tournament page shows final standings with a
 * champion in both locales. No raw i18n key leaks.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

/** OTP sign-in via a request context and complete a profile so the account is eligible. */
async function signedInApi(browser: Browser): Promise<APIRequestContext> {
  const context = await browser.newContext();
  const api = context.request;
  const mobile = uniqueMobile();
  await api.post('/api/v1/auth/otp/request', { data: { mobile } });
  const inbox = await api.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await api.post('/api/v1/auth/otp/verify', { data: { mobile, code } });
  await api.put('/api/v1/account/profile', { data: { username: `c_${uniqueSuffix()}`, displayName: 'Player', birthDate: '2000-01-01', visibility: 'public' } });
  return api;
}

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

async function createTournament(api: APIRequestContext): Promise<{ id: string; slug: string }> {
  const slug = `comp-game-${uniqueSuffix()}`;
  const game = await api.post('/api/v1/admin/games', { data: { slug, translations: { fa: { name: 'ب', description: 'د' }, en: { name: 'Game', description: 'd' } } } });
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
  const created = await create.json() as { id: string; slug: string };
  expect((await api.post(`/api/v1/admin/tournaments/${created.id}/transition`, { data: { to: 'published', reason: 'launch' } })).ok()).toBe(true);
  return created;
}

test('a single-elimination competition is played and standings show a champion', async ({ page, browser }) => {
  const organizer = await organizerApi(browser);
  const { id, slug } = await createTournament(organizer);

  // Two participants register (automatic approval) — the minimum single-elimination
  // field; kept small to limit the OTP-heavy browser suite's parallel contention.
  for (let i = 0; i < 2; i += 1) {
    const participant = await signedInApi(browser);
    const reg = await participant.post(`/api/v1/tournaments/${id}/registration`, { data: { idempotencyKey: `reg-${uniqueSuffix()}-${String(i)}` } });
    expect(reg.ok()).toBe(true);
  }

  // Organizer generates the competition and plays every match.
  expect((await organizer.post(`/api/v1/admin/tournaments/${id}/competition`, { data: {} })).ok()).toBe(true);
  for (let guard = 0; guard < 20; guard += 1) {
    const comp = await (await organizer.get(`/api/v1/admin/tournaments/${id}/competition?limit=100`)).json() as { competition: { state: string }; matches: Array<{ id: string; state: string }> };
    if (comp.competition.state === 'completed') break;
    const ready = comp.matches.filter((m) => m.state === 'ready');
    if (ready.length === 0) break;
    for (const m of ready) await organizer.post(`/api/v1/admin/tournaments/${id}/matches/${m.id}/result`, { data: { winnerSlot: 'a' } });
  }

  // Public standings show a champion and a final status.
  await page.goto(`/en/tournaments/${slug}`);
  await expect(page.getByTestId('standings')).toBeVisible();
  await expect(page.getByTestId('standings-status')).toHaveAttribute('data-status', 'final');
  await expect(page.getByTestId('standings').locator('tr[data-placement="champion"]')).toHaveCount(1);
  await expect(page.getByTestId('bracket')).toBeVisible();

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);

  // Persian side renders RTL with the localized standings.
  await page.goto(`/fa/tournaments/${slug}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('standings')).toBeVisible();
});

/** Sign in through the browser and grant organizer roles to that same session. */
async function signInOrganizer(page: Page, locale: 'fa' | 'en'): Promise<string> {
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
  for (const role of ['tournament_administrator', 'content_publisher']) {
    expect((await page.request.post('/api/v1/dev/grant-role', { data: { mobile, role } })).ok()).toBe(true);
  }
  return mobile;
}

async function competitionVersion(api: APIRequestContext, id: string): Promise<number> {
  const view = (await (await api.get(`/api/v1/admin/tournaments/${id}/competition?limit=100`)).json()) as { competition: { version: number } };
  return view.competition.version;
}

test('an operator regenerates and rolls back a bracket without losing recorded results', async ({ page, browser }) => {
  // The organizer drives the operator console from the browser session.
  await signInOrganizer(page, 'en');
  const organizer = page.request;
  const { id, slug } = await createTournament(organizer);

  for (let i = 0; i < 2; i += 1) {
    const participant = await signedInApi(browser);
    const reg = await participant.post(`/api/v1/tournaments/${id}/registration`, { data: { idempotencyKey: `reg-${uniqueSuffix()}-${String(i)}` } });
    expect(reg.ok()).toBe(true);
  }

  // Generate, then play the single final so a real result exists (champion decided).
  expect((await organizer.post(`/api/v1/admin/tournaments/${id}/competition`, { data: {} })).ok()).toBe(true);
  const generated = (await (await organizer.get(`/api/v1/admin/tournaments/${id}/competition?limit=100`)).json()) as { matches: Array<{ id: string; state: string }> };
  const ready = generated.matches.find((m) => m.state === 'ready');
  expect(ready).toBeTruthy();
  expect((await organizer.post(`/api/v1/admin/tournaments/${id}/matches/${ready?.id}/result`, { data: { winnerSlot: 'a' } })).ok()).toBe(true);

  // Public standings are final with a champion.
  await page.goto(`/en/tournaments/${slug}`);
  await expect(page.getByTestId('standings-status')).toHaveAttribute('data-status', 'final');
  await expect(page.getByTestId('standings').locator('tr[data-placement="champion"]')).toHaveCount(1);

  // Regenerate (destructive): the recorded result is archived to version history, not lost.
  const v1 = await competitionVersion(organizer, id);
  const preview = await organizer.post(`/api/v1/admin/tournaments/${id}/competition/regenerate/preview`, { data: {} });
  expect(((await preview.json()) as { currentCompletedResults: number }).currentCompletedResults).toBe(1);
  expect((await organizer.post(`/api/v1/admin/tournaments/${id}/competition/regenerate`, { data: { expectedVersion: v1, reason: 'seeding error', confirm: true } })).ok()).toBe(true);

  // The prior version is superseded with its result preserved; a fresh active version exists.
  const versionsAfter = (await (await organizer.get(`/api/v1/admin/tournaments/${id}/competition/versions`)).json()) as { versions: Array<{ versionNumber: number; state: string; completedResultCount: number }> };
  expect(versionsAfter.versions.find((v) => v.versionNumber === 1)).toMatchObject({ state: 'superseded', completedResultCount: 1 });
  expect(versionsAfter.versions.find((v) => v.versionNumber === 2)).toMatchObject({ state: 'active' });

  // Roll back to version 1: the recorded result is restored as a new active version.
  const v2 = await competitionVersion(organizer, id);
  expect((await organizer.post(`/api/v1/admin/tournaments/${id}/competition/rollback`, { data: { expectedVersion: v2, targetVersion: 1, reason: 'restore results', confirm: true } })).ok()).toBe(true);

  await page.goto(`/en/tournaments/${slug}`);
  await expect(page.getByTestId('standings-status')).toHaveAttribute('data-status', 'final');
  await expect(page.getByTestId('standings').locator('tr[data-placement="champion"]')).toHaveCount(1);

  // The operator console shows the immutable version history (three entries) with no raw keys.
  await page.goto(`/en/admin/tournaments/${id}/competition`);
  await expect(page.getByTestId('version-history')).toBeVisible();
  await expect(page.getByTestId('active-version')).toHaveText('3');
  await expect(page.getByTestId('version-1')).toHaveAttribute('data-state', 'superseded');
  await expect(page.getByTestId('version-3')).toHaveAttribute('data-state', 'active');
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);

  // Persian operator console renders RTL and localized.
  await page.goto(`/fa/admin/tournaments/${id}/competition`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('version-history')).toBeVisible();
});
