import { expect, test, type Page } from '@playwright/test';

/**
 * Application shell, design system, and localization coverage.
 *
 * Runs across the representative viewports declared in playwright.config.ts and
 * in both required locales (TEST-002, TEST-012, TEST-018, A11Y-018).
 */

interface LocaleCase {
  readonly locale: 'fa' | 'en';
  readonly direction: 'rtl' | 'ltr';
  readonly navRegion: string;
  readonly dialogTitle: string;
  readonly requiredError: string;
  readonly designSystemHeading: string;
}

const LOCALE_CASES: readonly LocaleCase[] = [
  {
    locale: 'fa',
    direction: 'rtl',
    navRegion: 'ناوبری اصلی',
    dialogTitle: 'پنجره نمونه',
    requiredError: 'نشانی ایمیل را وارد کنید.',
    designSystemHeading: 'سیستم طراحی'
  },
  {
    locale: 'en',
    direction: 'ltr',
    navRegion: 'Main navigation',
    dialogTitle: 'Example dialog',
    requiredError: 'Enter an email address.',
    designSystemHeading: 'Design system'
  }
];

/** Any `some.translation.key` left visible in the UI (I18N-009). */
const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

function watchForBrowserProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function isNarrow(page: Page): Promise<boolean> {
  return (page.viewportSize()?.width ?? 0) < 768;
}

for (const testCase of LOCALE_CASES) {
  test.describe(`${testCase.locale} shell`, () => {
    test('renders the shell with correct direction and no raw translation keys', async ({ page }) => {
      const problems = watchForBrowserProblems(page);
      await page.goto(`/${testCase.locale}/design-system`);

      const html = page.locator('html');
      await expect(html).toHaveAttribute('lang', testCase.locale);
      await expect(html).toHaveAttribute('dir', testCase.direction);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(testCase.designSystemHeading);

      // Landmarks and a single primary heading (A11Y-001, A11Y-007).
      await expect(page.locator('header')).toHaveCount(1);
      await expect(page.locator('main#main-content')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('navigation', { name: testCase.navRegion })).toBeVisible();

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
      expect(problems).toEqual([]);
    });

    test('never scrolls horizontally, including at the 320px floor', async ({ page }) => {
      await page.goto(`/${testCase.locale}/design-system`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('navigation collapses on narrow screens and is inline on wide ones', async ({ page }) => {
      await page.goto(`/${testCase.locale}/`);
      const toggle = page.getByTestId('nav-toggle');
      const list = page.getByTestId('nav-list');

      if (await isNarrow(page)) {
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(list).toBeVisible();

        // Escape closes the drawer without leaving the page.
        await page.keyboard.press('Escape');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      } else {
        await expect(toggle).toBeHidden();
        await expect(list).toBeVisible();
      }
    });

    test('the skip link moves focus to the main region', async ({ page }) => {
      await page.goto(`/${testCase.locale}/`);
      await page.keyboard.press('Tab');

      const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
      expect(focusedText.length).toBeGreaterThan(0);

      await page.keyboard.press('Enter');
      const focusedId = await page.evaluate(() => document.activeElement?.id ?? '');
      expect(focusedId).toBe('main-content');
    });

    test('the dialog traps focus and restores it to the invoker on close', async ({ page }) => {
      await page.goto(`/${testCase.locale}/design-system`);

      const open = page.getByTestId('dialog-open');
      await open.click();

      const dialog = page.getByTestId('app-dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByRole('dialog', { name: testCase.dialogTitle })).toBeVisible();

      // Focus is inside the dialog, not on the page behind it.
      const focusInDialog = await page.evaluate(() => {
        const element = document.querySelector('[data-testid="app-dialog"]');
        return element?.contains(document.activeElement) ?? false;
      });
      expect(focusInDialog).toBe(true);

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(open).toBeFocused();
    });

    test('form validation announces the error and associates it with the field', async ({ page }) => {
      await page.goto(`/${testCase.locale}/design-system`);

      await page.getByTestId('form-submit').click();

      const summary = page.getByTestId('form-error-summary');
      await expect(summary).toBeVisible();
      await expect(summary).toHaveAttribute('role', 'alert');

      const input = page.locator('#sample-email');
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByTestId('field-error')).toHaveText(new RegExp(testCase.requiredError));

      // The error element is referenced by the input's description (A11Y-004).
      const describedBy = (await input.getAttribute('aria-describedby')) ?? '';
      expect(describedBy).toContain('sample-email-error');

      // Code-like values stay LTR inside Persian text (section 17.5).
      await expect(input).toHaveAttribute('dir', 'ltr');
    });

    test('a valid submission shows a processing state and a notification', async ({ page }) => {
      await page.goto(`/${testCase.locale}/design-system`);

      await page.locator('#sample-email').fill('player@example.com');
      await page.getByTestId('form-submit').click();

      const region = page.getByTestId('toast-region');
      await expect(region).toHaveAttribute('aria-live', 'polite');
      await expect(page.getByTestId('toast')).toHaveCount(1);
    });

    test('the table exposes a caption and pagination works from the keyboard', async ({ page }) => {
      await page.goto(`/${testCase.locale}/design-system`);

      await expect(page.locator('table caption')).not.toBeEmpty();
      await expect(page.locator('table th[scope="col"]').first()).toBeVisible();

      const next = page.getByTestId('pagination-next');
      await next.focus();
      await page.keyboard.press('Enter');

      await expect(page.locator('button[aria-current="page"]')).toHaveText('2');
      await expect(page.getByTestId('pagination-previous')).toBeEnabled();
    });

    test('notifications are dismissible and capped', async ({ page }) => {
      await page.goto(`/${testCase.locale}/design-system`);

      for (let index = 0; index < 5; index += 1) {
        await page.getByTestId('toast-info').click();
      }
      // The queue is capped so announcements cannot flood (A11Y-016).
      await expect(page.getByTestId('toast')).toHaveCount(3);

      await page.getByTestId('toast').first().getByRole('button').click();
      await expect(page.getByTestId('toast')).toHaveCount(2);
    });

    test('the theme can be switched and is applied to the document', async ({ page }) => {
      await page.goto(`/${testCase.locale}/`);

      await page.getByTestId('theme-select').selectOption('dark');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

      await page.getByTestId('theme-select').selectOption('light');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

      // The preference survives a reload (PAGE-015).
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    });

    test('account and administration shells render their own state and stay non-indexable', async ({
      page
    }) => {
      // An anonymous account page invites sign-in (empty state); an anonymous admin
      // page is forbidden (capability-driven, deny-by-default). Both are non-indexable.
      const expectations = [
        { area: 'account', testid: 'state-empty' },
        { area: 'admin', testid: 'admin-forbidden' }
      ];
      for (const { area, testid } of expectations) {
        await page.goto(`/${testCase.locale}/${area}`);

        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByTestId(testid)).toBeVisible();

        // SEO-008: personalized and administrative pages must not be indexed.
        const robots = await page.locator('meta[name="robots"]').getAttribute('content');
        expect(robots).toBe('noindex,nofollow');

        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
      }
    });

    test('an unknown route shows the localized not-found state', async ({ page }) => {
      await page.goto(`/${testCase.locale}/no-such-page`);

      await expect(page.getByTestId('state-notFound')).toBeVisible();
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
    });

    test('the forbidden route shows the localized 403 state', async ({ page }) => {
      await page.goto(`/${testCase.locale}/403`);
      await expect(page.getByTestId('state-forbidden')).toBeVisible();
    });
  });
}
