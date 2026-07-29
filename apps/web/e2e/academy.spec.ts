import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { uniqueMobile, uniqueSuffix } from './helpers.ts';

/**
 * Academy journey (DRAGON-20, PAGE-030/031/032/054).
 *
 * The API suite covers the entitlement and permission matrix exhaustively. These tests
 * prove the browser honours the same boundaries in both locales: a draft course is not
 * discoverable, a locked lesson delivers no content, progress survives a reload, and the
 * education console is guarded.
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

/**
 * Creates a published free course with an approved coach and `lessonCount` chained
 * lessons, each requiring the one before it.
 */
async function publishedCourse(
  browser: Browser,
  api: APIRequestContext,
  lessonCount = 2
): Promise<{ courseId: string; slug: string; term: string; lessonIds: string[] }> {
  // The catalog searches titles, not slugs, so the unique term has to live in the title
  // for a parallel test to find its own course on a shared page.
  const term = uniqueSuffix();
  const slug = `academy-e2e-${term}`;

  // The coach account is created in its own context: signing in on `api` would replace the
  // education manager's session cookie, and every admin call after it would be refused.
  const coachApi = (await browser.newContext()).request;
  const coachMobile = uniqueMobile();
  await coachApi.post('/api/v1/auth/otp/request', { data: { mobile: coachMobile } });
  const coachInbox = await coachApi.get(`/api/v1/dev/sms-inbox?mobile=${coachMobile}`);
  const coachCode = ((await coachInbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  expect((await coachApi.post('/api/v1/auth/otp/verify', { data: { mobile: coachMobile, code: coachCode } })).ok()).toBe(true);
  const me = (await (await coachApi.get('/api/v1/auth/session')).json()) as { account: { id: string } };

  const coach = await api.post('/api/v1/admin/coaches', {
    data: { accountId: me.account.id, slug: `coach-${uniqueSuffix()}`, translations: { fa: { displayName: 'مربی' }, en: { displayName: 'Coach' } } }
  });
  expect(coach.ok()).toBe(true);
  const coachId = ((await coach.json()) as { id: string }).id;
  expect((await api.post(`/api/v1/admin/coaches/${coachId}/approval`, { data: { approved: true, reason: 'Approved for the test.' } })).ok()).toBe(true);

  const created = await api.post('/api/v1/admin/courses', {
    data: {
      slug,
      coachId,
      translations: { fa: { title: `دورهٔ آزمایشی ${term}`, summary: 'خلاصه' }, en: { title: `Test course ${term}`, summary: 'Summary' } }
    }
  });
  expect(created.ok()).toBe(true);
  let course = (await created.json()) as Row;

  const lessonIds: string[] = [];
  for (let i = 1; i <= lessonCount; i += 1) {
    const lesson = await api.post(`/api/v1/admin/courses/${course.id}/lessons`, {
      data: {
        order: i,
        required: true,
        type: 'text',
        translations: { fa: { title: `درس ${String(i)}`, body: `<p>متن ${String(i)}</p>` }, en: { title: `Lesson ${String(i)}`, body: `<p>Body ${String(i)}</p>` } },
        ...(i > 1 ? { prerequisiteLessonIds: [lessonIds[i - 2]] } : {})
      }
    });
    expect(lesson.ok()).toBe(true);
    lessonIds.push(((await lesson.json()) as { id: string }).id);
  }

  for (const state of ['review', 'published'] as const) {
    const moved = await api.post(`/api/v1/admin/courses/${course.id}/state`, {
      data: { state, expectedVersion: course.version, reason: `Moving to ${state}.` }
    });
    expect(moved.ok()).toBe(true);
    course = (await moved.json()) as Row;
  }
  return { courseId: course.id, slug, term, lessonIds };
}

for (const locale of ['fa', 'en'] as const) {
  test(`a learner enrols in a free course and works through the curriculum (${locale})`, async ({ page, browser }) => {
    const api = await apiWithRoles(browser, ['education_manager']);
    const { slug, term } = await publishedCourse(browser, api);

    await signIn(page, locale);
    await page.goto(`/${locale}/academy?q=${term}`);
    const card = page.getByTestId(`course-card-${slug}`);
    await expect(card).toBeVisible();
    await card.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/academy/courses/${slug}$`));
    await expect(page.getByTestId('course-title')).toBeVisible();
    await expect(page.getByTestId('course-curriculum')).toBeVisible();

    // A free course activates immediately and lands on the player.
    await page.getByTestId('course-enroll').click();
    await expect(page).toHaveURL(/\/academy\/learn\//);
    await expect(page.getByTestId('lesson-body')).toBeVisible();

    const main = await page.locator('main').innerText();
    expect(main).not.toMatch(RAW_KEY_PATTERN);
  });
}

test('a later lesson stays locked and delivers no content until its prerequisite is complete', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['education_manager']);
  const { slug, lessonIds } = await publishedCourse(browser, api, 2);
  const [firstLesson, secondLesson] = lessonIds as [string, string];

  await signIn(page, 'en');
  await page.goto(`/en/academy/courses/${slug}`);
  await page.getByTestId('course-enroll').click();
  await expect(page).toHaveURL(/\/academy\/learn\//);

  // The locked lesson is visible in the outline but cannot be opened.
  await expect(page.getByTestId(`lesson-locked-${secondLesson}`)).toBeVisible();
  await expect(page.getByTestId(`lesson-${secondLesson}`)).toBeDisabled();
  // Its body is not in the page at all — the lock is enforced by the payload.
  await expect(page.locator('main')).not.toContainText('Body 2');

  await page.getByTestId(`lesson-${firstLesson}`).click();
  await page.getByTestId('lesson-complete').click();
  await expect(page.getByTestId(`lesson-done-${firstLesson}`)).toBeVisible();
  await expect(page.getByTestId(`lesson-${secondLesson}`)).toBeEnabled();

  await page.getByTestId(`lesson-${secondLesson}`).click();
  await expect(page.getByTestId('lesson-body')).toContainText('Body 2');
});

test('progress survives a reload, and finishing every required lesson completes the course', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['education_manager']);
  const { slug, lessonIds } = await publishedCourse(browser, api, 2);
  const [firstLesson, secondLesson] = lessonIds as [string, string];

  await signIn(page, 'en');
  await page.goto(`/en/academy/courses/${slug}`);
  await page.getByTestId('course-enroll').click();
  await expect(page).toHaveURL(/\/academy\/learn\//);
  const playerUrl = page.url();

  await page.getByTestId(`lesson-${firstLesson}`).click();
  await page.getByTestId('lesson-complete').click();
  await expect(page.getByTestId(`lesson-done-${firstLesson}`)).toBeVisible();

  // EDU-006: a refresh (or a different device) preserves what was recorded.
  await page.goto(playerUrl);
  await expect(page.getByTestId(`lesson-done-${firstLesson}`)).toBeVisible();
  await expect(page.getByTestId('player-progress')).toContainText('1');

  await page.getByTestId(`lesson-${secondLesson}`).click();
  await page.getByTestId('lesson-complete').click();
  await expect(page.getByTestId('player-completed')).toBeVisible();
});

test('a draft course is not discoverable and its detail page is a real 404', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['education_manager']);
  const slug = `draft-course-${uniqueSuffix()}`;
  const created = await api.post('/api/v1/admin/courses', {
    data: { slug, translations: { fa: { title: 'پیش‌نویس' }, en: { title: 'Draft course' } } }
  });
  expect(created.ok()).toBe(true);

  await page.goto('/en/academy');
  await expect(page.getByTestId(`course-card-${slug}`)).toHaveCount(0);
  await page.goto(`/en/academy/courses/${slug}`);
  await expect(page.getByTestId('course-not-found')).toBeVisible();
});

test('a revoked enrolment loses access to the player', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['education_manager']);
  const { slug } = await publishedCourse(browser, api, 1);

  await signIn(page, 'en');
  await page.goto(`/en/academy/courses/${slug}`);
  await page.getByTestId('course-enroll').click();
  await expect(page).toHaveURL(/\/academy\/learn\//);
  const playerUrl = page.url();
  const enrollmentId = playerUrl.split('/').pop() ?? '';

  const revoked = await api.post(`/api/v1/admin/enrollments/${enrollmentId}/revoke`, { data: { reason: 'Revoked during the browser test.' } });
  expect(revoked.ok()).toBe(true);

  await page.goto(playerUrl);
  await expect(page.getByTestId('player-forbidden')).toBeVisible();
  await expect(page.getByTestId('lesson-body')).toHaveCount(0);
});

test('a signed-out visitor sees the course but is asked to sign in before enrolling', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['education_manager']);
  const { slug } = await publishedCourse(browser, api, 1);

  await page.goto(`/en/academy/courses/${slug}`);
  await expect(page.getByTestId('course-title')).toBeVisible();
  await expect(page.getByTestId('course-sign-in')).toBeVisible();
  await expect(page.getByTestId('course-enroll')).toHaveCount(0);
});

test('the education console is guarded, and a manager sees the OD-015 gate', async ({ page, browser }) => {
  const api = await apiWithRoles(browser, ['education_manager']);
  const { slug } = await publishedCourse(browser, api, 1);

  // An ordinary signed-in user sees the forbidden state and no console.
  await signIn(page, 'en');
  await page.goto('/en/admin/courses');
  await expect(page.getByTestId('courses-forbidden')).toBeVisible();
  await expect(page.getByTestId('course-create-form')).toHaveCount(0);

  const managerPage = await (await browser.newContext()).newPage();
  const managerMobile = uniqueMobile();
  await managerPage.goto('/en/auth/mobile');
  await managerPage.locator('#auth-mobile').fill(managerMobile);
  await managerPage.getByTestId('request-code').click();
  await expect(managerPage.getByTestId('code-sent')).toBeVisible();
  const inbox = await managerPage.request.get(`/api/v1/dev/sms-inbox?mobile=${managerMobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await managerPage.locator('#auth-code').fill(code);
  await managerPage.getByTestId('verify-code').click();
  await expect(managerPage).toHaveURL(/\/en\/account(?:\/profile)?$/);
  expect((await managerPage.request.post('/api/v1/dev/grant-role', { data: { mobile: managerMobile, role: 'education_manager' } })).ok()).toBe(true);

  await managerPage.goto('/en/admin/courses');
  await expect(managerPage.getByTestId('admin-course-list')).toBeVisible();
  await expect(managerPage.getByTestId(`admin-course-${slug}`)).toBeVisible();

  // The OD-015 badge must reflect the server's actual gate, never a guess: the browser
  // environment turns paid courses on to exercise the paid journey, so asserting the
  // badge is always present would only prove the test knows its own fixture.
  const config = (await (await managerPage.request.get('/api/v1/admin/courses/config')).json()) as { paidCoursesEnabled: boolean };
  await expect(managerPage.getByTestId('courses-paid-gate')).toHaveCount(config.paidCoursesEnabled ? 0 : 1);

  const main = await managerPage.locator('main').innerText();
  expect(main).not.toMatch(RAW_KEY_PATTERN);
  await managerPage.close();
});
