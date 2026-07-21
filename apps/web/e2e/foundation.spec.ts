import { expect, test, type Page } from '@playwright/test';

/**
 * Foundation browser coverage (TEST-012, TEST-015, TEST-017, TEST-019, I18N-012).
 * Both required locales are exercised in a real browser against the production build.
 */

interface LocaleCase {
  readonly locale: 'fa' | 'en';
  readonly direction: 'rtl' | 'ltr';
  readonly heading: string;
  readonly onlineLabel: string;
}

const LOCALE_CASES: readonly LocaleCase[] = [
  { locale: 'fa', direction: 'rtl', heading: 'اکوسیستم دراگون', onlineLabel: 'در دسترس' },
  { locale: 'en', direction: 'ltr', heading: 'Dragon Ecosystem', onlineLabel: 'Online' }
];

/** Collects anything that must not appear during a clean run (TEST-019). */
function watchForBrowserProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  return problems;
}

for (const testCase of LOCALE_CASES) {
  test(`home page renders in ${testCase.locale} with ${testCase.direction} direction`, async ({ page }) => {
    const problems = watchForBrowserProblems(page);

    // Direct URL entry, which also covers refresh behaviour for a locale-prefixed route.
    await page.goto(`/${testCase.locale}`);

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', testCase.locale);
    await expect(html).toHaveAttribute('dir', testCase.direction);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(testCase.heading);

    // Proves the browser reached the API through the same-origin /api path.
    const apiStatus = page.getByTestId('api-status');
    await expect(apiStatus).toHaveAttribute('data-state', 'online');
    await expect(apiStatus).toHaveText(testCase.onlineLabel);

    // No raw translation key may be visible in production UI (I18N-009).
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/\b(?:app|home|locale|notFound)\.[a-zA-Z]/);

    expect(problems).toEqual([]);
  });
}

test('switching language keeps the user on the same route', async ({ page }) => {
  const problems = watchForBrowserProblems(page);

  await page.goto('/en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  await page.getByTestId('locale-link-fa').click();

  await expect(page).toHaveURL(/\/fa$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('اکوسیستم دراگون');

  expect(problems).toEqual([]);
});

test('the root path redirects to a supported locale', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/(?:fa|en)$/);
});

test('an unknown route shows a localized not-found page instead of a raw key', async ({ page }) => {
  await page.goto('/en/not-a-real-page');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/\bnotFound\.[a-zA-Z]/);
});
