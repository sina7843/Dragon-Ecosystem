import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router';
import AccountOverviewView from './views/AccountOverviewView.vue';
import AccountProfileView from './views/AccountProfileView.vue';
import AccountSecurityView from './views/AccountSecurityView.vue';
import AdminOverviewView from './views/AdminOverviewView.vue';
import AuthMobileView from './views/AuthMobileView.vue';
import DesignSystemView from './views/DesignSystemView.vue';
import ForbiddenView from './views/ForbiddenView.vue';
import HomeView from './views/HomeView.vue';
import NotFoundView from './views/NotFoundView.vue';
import { applyDocumentLocale, i18n, persistLocale } from './i18n/index.ts';
import { isLocale, type Locale } from './i18n/locale.ts';
import { applyHead } from './head.ts';
import type { ShellVariant } from './components/AppShell.vue';

declare module 'vue-router' {
  interface RouteMeta {
    /** Which application shell wraps the view (section 9). */
    shell: ShellVariant;
    /** SEO-008: account, admin, and utility pages must not be indexed. */
    indexable: boolean;
    titleKey: string;
  }
}

function activeLocale(): Locale {
  const current = i18n.global.locale.value;
  return isLocale(current) ? current : 'fa';
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // The locale prefix keeps direct URL refresh working for every route (TEST-017).
    { path: '/', redirect: () => `/${activeLocale()}` },
    {
      path: '/:locale(fa|en)',
      name: 'home',
      component: HomeView,
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.home' }
    },
    {
      path: '/:locale(fa|en)/design-system',
      name: 'design-system',
      component: DesignSystemView,
      meta: { shell: 'public', indexable: false, titleKey: 'meta.title.designSystem' }
    },
    {
      path: '/:locale(fa|en)/auth/mobile',
      name: 'auth-mobile',
      component: AuthMobileView,
      meta: { shell: 'public', indexable: false, titleKey: 'meta.title.signIn' }
    },
    {
      path: '/:locale(fa|en)/account',
      name: 'account',
      component: AccountOverviewView,
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.account' }
    },
    {
      path: '/:locale(fa|en)/account/profile',
      name: 'account-profile',
      component: AccountProfileView,
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.profile' }
    },
    {
      path: '/:locale(fa|en)/account/security',
      name: 'account-security',
      component: AccountSecurityView,
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.security' }
    },
    {
      path: '/:locale(fa|en)/admin',
      name: 'admin',
      component: AdminOverviewView,
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.admin' }
    },
    {
      path: '/:locale(fa|en)/403',
      name: 'forbidden',
      component: ForbiddenView,
      meta: { shell: 'public', indexable: false, titleKey: 'meta.title.forbidden' }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFoundView,
      meta: { shell: 'public', indexable: false, titleKey: 'meta.title.notFound' }
    }
  ]
});

/** Keeps the active locale, document direction, and stored preference in sync with the URL. */
router.beforeEach((to: RouteLocationNormalized) => {
  const requested = to.params['locale'];
  const locale = isLocale(requested) ? requested : activeLocale();
  if (i18n.global.locale.value !== locale) i18n.global.locale.value = locale;
  applyDocumentLocale(locale);
  persistLocale(locale);
});

// Title, canonical, hreflang, and indexability follow the resolved route.
router.afterEach((to: RouteLocationNormalized) => {
  const locale = isLocale(to.params['locale']) ? (to.params['locale'] as Locale) : activeLocale();
  applyHead({
    title: `${i18n.global.t(to.meta.titleKey)} — ${i18n.global.t('app.name')}`,
    locale,
    path: to.fullPath,
    indexable: to.meta.indexable
  });
});

/** Same route, different locale — preserves the current location while switching (I18N-007). */
export function localePath(locale: Locale): string {
  const current = router.currentRoute.value;
  if (current.name !== null && current.name !== undefined && 'locale' in current.params) {
    return router.resolve({ name: current.name, params: { ...current.params, locale } }).fullPath;
  }
  return `/${locale}`;
}
