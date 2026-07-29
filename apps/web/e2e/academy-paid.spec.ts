import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { uniqueMobile, uniqueSuffix } from './helpers.ts';

/**
 * Phase 3 paid-course closure (DRAGON-21).
 *
 * The paid journey runs end to end behind its OD-015 gate, which the browser environment
 * turns on deliberately (`PAID_COURSES_ENABLED` in `playwright.config.ts`) while it stays
 * fail-closed everywhere else. The money half runs through the shared mock payment
 * provider and the Dragon Coin ledger, so payment failure and a duplicate provider
 * callback are real cases here rather than education-specific inventions.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

async function apiWithRoles(browser: Browser, roles: string[]): Promise<APIRequestContext> {
  const api = (await browser.newContext()).request;
  const mobile = uniqueMobile();
  await api.post('/api/v1/auth/otp/request', { data: { mobile } });
  const inbox = await api.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await api.post('/api/v1/auth/otp/verify', { data: { mobile, code } });
  for (const role of roles) {
    expect((await api.post('/api/v1/dev/grant-role', { data: { mobile, role } })).ok()).toBe(true);
  }
  return api;
}

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

interface Row {
  id: string;
  slug: string;
  version: number;
}

/** Publishes a course priced in Dragon Coin, with one required lesson. */
async function publishedPaidCourse(browser: Browser, api: APIRequestContext, dragonCoinAmount: number): Promise<string> {
  const slug = `paid-course-${uniqueSuffix()}`;

  // The coach account needs its own context; signing in on `api` would replace the
  // education manager's session and every admin call after it would be refused.
  const coachApi = (await browser.newContext()).request;
  const coachMobile = uniqueMobile();
  await coachApi.post('/api/v1/auth/otp/request', { data: { mobile: coachMobile } });
  const coachInbox = await coachApi.get(`/api/v1/dev/sms-inbox?mobile=${coachMobile}`);
  const coachCode = ((await coachInbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await coachApi.post('/api/v1/auth/otp/verify', { data: { mobile: coachMobile, code: coachCode } });
  const me = (await (await coachApi.get('/api/v1/auth/session')).json()) as { account: { id: string } };

  const coach = await api.post('/api/v1/admin/coaches', {
    data: { accountId: me.account.id, slug: `paid-coach-${uniqueSuffix()}`, translations: { fa: { displayName: 'مربی' }, en: { displayName: 'Coach' } } }
  });
  expect(coach.ok()).toBe(true);
  const coachId = ((await coach.json()) as { id: string }).id;
  expect((await api.post(`/api/v1/admin/coaches/${coachId}/approval`, { data: { approved: true, reason: 'Approved for the test.' } })).ok()).toBe(true);

  const created = await api.post('/api/v1/admin/courses', {
    data: {
      slug,
      coachId,
      accessModel: 'paid',
      price: { dragonCoinAmount },
      translations: { fa: { title: 'دورهٔ پولی', summary: 'خلاصه' }, en: { title: 'Paid course', summary: 'Summary' } }
    }
  });
  expect(created.ok()).toBe(true);
  let course = (await created.json()) as Row;

  const lesson = await api.post(`/api/v1/admin/courses/${course.id}/lessons`, {
    data: { order: 1, required: true, type: 'text', translations: { fa: { title: 'درس', body: '<p>متن</p>' }, en: { title: 'Lesson', body: '<p>Body</p>' } } }
  });
  expect(lesson.ok()).toBe(true);

  for (const state of ['review', 'published'] as const) {
    const moved = await api.post(`/api/v1/admin/courses/${course.id}/state`, {
      data: { state, expectedVersion: course.version, reason: `Moving to ${state}.` }
    });
    expect(moved.ok()).toBe(true);
    course = (await moved.json()) as Row;
  }
  return slug;
}

/**
 * The same number in the locale's own digits. Persian renders Persian numerals, so a
 * balance assertion written in Latin digits would silently only ever hold for English.
 */
function localeDigits(value: number, locale: 'fa' | 'en'): string {
  return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', { useGrouping: false }).format(value);
}

/** Buys the starter Dragon Coin package through the wallet UI (100 coins). */
async function buyStarterCoins(page: Page, locale: 'fa' | 'en'): Promise<void> {
  await page.goto(`/${locale}/account/wallet`);
  await page.getByTestId('buy-starter').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'payment_pending');
  await page.getByTestId('simulate-success').click();
  await expect(page.getByTestId('active-state')).toHaveAttribute('data-state', 'succeeded');
  await expect(page.getByTestId('balance-available')).toContainText(localeDigits(100, locale));
}

for (const locale of ['fa', 'en'] as const) {
  test(`a learner buys coins, pays for a course, and reaches the lessons (${locale})`, async ({ page, browser }) => {
    const api = await apiWithRoles(browser, ['education_manager']);
    const slug = await publishedPaidCourse(browser, api, 60);

    await signIn(page, locale);
    await buyStarterCoins(page, locale);

    await page.goto(`/${locale}/academy/courses/${slug}`);
    // A paid course reserves a place first; the price is stated before anything is captured.
    await page.getByTestId('course-enroll').click();
    await expect(page.getByTestId('course-activate')).toBeVisible();
    await page.getByTestId('course-activate').click();
    await expect(page).toHaveURL(/\/academy\/learn\//);
    await expect(page.getByTestId('lesson-body')).toBeVisible();

    // Captured exactly once: 100 bought, 60 spent, nothing left held.
    await page.goto(`/${locale}/account/wallet`);
    await expect(page.getByTestId('balance-available')).toContainText(localeDigits(40, locale));
    await expect(page.getByTestId('balance-held')).toContainText(localeDigits(0, locale));

    const main = await page.locator('main').innerText();
    expect(main).not.toMatch(RAW_KEY_PATTERN);
  });
}

test('a learner without enough Dragon Coin is refused, and no place is reserved', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['education_manager']);
  const slug = await publishedPaidCourse(browser, api, 90);

  await signIn(page, 'en');
  // No coins bought, so the reservation cannot be made.
  await page.goto(`/en/academy/courses/${slug}`);
  await page.getByTestId('course-enroll').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);
  // Still offering to enroll: no half-made enrolment was left behind.
  await expect(page.getByTestId('course-enroll')).toBeVisible();
  await expect(page.getByTestId('course-activate')).toHaveCount(0);
});

test('a failed payment leaves no coins, so the paid course stays out of reach', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['education_manager']);
  const slug = await publishedPaidCourse(browser, api, 60);

  await signIn(page, 'en');
  await page.goto('/en/account/wallet');
  await page.getByTestId('buy-starter').click();
  await page.getByTestId('simulate-failure').click();
  await expect(page.getByTestId('balance-available')).toContainText('0');

  await page.goto(`/en/academy/courses/${slug}`);
  await page.getByTestId('course-enroll').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);
  await expect(page.getByTestId('course-activate')).toHaveCount(0);
});

test('a replayed provider callback credits once, and the course still costs its price', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['education_manager']);
  const slug = await publishedPaidCourse(browser, api, 60);

  await signIn(page, 'en');
  await buyStarterCoins(page, 'en');

  // The provider may deliver a verified callback more than once; the ledger must credit
  // exactly once. The purchase id is read from the account's own purchase list.
  const purchases = (await (await page.request.get('/api/v1/payments/purchases')).json()) as { items: Array<{ id: string; state: string }> };
  const purchaseId = purchases.items.find((p) => p.state === 'succeeded')?.id ?? '';
  expect(purchaseId).not.toBe('');
  const replay = await page.request.post('/api/v1/payments/mock/pay', { data: { purchaseId, outcome: 'success' } });
  expect(replay.status()).toBeLessThan(500);

  await page.goto('/en/account/wallet');
  await expect(page.getByTestId('balance-available')).toContainText('100');

  await page.goto(`/en/academy/courses/${slug}`);
  await page.getByTestId('course-enroll').click();
  await page.getByTestId('course-activate').click();
  await expect(page).toHaveURL(/\/academy\/learn\//);
  await page.goto('/en/account/wallet');
  await expect(page.getByTestId('balance-available')).toContainText('40');
});

test('a paid enrolment awaiting payment does not open the lessons', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['education_manager']);
  const slug = await publishedPaidCourse(browser, api, 60);

  await signIn(page, 'en');
  await buyStarterCoins(page, 'en');
  await page.goto(`/en/academy/courses/${slug}`);
  await page.getByTestId('course-enroll').click();
  await expect(page.getByTestId('course-activate')).toBeVisible();

  // Reach the player directly without activating: the entitlement is only pending, and
  // BR-024 requires both facts before any lesson content is served.
  const enrollments = (await (await page.request.get('/api/v1/me/enrollments')).json()) as { items: Array<{ id: string; state: string }> };
  const pending = enrollments.items.find((e) => e.state === 'pending_payment')?.id ?? '';
  expect(pending).not.toBe('');
  await page.goto(`/en/academy/learn/${pending}`);
  await expect(page.getByTestId('player-forbidden')).toBeVisible();
  await expect(page.getByTestId('lesson-body')).toHaveCount(0);
});

test('the course player is usable at the 320px floor and exposes its lesson navigation', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['education_manager']);
  const slug = await publishedPaidCourse(browser, api, 20);

  await page.setViewportSize({ width: 320, height: 640 });
  await signIn(page, 'en');
  await buyStarterCoins(page, 'en');
  await page.goto(`/en/academy/courses/${slug}`);
  await page.getByTestId('course-enroll').click();
  await page.getByTestId('course-activate').click();
  await expect(page).toHaveURL(/\/academy\/learn\//);

  // Responsive lesson consumption: the page must never scroll horizontally at the floor.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The lesson list is a real navigation landmark with reachable controls (A11Y).
  await expect(page.getByRole('navigation', { name: 'Lessons' })).toBeVisible();
  await expect(page.getByTestId('lesson-list').getByRole('button').first()).toBeEnabled();
});
