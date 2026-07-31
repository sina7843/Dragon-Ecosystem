import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { actAndAwaitApi, uniqueMobile, uniqueSuffix } from './helpers.ts';

/**
 * The public help and support surface (PAGE-023).
 *
 * Two things are being protected here. The first is the requester's view of their own case:
 * an operator's working note and the staff member assigned to it must never reach the page.
 * The second is what the page promises — the requirement's FAQ and tournament-help clauses
 * have no approved copy behind them, so the assertions below check that none was invented:
 * no contact address, no telephone number, no response-time or availability claim.
 */

const RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/;

/**
 * Wording the platform has not approved anywhere: a promise the page must not make.
 *
 * Grouped by the kind of claim rather than written as one alternation, because the point is
 * coverage of the *categories* the slice forbids — a contact channel, a response time, an
 * availability or money guarantee — not a list of the exact phrases that happen to be absent
 * today. Both scripts are covered: the fa page is a separate rendering and an English-only
 * pattern would pass over it blind.
 */
const CONTACT_CHANNEL = /@[a-z0-9.-]+\.[a-z]{2,}|mailto:|tel:|\+98|\b0\d{9,}\b|t\.me\/|telegram|whatsapp|instagram|live chat|call us|تلگرام|واتساپ|اینستاگرام|تماس بگیرید|گفتگوی زنده/i;
const RESPONSE_PROMISE = /within \d+\s*(?:hour|minute|day|business day)|\b(?:we|our team)\b[^.]{0,40}\b(?:reply|respond|get back|contact you)\b|same[- ]day|as soon as possible|\bSLA\b|business hours|پاسخ می‌دهیم|پاسخ خواهیم داد|ساعات? کاری|در اسرع وقت/i;
const AVAILABILITY_OR_MONEY = /24\/7|guarantee|guaranteed|uptime|refund|money back|تضمین|بازگشت وجه|۲۴ ?ساعته|همیشه در دسترس/i;
const UNAPPROVED_PROMISE = new RegExp(
  `${CONTACT_CHANNEL.source}|${RESPONSE_PROMISE.source}|${AVAILABILITY_OR_MONEY.source}`,
  'i'
);

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
  const saved = await page.request.put('/api/v1/account/profile', {
    data: { username: `hp_${uniqueSuffix()}`, displayName: `Player ${uniqueSuffix()}`, birthDate: '2000-01-01', visibility: 'public' }
  });
  expect(saved.ok()).toBe(true);
}

/** An API context holding the support operator role. */
async function supportOperator(browser: Browser): Promise<APIRequestContext> {
  const api = (await browser.newContext()).request;
  const mobile = uniqueMobile();
  await api.post('/api/v1/auth/otp/request', { data: { mobile } });
  const inbox = await api.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await api.post('/api/v1/auth/otp/verify', { data: { mobile, code } });
  expect((await api.post('/api/v1/dev/grant-role', { data: { mobile, role: 'support_operator' } })).ok()).toBe(true);
  return api;
}

/** Fills and submits the support form, waiting for the request it triggers. */
async function sendRequest(page: Page, subject: string, message: string): Promise<void> {
  await page.locator('#support-subject').fill(subject);
  await page.getByTestId('support-body').fill(message);
  await actAndAwaitApi(page, 'POST', /^\/api\/v1\/support\/cases$/, async () => {
    await page.getByTestId('support-submit').click();
  });
}

test.describe('PAGE-023 help and support', () => {
  for (const locale of ['fa', 'en'] as const) {
    test(`an anonymous visitor is offered sign-in rather than a form that cannot submit (${locale})`, async ({ page }) => {
      await page.goto(`/${locale}/help`);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByTestId('help-sign-in')).toBeVisible();
      await expect(page.getByTestId('help-form')).toHaveCount(0);
      await expect(page.getByTestId('help-links')).toBeVisible();

      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(RAW_KEY_PATTERN);
      expect(body).not.toMatch(UNAPPROVED_PROMISE);
      // The document direction follows the locale, not the other way round.
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    });
  }

  for (const locale of ['fa', 'en'] as const) {
    test(`a signed-in account with no requests sees the empty state and can send one (${locale})`, async ({ page }) => {
      await signIn(page, locale);
      await page.goto(`/${locale}/help`);
      await expect(page.getByTestId('help-form')).toBeVisible();
      await expect(page.getByTestId('help-cases-empty')).toBeVisible();

      const subject = `Sign-in trouble ${uniqueSuffix()}`;
      await sendRequest(page, subject, 'The code never arrives on my phone.');

      const confirmation = page.getByTestId('help-submitted');
      await expect(confirmation).toBeVisible();
      // Focus moves to the outcome, so a keyboard user is told what happened.
      await expect(confirmation).toBeFocused();

      const entry = page.getByTestId('help-case');
      await expect(entry).toHaveCount(1);
      await expect(entry.getByTestId('help-case-subject')).toHaveText(subject);
      // The state reads as the approved localized wording, not the raw enum value.
      await expect(entry.getByTestId('help-case-state')).toHaveText(locale === 'fa' ? 'باز' : 'Open');

      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(RAW_KEY_PATTERN);
      expect(body).not.toMatch(UNAPPROVED_PROMISE);
    });
  }

  for (const locale of ['fa', 'en'] as const) {
    test(`an empty field is refused with a message pointing at it (${locale})`, async ({ page }) => {
      await signIn(page, locale);
      await page.goto(`/${locale}/help`);

      // No request is made at all: the page rejects the submission itself.
      let attempted = false;
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/support/cases') attempted = true;
      });
      await page.getByTestId('support-submit').click();

      const summary = page.getByTestId('help-error');
      await expect(summary).toBeVisible();
      await expect(summary).toBeFocused();
      await expect(page.locator('#support-subject-error')).toBeVisible();
      await expect(page.getByTestId('support-body-error')).toBeVisible();
      // The message is associated with the field, not merely near it.
      await expect(page.getByTestId('support-body')).toHaveAttribute('aria-describedby', 'support-body-error');
      await expect(page.getByTestId('support-body')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByTestId('help-submitted')).toHaveCount(0);
      expect(attempted).toBe(false);

      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(RAW_KEY_PATTERN);
    });
  }

  test('an operator’s resolution note and identity never reach the requester (en)', async ({ page, browser }) => {
    const api = await supportOperator(browser);
    await signIn(page, 'en');
    await page.goto('/en/help');
    const subject = `Payment question ${uniqueSuffix()}`;
    await sendRequest(page, subject, 'A payment did not appear on my wallet.');

    // The operator resolves it with a staff-facing note.
    const queue = await api.get('/api/v1/admin/support/cases');
    expect(queue.ok()).toBe(true);
    const mine = ((await queue.json()) as { items: Array<{ id: string; subject: string; version: number }> }).items.find(
      (c) => c.subject === subject
    );
    expect(mine, 'the operator queue lists the case').toBeTruthy();
    const note = `internal-only-note-${uniqueSuffix()}`;
    const resolved = await api.post(`/api/v1/admin/support/cases/${mine?.id ?? ''}/resolve`, {
      data: { expectedVersion: mine?.version ?? 1, note }
    });
    expect(resolved.ok()).toBe(true);

    await page.reload();
    await expect(page.getByTestId('help-case')).toHaveCount(1);
    const body = await page.locator('body').innerText();
    expect(body).not.toContain(note);
    expect(body).not.toMatch(RAW_KEY_PATTERN);
  });

  test('one account never sees another account’s requests (en)', async ({ page, browser }) => {
    await signIn(page, 'en');
    await page.goto('/en/help');
    const subject = `Private matter ${uniqueSuffix()}`;
    await sendRequest(page, subject, 'Something only I should see.');

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signIn(otherPage, 'en');
    await otherPage.goto('/en/help');
    await expect(otherPage.getByTestId('help-cases-empty')).toBeVisible();
    expect(await otherPage.locator('body').innerText()).not.toContain(subject);
    await other.close();
  });

  test('the submit control is reachable and operable from the keyboard (en)', async ({ page }) => {
    await signIn(page, 'en');
    await page.goto('/en/help');
    await page.locator('#support-subject').fill(`Keyboard ${uniqueSuffix()}`);
    await page.getByTestId('support-body').fill('Sent without touching the mouse.');

    const submit = page.getByTestId('support-submit');
    await submit.focus();
    await expect(submit).toBeFocused();
    await actAndAwaitApi(page, 'POST', /^\/api\/v1\/support\/cases$/, async () => {
      await page.keyboard.press('Enter');
    });
    await expect(page.getByTestId('help-submitted')).toBeVisible();
  });

  for (const locale of ['fa', 'en'] as const) {
    test(`the page does not scroll horizontally at the 320px floor (${locale})`, async ({ page }) => {
      await signIn(page, locale);
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(`/${locale}/help`);
      // A long unbroken subject is the realistic way a card blows past its container.
      await sendRequest(page, `${uniqueSuffix()}${'x'.repeat(60)}`, 'y'.repeat(300));
      await expect(page.getByTestId('help-case')).toHaveCount(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
