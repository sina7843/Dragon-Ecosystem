import { expect, test, type Page } from '@playwright/test';
import { uniqueMobile, uniqueSuffix } from './helpers.ts';

/**
 * Mobile OTP authentication journey in both locales (UC-001, UC-002, TEST-005,
 * TEST-012, I18N-012).
 *
 * The code is read from the mock provider's development inbox, exactly as a
 * developer would. No real SMS is involved.
 */

interface LocaleCase {
  readonly locale: 'fa' | 'en';
  readonly heading: string;
  readonly invalidMobile: string;
  readonly invalidCode: string;
}

const LOCALE_CASES: readonly LocaleCase[] = [
  {
    locale: 'fa',
    heading: 'ورود',
    invalidMobile: 'یک شماره موبایل معتبر ایران وارد کنید.',
    invalidCode: 'کد معتبر نیست یا منقضی شده است.'
  },
  {
    locale: 'en',
    heading: 'Sign in',
    invalidMobile: 'Enter a valid Iranian mobile number.',
    invalidCode: 'The code is not valid or has expired.'
  }
];

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

async function readLatestCode(page: Page, mobile: string): Promise<string> {
  const response = await page.request.get(`/api/v1/dev/sms-inbox?mobile=${encodeURIComponent(mobile)}`);
  expect(response.ok()).toBe(true);
  const messages = (await response.json()) as Array<{ code: string }>;
  expect(messages.length).toBeGreaterThan(0);
  return messages[0]?.code as string;
}

async function signIn(page: Page, locale: 'fa' | 'en', mobile: string): Promise<void> {
  await page.goto(`/${locale}/auth/mobile`);
  await page.locator('#auth-mobile').fill(mobile);
  await page.getByTestId('request-code').click();
  await expect(page.getByTestId('code-sent')).toBeVisible();

  const code = await readLatestCode(page, mobile);
  await page.locator('#auth-code').fill(code);
  await page.getByTestId('verify-code').click();

  // Wait for the post-login redirect before returning: navigating away while the
  // verify request is still in flight would abort it and discard the session cookie.
  await expect(page).toHaveURL(new RegExp(`/${locale}/account(?:/profile)?$`));
}

for (const testCase of LOCALE_CASES) {
  test.describe(`${testCase.locale} authentication`, () => {
    test('a new user signs in by OTP and is asked to complete their profile', async ({ page }) => {
      const mobile = uniqueMobile();
      await signIn(page, testCase.locale, mobile);

      // A brand-new account has no profile, so completion comes first.
      await expect(page).toHaveURL(new RegExp(`/${testCase.locale}/account/profile$`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('header-sign-out')).toBeVisible();

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
    });

    test('the sign-in page is localized and rejects an invalid number', async ({ page }) => {
      await page.goto(`/${testCase.locale}/auth/mobile`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(testCase.heading);

      await page.locator('#auth-mobile').fill('12345');
      await page.getByTestId('request-code').click();

      // The server code is mapped to a localized message (section 13.1).
      await expect(page.getByTestId('field-error')).toHaveText(new RegExp(testCase.invalidMobile));
      await expect(page.locator('#auth-mobile')).toHaveAttribute('aria-invalid', 'true');
    });

    test('a wrong code is rejected with a localized generic message', async ({ page }) => {
      const mobile = uniqueMobile();
      await page.goto(`/${testCase.locale}/auth/mobile`);
      await page.locator('#auth-mobile').fill(mobile);
      await page.getByTestId('request-code').click();
      await expect(page.getByTestId('code-sent')).toBeVisible();

      await page.locator('#auth-code').fill('000000');
      await page.getByTestId('verify-code').click();

      await expect(page.getByTestId('field-error')).toHaveText(new RegExp(testCase.invalidCode));
      // Still on the sign-in page: no session was created.
      await expect(page).toHaveURL(new RegExp(`/${testCase.locale}/auth/mobile$`));
    });

    test('profile completion enforces the minimum age and then succeeds', async ({ page }) => {
      const mobile = uniqueMobile();
      await signIn(page, testCase.locale, mobile);

      const username = `p_${uniqueSuffix()}${testCase.locale}`;
      await page.locator('#profile-username').fill(username);
      await page.locator('#profile-display-name').fill('Dragon Player');

      // Below the minimum age of 13 (DEC-003).
      await page.locator('#profile-birth-date').fill('2020-01-01');
      await page.getByTestId('profile-submit').click();
      await expect(page.getByTestId('field-error').first()).toBeVisible();

      await page.locator('#profile-birth-date').fill('2000-01-01');
      await page.getByTestId('profile-submit').click();

      // The success toast specifically, not a count. Signing in pushes its own toast and
      // reaches this page by client-side navigation, so the queue is already non-empty:
      // `toHaveCount(1)` was satisfied by that leftover message and passed before the save
      // had produced anything, then failed the moment the save's own toast arrived first.
      await expect(page.locator('[data-testid="toast"].success')).toHaveCount(1);
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toMatch(RAW_KEY_PATTERN);
    });

    test('a signed-in user sees sessions and security history, then signs out', async ({ page }) => {
      const mobile = uniqueMobile();
      await signIn(page, testCase.locale, mobile);

      await page.goto(`/${testCase.locale}/account/security`);
      await expect(page.locator('table').first()).toBeVisible();
      // Event types are localized, never shown as raw codes (I18N-009).
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toMatch(/session\.created|otp\.requested/);
      expect(bodyText).not.toMatch(RAW_KEY_PATTERN);

      await page.getByTestId('header-sign-out').click();
      await expect(page.getByTestId('header-sign-in')).toBeVisible();

      // The account page no longer shows signed-in content.
      await page.goto(`/${testCase.locale}/account`);
      await expect(page.getByTestId('sign-in-link')).toBeVisible();
    });
  });
}

test('an anonymous visitor is offered sign-in rather than account controls', async ({ page }) => {
  await page.goto('/en/account');
  await expect(page.getByTestId('sign-in-link')).toBeVisible();
  await expect(page.getByTestId('account-signed-in')).toHaveCount(0);
});

test('the public player page hides a private profile', async ({ page }) => {
  const response = await page.request.get('/api/v1/players/definitely-not-a-real-username');
  expect(response.status()).toBe(404);
});
