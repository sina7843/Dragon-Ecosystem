import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router';
import HomeView from './views/HomeView.vue';
import NotFoundView from './views/NotFoundView.vue';
import { applyDocumentLocale, i18n, persistLocale } from './i18n/index.ts';
import { isLocale, type Locale } from './i18n/locale.ts';

function activeLocale(): Locale {
  const current = i18n.global.locale.value;
  return isLocale(current) ? current : 'fa';
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // The locale prefix keeps direct URL refresh working for every route (TEST-017).
    { path: '/', redirect: () => `/${activeLocale()}` },
    { path: '/:locale(fa|en)', name: 'home', component: HomeView },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView }
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

/** Same route, different locale — preserves the current location while switching (I18N-007). */
export function localePath(locale: Locale): string {
  const current = router.currentRoute.value;
  if (current.name !== null && current.name !== undefined && 'locale' in current.params) {
    return router.resolve({ name: current.name, params: { ...current.params, locale } }).fullPath;
  }
  return `/${locale}`;
}
