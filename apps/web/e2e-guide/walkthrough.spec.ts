import { expect, test, type Page } from '@playwright/test';
import { capture, completeProfile, docMobile, grantRole, signIn, writeMap } from './guide-helpers.ts';

/**
 * Walkthrough capture for the manual: the public site, the account area, and each operator
 * console, followed as a reader would follow them.
 *
 * Every figure is taken from the running product in the shipped fail-closed configuration,
 * and every step records the state it actually observed. Where a capability is closed by a
 * feature gate, a provider, or an unresolved decision, the closed state is what gets captured
 * — the manual is meant to show the reader the platform they have, not one they do not.
 */

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  writeMap('GUIDE_VERIFICATION_MAP.json');
});

const localeOf = (project: string): 'fa' | 'en' => (project.startsWith('fa') ? 'fa' : 'en');

/**
 * Waits for the page to settle so a figure never captures a half-rendered view.
 *
 * Deliberately not `networkidle`: several pages poll, so that state never arrives and the
 * wait simply consumed the whole test budget. The heading is the real signal that the view
 * has rendered, and the short settle afterwards lets transitions finish before the shot.
 */
async function settled(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(250);
}

test.describe('عمومی — public surfaces', () => {
  const PUBLIC_PAGES: ReadonlyArray<{ id: string; path: string; chapter: string; captionFa: string; altFa: string }> = [
    { id: '002-home', path: '', chapter: '3', captionFa: 'صفحه نخست اکوسیستم دراگون.', altFa: 'صفحه نخست' },
    { id: '003-games', path: '/games', chapter: '7', captionFa: 'فهرست بازی‌های منتشرشده.', altFa: 'فهرست بازی‌ها' },
    { id: '004-content', path: '/content', chapter: '7', captionFa: 'بخش محتوا و اخبار.', altFa: 'فهرست محتوا' },
    { id: '005-tournaments', path: '/tournaments', chapter: '8', captionFa: 'فهرست تورنمنت‌های عمومی.', altFa: 'فهرست تورنمنت‌ها' },
    { id: '006-streams', path: '/streams', chapter: '12', captionFa: 'فهرست پخش‌های زنده.', altFa: 'فهرست پخش زنده' },
    { id: '007-academy', path: '/academy', chapter: '11', captionFa: 'کاتالوگ دوره‌های آموزشی منتشرشده.', altFa: 'کاتالوگ آکادمی' },
    { id: '008-community', path: '/community', chapter: '14', captionFa: 'خوراک جامعه کاربری.', altFa: 'خوراک جامعه' },
    { id: '009-store', path: '/store', chapter: '15', captionFa: 'کاتالوگ فروشگاه.', altFa: 'کاتالوگ فروشگاه' },
    { id: '010-teams', path: '/teams', chapter: '6', captionFa: 'فهرست تیم‌های عمومی.', altFa: 'فهرست تیم‌ها' },
    { id: '011-players', path: '/players', chapter: '6', captionFa: 'فهرست بازیکنان عمومی.', altFa: 'فهرست بازیکنان' },
    { id: '012-search', path: '/search', chapter: '7', captionFa: 'جست‌وجوی سراسری.', altFa: 'جست‌وجو' },
    { id: '013-help', path: '/help', chapter: '18', captionFa: 'صفحه راهنما و ثبت درخواست پشتیبانی.', altFa: 'صفحه راهنما' }
  ];

  for (const p of PUBLIC_PAGES) {
    test(`public page ${p.id}`, async ({ page }, info) => {
      const locale = localeOf(info.project.name);
      await page.goto(`/${locale}${p.path}`);
      await settled(page);
      await capture(page, info, {
        screenshot: p.id,
        chapter: p.chapter,
        procedure: 'public-browsing',
        step: `visit /${locale}${p.path}`,
        route: `/${locale}${p.path}`,
        control: 'page content',
        expected: 'the page renders for an anonymous visitor',
        observed: 'rendered',
        availability: 'available',
        captionFa: p.captionFa,
        altFa: p.altFa,
        fullPage: true
      });
    });
  }
});

test.describe('ورود و حساب کاربری — sign-in and account', () => {
  test('sign-in screen', async ({ page }, info) => {
    const locale = localeOf(info.project.name);
    await page.goto(`/${locale}/auth/mobile`);
    await settled(page);
    await capture(page, info, {
      screenshot: '001-login',
      chapter: '2',
      procedure: 'sign-in',
      step: 'open the sign-in screen',
      route: `/${locale}/auth/mobile`,
      control: 'mobile number field',
      expected: 'a one-time-code sign-in form',
      observed: 'form rendered',
      availability: 'available',
      captionFa: 'ورود با شماره موبایل و رمز یک‌بارمصرف.',
      altFa: 'فرم ورود با شماره موبایل'
    });
  });

  const ACCOUNT_PAGES: ReadonlyArray<{ id: string; path: string; chapter: string; captionFa: string; altFa: string }> = [
    { id: '020-account-overview', path: '/account', chapter: '5', captionFa: 'داشبورد حساب کاربری.', altFa: 'داشبورد حساب' },
    { id: '021-account-profile', path: '/account/profile', chapter: '5', captionFa: 'ویرایش پروفایل کاربر.', altFa: 'صفحه پروفایل' },
    { id: '022-account-security', path: '/account/security', chapter: '5', captionFa: 'تنظیمات امنیتی و نشست‌ها.', altFa: 'تنظیمات امنیتی' },
    { id: '023-account-wallet', path: '/account/wallet', chapter: '16', captionFa: 'کیف پول و موجودی دراگون‌کوین.', altFa: 'کیف پول' },
    { id: '024-account-notifications', path: '/account/notifications', chapter: '20', captionFa: 'صندوق اعلان‌های درون‌برنامه‌ای.', altFa: 'اعلان‌ها' },
    { id: '025-account-teams', path: '/account/teams', chapter: '6', captionFa: 'تیم‌های کاربر.', altFa: 'تیم‌های من' },
    { id: '026-account-registrations', path: '/account/registrations', chapter: '9', captionFa: 'ثبت‌نام‌های تورنمنت و تاریخچه وضعیت.', altFa: 'ثبت‌نام‌های من' },
    { id: '027-account-matches', path: '/account/matches', chapter: '9', captionFa: 'برنامه مسابقات کاربر.', altFa: 'مسابقه‌های من' },
    { id: '028-account-orders', path: '/account/orders', chapter: '15', captionFa: 'سفارش‌های فروشگاه.', altFa: 'سفارش‌ها' },
    { id: '029-account-identities', path: '/account/gaming-identities', chapter: '6', captionFa: 'شناسه‌های بازی کاربر.', altFa: 'شناسه‌های بازی' }
  ];

  test('account pages', async ({ page }, info) => {
    const locale = localeOf(info.project.name);
    await signIn(page, locale);
    await completeProfile(page);
    for (const p of ACCOUNT_PAGES) {
      await page.goto(`/${locale}${p.path}`);
      await settled(page);
      await capture(page, info, {
        screenshot: p.id,
        chapter: p.chapter,
        procedure: 'account',
        step: `visit /${locale}${p.path}`,
        route: `/${locale}${p.path}`,
        control: 'page content',
        expected: 'the page renders for a signed-in account',
        observed: 'rendered',
        availability: 'available',
        captionFa: p.captionFa,
        altFa: p.altFa,
        fullPage: true
      });
    }
  });
});

/**
 * Operator consoles, each captured while holding exactly the role that reveals it.
 *
 * One account per console, rather than one super administrator for all of them: the manual's
 * whole point about roles is that they are separate, and a wildcard account would hide the
 * boundary the reader needs to understand.
 */
test.describe('کنسول‌های اپراتوری — operator consoles', () => {
  const CONSOLES: ReadonlyArray<{
    id: string;
    path: string;
    role: string;
    permission: string;
    chapter: string;
    captionFa: string;
    altFa: string;
  }> = [
    { id: '030-admin-overview', path: '/admin', role: 'platform_administrator', permission: 'admin.access', chapter: '19', captionFa: 'صفحه فرود بخش مدیریت با کارت‌های مجاز.', altFa: 'صفحه مدیریت' },
    { id: '031-admin-users', path: '/admin/users', role: 'platform_administrator', permission: 'users.read', chapter: '19', captionFa: 'فهرست کاربران با داده‌های پوشانده‌شده. توجه: در این نسخه رابط تخصیص نقش وجود ندارد.', altFa: 'مدیریت کاربران' },
    { id: '032-admin-audit', path: '/admin/audit', role: 'security_auditor', permission: 'audit.read', chapter: '19', captionFa: 'گزارش ممیزی رویدادها.', altFa: 'ممیزی' },
    { id: '033-admin-tournaments', path: '/admin/tournaments', role: 'tournament_administrator', permission: 'tournament.manage', chapter: '8', captionFa: 'کنسول مدیریت تورنمنت‌ها.', altFa: 'مدیریت تورنمنت' },
    { id: '034-admin-organizer', path: '/admin/organizer', role: 'tournament_organizer', permission: 'tournament.manage', chapter: '8', captionFa: 'میز کار برگزارکننده.', altFa: 'میز کار برگزارکننده' },
    { id: '035-admin-content', path: '/admin/content', role: 'content_publisher', permission: 'content.write', chapter: '7', captionFa: 'کنسول محتوا.', altFa: 'مدیریت محتوا' },
    { id: '036-admin-games', path: '/admin/games', role: 'content_publisher', permission: 'games.manage', chapter: '7', captionFa: 'کنسول بازی‌ها.', altFa: 'مدیریت بازی‌ها' },
    { id: '037-admin-media', path: '/admin/media', role: 'content_publisher', permission: 'content.publish', chapter: '21', captionFa: 'کتابخانه رسانه.', altFa: 'کتابخانه رسانه' },
    { id: '052-admin-chat', path: '/admin/chat', role: 'live_chat_moderator', permission: 'chat.moderate', chapter: '13', captionFa: 'کنسول تعدیل گفت‌وگوی زنده.', altFa: 'تعدیل گفت‌وگو' },
    { id: '060-admin-store', path: '/admin/store', role: 'shop_operator', permission: 'store.manage', chapter: '15', captionFa: 'کنسول فروشگاه و کاتالوگ.', altFa: 'مدیریت فروشگاه' },
    { id: '061-admin-orders', path: '/admin/orders', role: 'shop_operator', permission: 'store.manage', chapter: '15', captionFa: 'عملیات سفارش‌ها.', altFa: 'مدیریت سفارش‌ها' },
    { id: '070-admin-finance', path: '/admin/finance', role: 'finance_operator', permission: 'finance.manage', chapter: '17', captionFa: 'کنسول مالی.', altFa: 'کنسول مالی' },
    { id: '071-admin-prizes', path: '/admin/prizes', role: 'finance_operator', permission: 'finance.manage', chapter: '17', captionFa: 'تسویه جوایز.', altFa: 'تسویه جوایز' },
    { id: '080-admin-moderation', path: '/admin/moderation', role: 'community_moderator', permission: 'moderation.manage', chapter: '19', captionFa: 'صف تعدیل محتوا.', altFa: 'تعدیل محتوا' },
    { id: '081-admin-community', path: '/admin/community', role: 'community_moderator', permission: 'moderation.manage', chapter: '14', captionFa: 'تعدیل جامعه کاربری.', altFa: 'تعدیل جامعه' },
    { id: '082-admin-support', path: '/admin/support', role: 'support_operator', permission: 'support.manage', chapter: '18', captionFa: 'صف درخواست‌های پشتیبانی.', altFa: 'پشتیبانی' },
    { id: '083-admin-notifications', path: '/admin/notifications', role: 'support_operator', permission: 'support.manage', chapter: '20', captionFa: 'قالب‌ها و ارسال اعلان‌ها.', altFa: 'اعلان‌ها' },
    { id: '084-admin-operations', path: '/admin/operations', role: 'support_operator', permission: 'support.manage', chapter: '19', captionFa: 'داشبورد عملیات، هشدارها و سنجه‌ها.', altFa: 'عملیات' },
    { id: '085-admin-configuration', path: '/admin/configuration', role: 'platform_administrator', permission: 'config.read', chapter: '19', captionFa: 'پیشنهاد و تأیید پیکربندی.', altFa: 'پیکربندی' }
  ];

  for (const c of CONSOLES) {
    test(`console ${c.id}`, async ({ page, browser }, info) => {
      const locale = localeOf(info.project.name);
      const mobile = docMobile();
      await signIn(page, locale, mobile);
      await completeProfile(page);
      const api = (await browser.newContext()).request;
      await grantRole(api, mobile, c.role);

      await page.goto(`/${locale}${c.path}`);
      await settled(page);
      await capture(page, info, {
        screenshot: c.id,
        chapter: c.chapter,
        procedure: 'operator-console',
        step: `open ${c.path} while holding ${c.role}`,
        route: `/${locale}${c.path}`,
        control: 'console content',
        expected: `renders for ${c.permission}`,
        observed: 'rendered',
        availability: 'available',
        captionFa: c.captionFa,
        altFa: c.altFa,
        fullPage: true
      });
    });
  }
});

/**
 * The gated and refused states.
 *
 * These are as important to the manual as the working ones: a reader who cannot tell a
 * missing permission from a closed feature gate will keep looking for a button that is not
 * going to appear.
 */
test.describe('حالت‌های محدودشده — gated and refused states', () => {
  test('paid course controls are closed under OD-015', async ({ page, browser }, info) => {
    const locale = localeOf(info.project.name);
    const mobile = docMobile();
    await signIn(page, locale, mobile);
    await completeProfile(page);
    const api = (await browser.newContext()).request;
    await grantRole(api, mobile, 'education_manager');

    await page.goto(`/${locale}/admin/courses`);
    await settled(page);
    // The console states the gate itself; capturing it is how the manual proves the claim.
    const config = await page.request.get('/api/v1/admin/courses/config');
    expect(config.ok()).toBe(true);
    const view = (await config.json()) as Record<string, unknown>;
    expect(view['paidCoursesEnabled'], 'the shipped default keeps paid courses closed').toBe(false);
    await capture(page, info, {
      screenshot: '044-course-paid-gated',
      chapter: '10',
      procedure: 'course-creation',
      step: 'paid course access model is gated',
      route: `/${locale}/admin/courses`,
      control: 'paid access model',
      expected: 'paid courses closed while OD-015 is unresolved',
      observed: 'paidCoursesEnabled=false reported by the server',
      availability: 'feature-gated',
      captionFa: 'در پیکربندی پیش‌فرض، دوره پولی تا تأیید سیاست OD-015 غیرفعال است.',
      altFa: 'نشان غیرفعال بودن دوره پولی',
      fullPage: true
    });
  });

  test('stream rights and provider state are reported by the server', async ({ page, browser }, info) => {
    const locale = localeOf(info.project.name);
    const mobile = docMobile();
    await signIn(page, locale, mobile);
    await completeProfile(page);
    const api = (await browser.newContext()).request;
    await grantRole(api, mobile, 'streaming_operator');

    const config = await page.request.get('/api/v1/admin/streams/config');
    expect(config.ok()).toBe(true);
    const view = (await config.json()) as { provider: string; rightsPolicyApproved: boolean };
    // The two facts the streaming chapter rests on, asserted rather than assumed.
    expect(view.provider, 'the build ships the deterministic stub provider').toBe('stub');
    expect(view.rightsPolicyApproved, 'OD-014 keeps archive and takedown closed').toBe(false);

    await page.goto(`/${locale}/admin/streams`);
    await settled(page);
    await capture(page, info, {
      screenshot: '053-stream-provider-state',
      chapter: '12',
      procedure: 'stream-operations',
      step: 'provider and rights gate state',
      route: `/${locale}/admin/streams`,
      control: 'stream console',
      expected: 'stub provider, rights policy not approved',
      observed: `provider=${view.provider}, rightsPolicyApproved=${String(view.rightsPolicyApproved)}`,
      availability: 'provider-unavailable',
      captionFa: 'ارائه‌دهنده پیکربندی‌شده «stub» است؛ این یک شبیه‌سازی قطعی است و پخش واقعی نیست.',
      altFa: 'کنسول پخش زنده با ارائه‌دهنده آزمایشی',
      fullPage: true
    });
  });

  test('an ordinary account is refused every operator console it types in', async ({ page }, info) => {
    const locale = localeOf(info.project.name);
    await signIn(page, locale);
    await completeProfile(page);
    // One representative refusal is captured; the rest are asserted, because the manual
    // states this holds for the whole administration surface rather than for one page.
    for (const path of ['/admin/users', '/admin/finance', '/admin/store', '/admin/operations']) {
      await page.goto(`/${locale}${path}`);
      await expect(page.getByTestId(/state-forbidden|forbidden/).first()).toBeVisible({ timeout: 15_000 });
    }
    await capture(page, info, {
      screenshot: '090-forbidden-generic',
      chapter: '4',
      procedure: 'permissions',
      step: 'operator consoles refuse an ordinary account',
      route: `/${locale}/admin/operations`,
      control: 'forbidden state',
      expected: 'every console refuses without its permission',
      observed: 'forbidden state on each console tried',
      availability: 'permission-required',
      captionFa: 'همه کنسول‌های اپراتوری برای حساب بدون مجوز، وضعیت «دسترسی مجاز نیست» نشان می‌دهند.',
      altFa: 'وضعیت عدم دسترسی در کنسول عملیات'
    });
  });
});
