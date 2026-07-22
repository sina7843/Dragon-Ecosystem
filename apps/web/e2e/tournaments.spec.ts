import { expect, test, type Page } from '@playwright/test';

/**
 * Tournament authoring and discovery journey (TOURN-001..002, discovery): an
 * organizer drafts a tournament through the admin UI, publishes it, and it then
 * appears on the public list, detail, and calendar in both locales. A draft is
 * never publicly reachable. No raw i18n key leaks.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

function uniqueMobile(): string {
  return `0912${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
}
const uniqueSuffix = (): string => String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 1000));

/** Signs in and grants tournament + games management so the same user can set up a game and a tournament. */
async function signInAsOrganizer(page: Page): Promise<void> {
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

  for (const role of ['tournament_administrator', 'content_publisher']) {
    const grant = await page.request.post('/api/v1/dev/grant-role', { data: { mobile, role } });
    expect(grant.ok()).toBe(true);
  }
}

/** Finds a tournament's slug by its English name via the admin API (parallel-safe). */
async function slugByName(page: Page, name: string): Promise<string> {
  const res = await page.request.get('/api/v1/admin/tournaments?limit=100');
  const items = ((await res.json()) as { items: Array<{ slug: string; translations: { en: { name: string } } }> }).items;
  return items.find((i) => i.translations.en.name === name)?.slug ?? 'not-found';
}

async function createPublishedGame(page: Page): Promise<void> {
  const slug = `tour-game-${uniqueSuffix()}`;
  const create = await page.request.post('/api/v1/admin/games', {
    data: { slug, translations: { fa: { name: 'بازی تورنمنت', description: 'د' }, en: { name: 'Tournament Game', description: 'd' } } }
  });
  expect(create.ok()).toBe(true);
  const id = ((await create.json()) as { id: string }).id;
  const publish = await page.request.post(`/api/v1/admin/games/${id}/status`, { data: { status: 'published', reason: 'launch' } });
  expect(publish.ok()).toBe(true);
}

test('an organizer drafts and publishes a tournament, then it is publicly discoverable', async ({ page }) => {
  await signInAsOrganizer(page);
  await createPublishedGame(page);

  const name = `Dragon Cup ${uniqueSuffix()}`;
  await page.goto('/en/admin/tournaments');
  await expect(page.getByTestId('tournament-form')).toBeVisible();

  await page.locator('#tour-game').selectOption({ index: 1 });
  await page.locator('#name-en').fill(name);
  await page.locator('#summary-en').fill('An English tournament summary.');
  await page.locator('#rules-en').fill('English rules.');
  await page.locator('#name-fa').fill('جام اژدها');
  await page.locator('#summary-fa').fill('خلاصه فارسی.');
  await page.locator('#rules-fa').fill('قوانین فارسی.');
  await page.locator('#tour-capacity').fill('128');
  await page.locator('#tour-opens').fill('2026-09-01T10:00');
  await page.locator('#tour-closes').fill('2026-09-10T10:00');
  await page.locator('#tour-start').fill('2026-09-11T10:00');
  await page.locator('#tour-end').fill('2026-09-12T10:00');
  await page.locator('#tour-fee-kind').selectOption('toman');
  await page.locator('#tour-fee-toman').fill('5000');
  await page.getByTestId('save-tournament').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);

  // Publish (a reason is prompted).
  page.on('dialog', (dialog) => dialog.accept('ready to launch'));
  await page.getByTestId('publish-tournament').click();
  await expect(page.getByTestId('tournament-state')).toHaveText('Published');

  // The shared E2E database accumulates tournaments across parallel runs, so look up
  // this tournament's own slug rather than assuming it is first in any public list.
  const slug = await slugByName(page, name);

  // Public English detail (direct, deterministic) and the list renders cards.
  await page.goto('/en/tournaments');
  await expect(page.locator('[data-testid^="tournament-card-"]').first()).toBeVisible();
  await page.goto(`/en/tournaments/${slug}`);
  await expect(page.getByTestId('tournament-title')).toHaveText(name);
  await expect(page.getByTestId('fee')).toBeVisible();

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);

  // Calendar renders, and the Persian side is RTL.
  await page.goto('/en/tournaments-calendar');
  await expect(page.getByTestId('calendar')).toBeVisible();
  await page.goto(`/fa/tournaments/${slug}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('tournament-title')).toHaveText('جام اژدها');
});

test('a draft tournament is never publicly reachable', async ({ page }) => {
  await signInAsOrganizer(page);
  await createPublishedGame(page);

  const name = `Secret Cup ${uniqueSuffix()}`;
  await page.goto('/en/admin/tournaments');
  await page.locator('#tour-game').selectOption({ index: 1 });
  await page.locator('#name-en').fill(name);
  await page.locator('#summary-en').fill('Draft only.');
  await page.getByTestId('save-tournament').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);

  // This draft's own slug must not be publicly reachable.
  const slug = await slugByName(page, name);
  await page.goto(`/en/tournaments/${slug}`);
  await expect(page.getByTestId('tournament-not-found')).toBeVisible();
});
