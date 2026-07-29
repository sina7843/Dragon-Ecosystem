import { expect, test, type Page } from '@playwright/test';
import { uniqueMobile } from './helpers.ts';

/**
 * Administration authorization UI (ADMIN-001, section 16.4).
 *
 * The positive permission matrix is covered exhaustively by the API integration
 * tests. These browser tests prove the client honours the same boundary: a caller
 * without administration permission sees the forbidden state, in both locales,
 * with no raw translation keys. The server enforces the boundary regardless.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

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
}

for (const locale of ['fa', 'en'] as const) {
  test(`a signed-in user without admin rights sees the forbidden state (${locale})`, async ({ page }) => {
    await signIn(page, locale);
    await page.goto(`/${locale}/admin`);

    await expect(page.getByTestId('admin-forbidden')).toBeVisible();
    // No admin area links are offered when the user cannot access them.
    await expect(page.getByTestId('area-users')).toHaveCount(0);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
  });

  test(`the admin users page is guarded in the browser too (${locale})`, async ({ page }) => {
    await signIn(page, locale);
    await page.goto(`/${locale}/admin/users`);
    await expect(page.getByTestId('users-forbidden')).toBeVisible();
  });
}

test('an anonymous visitor to admin sees the forbidden state, not admin content', async ({ page }) => {
  await page.goto('/en/admin');
  await expect(page.getByTestId('admin-forbidden')).toBeVisible();
  await expect(page.getByTestId('area-audit')).toHaveCount(0);
});
