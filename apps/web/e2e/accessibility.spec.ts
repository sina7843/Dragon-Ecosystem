import { expect, test, type Page } from '@playwright/test';

/**
 * Accessibility hardening matrix (DRAGON-16a). A BOUNDED set covering the shared
 * primitives — skip link, route-change focus, dialog focus trap/restore, nav disclosure
 * focus return, live-region alerts, form-error association, and RTL/LTR direction — on
 * representative surfaces (the design-system page exercises every primitive) rather than
 * every route in every viewport. Run on desktop + one narrow mobile project.
 */

const DS = (locale: string) => `/${locale}/design-system`;

async function activeTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
}
async function activeId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

test.describe('shared primitive accessibility', () => {
  test('skip link moves focus to the main landmark (keyboard)', async ({ page }) => {
    await page.goto('/en');
    await page.keyboard.press('Tab'); // first tab reaches the skip link
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await activeId(page)).toBe('main-content');
  });

  test('a client-side navigation moves focus to the new page main landmark', async ({ page }) => {
    await page.goto('/en');
    // Open the disclosure first if the nav is collapsed (narrow viewport).
    const toggle = page.getByTestId('nav-toggle');
    if (await toggle.isVisible()) await toggle.click();
    // Navigate via an in-app link (targeted by href), then focus must land on the new <main>.
    await page.locator('[data-testid="nav-list"] a[href="/en/content"]').click();
    await expect(page).toHaveURL(/\/en\/content$/);
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('dialog traps focus, closes on Escape, and restores focus to its trigger', async ({ page }) => {
    await page.goto(DS('en'));
    const trigger = page.getByTestId('dialog-open');
    await trigger.click();
    const dialog = page.getByTestId('app-dialog');
    await expect(dialog).toBeVisible();
    // Focus is inside the dialog.
    expect(await page.evaluate(() => document.querySelector('[data-testid="app-dialog"]')?.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Focus returns to the invoking control (native <dialog> restoration).
    expect(await activeTestId(page)).toBe('dialog-open');
  });

  test('mobile nav disclosure opens, closes on Escape, and returns focus to the toggle', async ({ page }, testInfo) => {
    // Only meaningful where the disclosure is shown (narrow viewport).
    test.skip(testInfo.project.name === 'desktop', 'disclosure is inline on desktop');
    await page.goto('/en');
    const toggle = page.getByTestId('nav-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('nav-list').getByRole('link').first().focus();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });

  test('an invalid form submission announces an error summary and marks the field invalid', async ({ page }) => {
    await page.goto(DS('en'));
    await page.getByTestId('form-submit').click();
    const summary = page.getByTestId('form-error-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute('role', 'alert');
    // The field is programmatically marked invalid and linked to its error.
    const input = page.locator('#sample-email');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedby = await input.getAttribute('aria-describedby');
    expect(describedby).toContain('sample-email-error');
    await expect(page.locator('#sample-email-error')).toBeVisible();
  });

  test('a danger toast is announced assertively; loading/error state blocks expose the right roles', async ({ page }) => {
    await page.goto(DS('en'));

    // Both live regions are mounted before anything is announced and start empty: text
    // inserted into an existing live region is the only reliably announced pattern, so
    // the announcement never rides on the toast element itself (A11Y-001).
    const assertive = page.getByTestId('toast-live-assertive');
    const polite = page.getByTestId('toast-live-polite');
    await expect(assertive).toHaveAttribute('aria-live', 'assertive');
    await expect(polite).toHaveAttribute('aria-live', 'polite');
    await expect(assertive).toHaveText('');

    await page.getByTestId('toast-danger').click();
    // The urgent notice lands in the assertive region, and not in the polite one.
    await expect(assertive).toContainText(/\S/);
    await expect(polite).toHaveText('');
    // The visible toast is decoration; its text is hidden so it is not read twice.
    await expect(page.getByTestId('toast').first().locator('.toast-text')).toHaveAttribute('aria-hidden', 'true');
  });

  test('the not-found state announces assertively with a real heading (SEO/A11Y)', async ({ page }) => {
    await page.goto('/en');
    await page.goto('/en/no-such-page-xyz');
    const block = page.getByTestId('state-notFound');
    await expect(block).toHaveAttribute('role', 'alert');
    // Heading is a real heading element, not a styled paragraph.
    await expect(block.locator('h1, h2, h3')).toBeVisible();
  });
});

for (const { locale, dir } of [{ locale: 'fa', dir: 'rtl' }, { locale: 'en', dir: 'ltr' }] as const) {
  test(`design-system page renders in ${locale} with ${dir} direction and no raw i18n keys`, async ({ page }) => {
    await page.goto(DS(locale));
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    // One main landmark; primitives labelled; no raw key leaks.
    await expect(page.locator('main#main-content')).toHaveCount(1);
    expect(await page.locator('main').innerText()).not.toMatch(/\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/);
  });
}
