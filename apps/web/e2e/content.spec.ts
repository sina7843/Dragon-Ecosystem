import { expect, test, type Page } from '@playwright/test';

/**
 * Content and games publishing journeys in both locales (CONTENT-001..010,
 * TEST-012, I18N-012, SEO-001..004). An author publishes through the admin UI,
 * then the item is public and correctly localized; a draft never leaks.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

function uniqueMobile(): string {
  return `0912${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
}

/** Signs in and returns the mobile, then grants the role via the dev-only helper. */
async function signInAsPublisher(page: Page): Promise<void> {
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

  const grant = await page.request.post('/api/v1/dev/grant-role', {
    data: { mobile, role: 'content_publisher' }
  });
  expect(grant.ok()).toBe(true);
}

const uniqueSuffix = () => String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 1000));

test('publish content through the admin UI, then read it publicly in both locales', async ({ page }) => {
  await signInAsPublisher(page);

  const slugEn = `guide-${uniqueSuffix()}`;
  const slugFa = `rahnama-${uniqueSuffix()}`;

  await page.goto('/en/admin/content');
  await expect(page.getByTestId('content-form')).toBeVisible();

  // Fill both locales.
  await page.locator('#field-type').selectOption('guide');
  await page.locator('#title-en').fill('Getting Started');
  await page.locator('#summary-en').fill('A short English summary.');
  await page.locator('#body-en').fill('<p>English body content.</p>');
  await page.locator('#title-fa').fill('شروع کار');
  await page.locator('#summary-fa').fill('خلاصه فارسی کوتاه.');
  await page.locator('#body-fa').fill('<p>متن فارسی.</p>');
  await page.locator('#slug-en').fill(slugEn);
  await page.locator('#slug-fa').fill(slugFa);
  await page.getByTestId('save-content').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);

  // draft → in_review → published.
  page.on('dialog', (dialog) => dialog.accept('editorial review complete'));
  await page.getByTestId('submit-review').click();
  await expect(page.getByTestId('publish')).toBeVisible();
  await page.getByTestId('publish').click();
  // Once published, the editor offers Archive — an unambiguous signal of the new state.
  await expect(page.getByTestId('archive')).toBeVisible();

  // Public English detail.
  await page.goto(`/en/content/guide/${slugEn}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Getting Started');
  await expect(page.getByTestId('content-body')).toContainText('English body content.');
  // Indexable with a description and canonical.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /English summary/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/en/content/guide/${slugEn}$`));
  // hreflang points at the Persian slug, not a naive swap.
  await expect(page.locator('link[rel="alternate"][hreflang="fa"]')).toHaveAttribute(
    'href',
    new RegExp(`/fa/content/guide/${slugFa}$`)
  );

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);

  // Public Persian detail.
  await page.goto(`/fa/content/guide/${slugFa}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('شروع کار');

  // The public content list renders published cards (position is not asserted, as
  // the shared E2E database accumulates items across runs).
  await page.goto('/en/content?type=guide');
  await expect(page.locator('[data-testid^="content-card-"]').first()).toBeVisible();
});

test('a draft is never publicly reachable', async ({ page }) => {
  await signInAsPublisher(page);
  const slugEn = `secret-${uniqueSuffix()}`;

  await page.goto('/en/admin/content');
  await page.locator('#field-type').selectOption('article');
  await page.locator('#title-en').fill('Unpublished');
  await page.locator('#summary-en').fill('Draft only.');
  await page.locator('#body-en').fill('<p>Draft.</p>');
  await page.locator('#title-fa').fill('پیش‌نویس');
  await page.locator('#summary-fa').fill('فقط پیش‌نویس.');
  await page.locator('#body-fa').fill('<p>پیش‌نویس.</p>');
  await page.locator('#slug-en').fill(slugEn);
  await page.locator('#slug-fa').fill(`pishnevis-${uniqueSuffix()}`);
  await page.getByTestId('save-content').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);

  // The draft is not public.
  await page.goto(`/en/content/article/${slugEn}`);
  await expect(page.getByTestId('content-not-found')).toBeVisible();
});

test('publish a game and browse the catalog, both locales', async ({ page }) => {
  await signInAsPublisher(page);
  const slug = `game-${uniqueSuffix()}`;

  await page.goto('/en/admin/games');
  await expect(page.getByTestId('game-form')).toBeVisible();
  await page.locator('#name-en').fill('Dragon Arena');
  await page.locator('#desc-en').fill('A competitive arena game.');
  await page.locator('#name-fa').fill('میدان اژدها');
  await page.locator('#desc-fa').fill('یک بازی رقابتی.');
  await page.locator('#game-slug').fill(slug);
  await page.getByTestId('save-game').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);

  page.on('dialog', (dialog) => dialog.accept('ready to launch'));
  await page.getByTestId('publish-game').click();
  // Once published, the editor offers Archive.
  await expect(page.getByTestId('archive-game')).toBeVisible();

  // The public catalog renders published games; the detail pages are deterministic by slug.
  await page.goto('/en/games');
  await expect(page.locator('[data-testid^="game-card-"]').first()).toBeVisible();
  await page.goto(`/en/games/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dragon Arena');
  await page.goto(`/fa/games/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('میدان اژدها');
});

test('an unknown content slug returns the localized not-found state', async ({ page }) => {
  await page.goto('/en/content/article/does-not-exist');
  await expect(page.getByTestId('content-not-found')).toBeVisible();
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
});
