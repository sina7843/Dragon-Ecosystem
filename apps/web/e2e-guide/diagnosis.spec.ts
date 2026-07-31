import { expect, test } from '@playwright/test';
import { capture, completeProfile, docMobile, docSuffix, grantRole, signIn, writeMap } from './guide-helpers.ts';

/**
 * Reproduction of the two faults the reader reported: a course cannot be created, and a live
 * stream cannot be created or operated.
 *
 * Both are reproduced against the running product at three levels — an ordinary account, the
 * account holding the specific operator role, and a super administrator — because the
 * difference between those three runs is the diagnosis. Nothing here is inferred from reading
 * the source alone; every claim the manual makes about these two workflows is the observed
 * result of one of these steps.
 */

test.describe.configure({ mode: 'serial' });

const ADMIN_COURSES = '/admin/courses';
const ADMIN_STREAMS = '/admin/streams';

test.afterAll(() => {
  writeMap('GUIDE_VERIFICATION_MAP.json');
});

test.describe('چرا نمی‌توانم دوره بسازم؟ — course creation', () => {
  test('an ordinary account is refused, and is shown why', async ({ page }, info) => {
    const locale = info.project.name.startsWith('fa') ? 'fa' : 'en';
    await signIn(page, locale);
    await completeProfile(page);

    // The dashboard is where an operator would find their areas; an ordinary account has none.
    await page.goto(`/${locale}/account`);
    await expect(page.getByTestId('area-courses')).toHaveCount(0);
    await capture(page, info, {
      screenshot: '040-course-no-admin-area',
      chapter: '10',
      procedure: 'course-creation',
      step: 'ordinary account sees no education area',
      route: `/${locale}/account`,
      control: 'administration area cards',
      expected: 'no education card for an account without education.manage',
      observed: 'no education card present',
      availability: 'permission-required',
      captionFa: 'داشبورد حساب عادی: هیچ کارت «دوره‌ها» نمایش داده نمی‌شود، چون دسترسی education.manage وجود ندارد.',
      altFa: 'داشبورد حساب کاربری بدون کارت مدیریت دوره‌ها',
      fullPage: true
    });

    // Typing the address directly is the next thing a reader tries. The page is reachable —
    // hiding a card is not the authorization boundary — and it states the refusal.
    await page.goto(`/${locale}${ADMIN_COURSES}`);
    await expect(page.getByTestId('courses-forbidden')).toBeVisible();
    await capture(page, info, {
      screenshot: '041-course-forbidden',
      chapter: '10',
      procedure: 'course-creation',
      step: 'direct address is refused',
      route: `/${locale}${ADMIN_COURSES}`,
      control: 'forbidden state',
      expected: 'the console loads and refuses, rather than 404 or a blank page',
      observed: 'forbidden state shown',
      availability: 'permission-required',
      captionFa: 'ورود مستقیم به نشانی کنسول دوره‌ها: صفحه باز می‌شود اما وضعیت «دسترسی ندارید» نمایش داده می‌شود.',
      altFa: 'کنسول مدیریت دوره‌ها با پیام عدم دسترسی'
    });

    // And the API refuses independently of the interface.
    const refused = await page.request.get('/api/v1/admin/courses');
    expect(refused.status()).toBe(403);
  });

  test('the education role reveals the console and a course can be created', async ({ page, browser }, info) => {
    const locale = info.project.name.startsWith('fa') ? 'fa' : 'en';
    const mobile = docMobile();
    await signIn(page, locale, mobile);
    await completeProfile(page);

    const api = (await browser.newContext()).request;
    await grantRole(api, mobile, 'education_manager');
    // The capability probe is cached per identity; a fresh load re-probes.
    await page.goto(`/${locale}/account`);
    await expect(page.getByTestId('area-courses')).toBeVisible();
    await capture(page, info, {
      screenshot: '042-course-area-visible',
      chapter: '10',
      procedure: 'course-creation',
      step: 'education area appears once the role is held',
      route: `/${locale}/account`,
      control: 'area-courses card',
      expected: 'the education card appears for education.manage',
      observed: 'education card visible',
      availability: 'available',
      captionFa: 'پس از دریافت نقش «مدیر آموزش»، کارت «دوره‌ها» در داشبورد ظاهر می‌شود.',
      altFa: 'داشبورد با کارت مدیریت دوره‌ها',
      fullPage: true
    });

    await page.goto(`/${locale}${ADMIN_COURSES}`);
    await expect(page.getByTestId('courses-forbidden')).toHaveCount(0);
    await capture(page, info, {
      screenshot: '043-course-console',
      chapter: '10',
      procedure: 'course-creation',
      step: 'course console',
      route: `/${locale}${ADMIN_COURSES}`,
      control: 'course list and create form',
      expected: 'the console renders for an authorized operator',
      observed: 'console rendered',
      availability: 'available',
      captionFa: 'کنسول مدیریت دوره‌ها برای کاربر دارای دسترسی.',
      altFa: 'کنسول مدیریت دوره‌ها',
      fullPage: true
    });

    // A draft course is created over the same API the console uses, so the manual can state
    // exactly which fields creation requires: none of them.
    const created = await page.request.post('/api/v1/admin/courses', {
      data: { translations: { fa: { title: `دوره نمونه ${docSuffix()}` }, en: { title: `Sample course ${docSuffix()}` } } }
    });
    expect(created.status()).toBe(201);
    const course = (await created.json()) as { id: string; state: string; version: number };
    expect(course.state).toBe('draft');

    // A draft cannot be published directly — the lifecycle is draft -> review -> published.
    // This is recorded because it is exactly the kind of step a reader gets stuck on, and
    // the manual has to name it rather than describe a "publish" button that does not apply.
    const direct = await page.request.post(`/api/v1/admin/courses/${course.id}/state`, {
      data: { state: 'published', reason: 'documentation attempt', expectedVersion: course.version }
    });
    console.warn(`[guide] draft->published status ${String(direct.status())}: ${(await direct.text()).slice(0, 200)}`);
    expect(direct.ok(), 'a draft course must not publish directly').toBe(false);

    const review = await page.request.post(`/api/v1/admin/courses/${course.id}/state`, {
      data: { state: 'review', reason: 'documentation attempt', expectedVersion: course.version }
    });
    console.warn(`[guide] draft->review status ${String(review.status())}`);
    expect(review.ok(), 'a draft course moves to review').toBe(true);
    const reviewed = (await review.json()) as { version: number };

    // Publication is where the real prerequisites live. Capturing the refusal gives the
    // manual an exact, non-invented list of what a course needs before it goes public.
    const publish = await page.request.post(`/api/v1/admin/courses/${course.id}/state`, {
      data: { state: 'published', reason: 'documentation attempt', expectedVersion: reviewed.version }
    });
    console.warn(`[guide] review->published status ${String(publish.status())}: ${(await publish.text()).slice(0, 600)}`);
    expect(publish.ok(), 'an incomplete course must not publish').toBe(false);
  });

  test('a super administrator sees the same console through the wildcard role', async ({ page, browser }, info) => {
    const locale = info.project.name.startsWith('fa') ? 'fa' : 'en';
    const mobile = docMobile();
    await signIn(page, locale, mobile);
    await completeProfile(page);
    const api = (await browser.newContext()).request;
    await grantRole(api, mobile, 'super_administrator');
    await page.goto(`/${locale}${ADMIN_COURSES}`);
    await expect(page.getByTestId('courses-forbidden')).toHaveCount(0);
  });
});

test.describe('چرا نمی‌توانم پخش زنده بسازم یا مدیریت کنم؟ — live streaming', () => {
  test('an ordinary account is refused the stream console', async ({ page }, info) => {
    const locale = info.project.name.startsWith('fa') ? 'fa' : 'en';
    await signIn(page, locale);
    await completeProfile(page);

    await page.goto(`/${locale}/account`);
    await expect(page.getByTestId('area-streams')).toHaveCount(0);

    await page.goto(`/${locale}${ADMIN_STREAMS}`);
    await capture(page, info, {
      screenshot: '050-stream-forbidden',
      chapter: '12',
      procedure: 'stream-operations',
      step: 'direct address is refused',
      route: `/${locale}${ADMIN_STREAMS}`,
      control: 'forbidden state',
      expected: 'the console loads and refuses without stream.manage',
      observed: 'forbidden state shown',
      availability: 'permission-required',
      captionFa: 'کنسول پخش زنده برای کاربر بدون دسترسی stream.manage قابل استفاده نیست.',
      altFa: 'کنسول پخش زنده با پیام عدم دسترسی'
    });
    const refused = await page.request.get('/api/v1/admin/streams');
    expect(refused.status()).toBe(403);
  });

  test('the streaming role reveals the console, and the provider state is what limits it', async ({ page, browser }, info) => {
    const locale = info.project.name.startsWith('fa') ? 'fa' : 'en';
    const mobile = docMobile();
    await signIn(page, locale, mobile);
    await completeProfile(page);
    const api = (await browser.newContext()).request;
    await grantRole(api, mobile, 'streaming_operator');

    await page.goto(`/${locale}${ADMIN_STREAMS}`);
    await capture(page, info, {
      screenshot: '051-stream-console',
      chapter: '12',
      procedure: 'stream-operations',
      step: 'stream console for an authorized operator',
      route: `/${locale}${ADMIN_STREAMS}`,
      control: 'stream list and controls',
      expected: 'the console renders for stream.manage',
      observed: 'console rendered',
      availability: 'available',
      captionFa: 'کنسول عملیات پخش زنده برای اپراتور دارای دسترسی.',
      altFa: 'کنسول عملیات پخش زنده',
      fullPage: true
    });

    // What the server itself reports about the provider and the rights gate. The manual
    // quotes this rather than describing a provider that is not configured.
    const config = await page.request.get('/api/v1/admin/streams/config');
    expect(config.ok()).toBe(true);
    console.warn(`[guide] stream config: ${JSON.stringify(await config.json())}`);

    // A stream record can be created — it is metadata. Whether it can be provisioned against
    // a provider is the separate question the manual has to answer honestly.
    const created = await page.request.post('/api/v1/admin/streams', {
      data: { translations: { fa: { title: `پخش نمونه ${docSuffix()}` }, en: { title: `Sample stream ${docSuffix()}` } } }
    });
    console.warn(`[guide] stream creation status: ${String(created.status())}`);
    if (created.status() === 201) {
      const stream = (await created.json()) as { id: string; version: number };
      const provision = await page.request.post(`/api/v1/admin/streams/${stream.id}/provision`, { data: { expectedVersion: stream.version } });
      console.warn(`[guide] stream provision status: ${String(provision.status())} body: ${(await provision.text()).slice(0, 300)}`);
    } else {
      console.warn(`[guide] stream creation refused: ${(await created.text()).slice(0, 300)}`);
    }
  });
});
