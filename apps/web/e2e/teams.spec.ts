import { expect, test, type Page } from '@playwright/test';

/**
 * Persistent-team journeys (TEAM-001..010) in the real UI: an owner creates a
 * team, invites a player, the player accepts from a second session, and the
 * roster reflects both. A private team is a public 404; a public team is
 * browsable. No raw i18n key ever leaks in either locale.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

function uniqueMobile(): string {
  return `0912${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
}
const uniqueSuffix = (): string => String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 1000));

/** Signs a fresh account in through the UI and returns its mobile number. */
async function signIn(page: Page): Promise<string> {
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
  return mobile;
}

/** Completes the signed-in account's profile so it has a public username. */
async function completeProfile(page: Page, username: string): Promise<void> {
  await page.goto('/en/account/profile');
  await page.locator('#profile-username').fill(username);
  await page.locator('#profile-display-name').fill(username);
  await page.locator('#profile-birth-date').fill('2000-01-01');
  await page.getByTestId('visibility-public').check();
  await page.getByTestId('profile-submit').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);
}

/** Creates and publishes a game via the API (the signed-in account is granted the role first). */
async function createPublishedGame(page: Page, mobile: string): Promise<string> {
  const grant = await page.request.post('/api/v1/dev/grant-role', { data: { mobile, role: 'content_publisher' } });
  expect(grant.ok()).toBe(true);
  const slug = `team-game-${uniqueSuffix()}`;
  const create = await page.request.post('/api/v1/admin/games', {
    data: { slug, translations: { fa: { name: 'بازی تیمی', description: 'د' }, en: { name: 'Team Game', description: 'd' } } }
  });
  expect(create.ok()).toBe(true);
  const gameId = ((await create.json()) as { id: string }).id;
  const publish = await page.request.post(`/api/v1/admin/games/${gameId}/status`, { data: { status: 'published', reason: 'launch' } });
  expect(publish.ok()).toBe(true);
  return gameId;
}

test('an owner creates a team, invites a player, and the player joins', async ({ page, browser }) => {
  // Owner: sign in, prepare a published game, complete profile.
  const ownerMobile = await signIn(page);
  await createPublishedGame(page, ownerMobile);
  const ownerName = `owner_${uniqueSuffix()}`;
  await completeProfile(page, ownerName);

  // Invitee: a separate browser context (independent session).
  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();
  await signIn(inviteePage);
  const inviteeName = `member_${uniqueSuffix()}`;
  await completeProfile(inviteePage, inviteeName);

  // Owner creates the team through the UI.
  await page.goto('/en/account/teams');
  await expect(page.getByTestId('team-form')).toBeVisible();
  const teamName = `Dragon Team ${uniqueSuffix()}`;
  await page.locator('#team-name').fill(teamName);
  // Any published game works; index 0 is the disabled placeholder.
  await page.locator('#team-game').selectOption({ index: 1 });
  await page.getByTestId('create-team').click();
  // Redirected to the team detail page.
  await expect(page.getByTestId('team-title')).toHaveText(teamName);
  await expect(page.getByTestId('roster')).toBeVisible();

  // Owner invites the player by username.
  await page.locator('#invite-username').fill(inviteeName);
  await page.getByTestId('send-invite').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);

  // Invitee sees and accepts the invitation.
  await inviteePage.goto('/en/account/teams');
  await expect(inviteePage.getByTestId('invitations')).toBeVisible();
  await inviteePage.getByTestId('accept-invitation').first().click();
  await expect(inviteePage.getByTestId('toast')).toHaveCount(1);

  // The invitee now sees the team and opens it: the roster lists both members.
  await inviteePage.locator('[data-testid^="team-card-"] a').first().click();
  await expect(inviteePage.getByTestId('roster').locator('li')).toHaveCount(2);
  // A member sees the Leave control, not owner controls.
  await expect(inviteePage.getByTestId('leave-team')).toBeVisible();

  const bodyText = await inviteePage.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);

  await inviteeContext.close();
});

test('a team is private by default and becomes browsable when made public', async ({ page }) => {
  const ownerMobile = await signIn(page);
  await createPublishedGame(page, ownerMobile);
  await completeProfile(page, `owner_${uniqueSuffix()}`);

  await page.goto('/en/account/teams');
  const teamName = `Public Team ${uniqueSuffix()}`;
  await page.locator('#team-name').fill(teamName);
  // Any published game works; index 0 is the disabled placeholder.
  await page.locator('#team-game').selectOption({ index: 1 });
  await page.getByTestId('create-team').click();
  await expect(page.getByTestId('team-title')).toHaveText(teamName);

  // Look up the slug via the API (the UI does not expose it directly).
  const mine = await page.request.get('/api/v1/teams/mine');
  const slug = ((await mine.json()) as { items: Array<{ name: string; slug: string }> }).items.find((tm) => tm.name === teamName)?.slug ?? '';
  expect(slug).not.toBe('');

  // Private team: the public page is a real 404 state.
  await page.goto(`/en/teams/${slug}`);
  await expect(page.getByTestId('team-not-found')).toBeVisible();

  // Owner makes it public, then the public page renders the roster.
  await page.goto('/en/account/teams');
  await page.locator('[data-testid^="team-card-"] a').first().click();
  await page.getByTestId('toggle-visibility').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);

  await page.goto(`/fa/teams/${slug}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('public-roster')).toBeVisible();
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
});
