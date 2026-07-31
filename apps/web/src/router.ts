import { createRouter, createWebHistory, START_LOCATION, type RouteLocationNormalized } from 'vue-router';
// The primary public funnel — home and the list pages — is eagerly imported: it is the
// crawlable first-paint surface a visitor actually lands on. The *detail* pages are lazy:
// they are reached by a deliberate click or a direct link, never as the first paint of a
// browsing session, and TournamentDetailView alone is the largest view in the app. Keeping
// them in the entry chunk cost real headroom against the build budget for no benefit. Admin and account
// routes are lazy so an anonymous visitor never downloads privileged/personalized code.
// The secondary public surfaces (the team/player directories, the calendar view of the
// tournament list, the streams pages) are lazy too: they are reached by a deliberate
// click from the funnel above, and keeping them out of the entry chunk is what holds the
// bundle budget in `build-budget.test.ts`.
import ContentListView from './views/ContentListView.vue';
import GamesCatalogView from './views/GamesCatalogView.vue';
import TournamentsListView from './views/TournamentsListView.vue';
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
      component: () => import('./views/DesignSystemView.vue'),
      meta: { shell: 'public', indexable: false, titleKey: 'meta.title.designSystem' }
    },
    {
      path: '/:locale(fa|en)/content',
      name: 'content',
      component: ContentListView,
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.content' }
    },
    {
      path: '/:locale(fa|en)/content/:type/:slug',
      name: 'content-detail',
      component: () => import('./views/ContentDetailView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.content' }
    },
    {
      path: '/:locale(fa|en)/games',
      name: 'games',
      component: GamesCatalogView,
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.games' }
    },
    {
      path: '/:locale(fa|en)/games/:slug',
      name: 'game-detail',
      component: () => import('./views/GameDetailView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.games' }
    },
    {
      path: '/:locale(fa|en)/tournaments',
      name: 'tournaments',
      component: TournamentsListView,
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.tournaments' }
    },
    {
      path: '/:locale(fa|en)/tournaments-calendar',
      name: 'tournaments-calendar',
      component: () => import('./views/TournamentCalendarView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.tournaments' }
    },
    {
      path: '/:locale(fa|en)/tournaments/:slug',
      name: 'tournament-detail',
      component: () => import('./views/TournamentDetailView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.tournaments' }
    },
    // The directories come before their detail routes so `/teams` is not swallowed by
    // `/teams/:slug`. Both are crawlable index pages over the existing search endpoints.
    {
      path: '/:locale(fa|en)/teams',
      name: 'teams',
      component: () => import('./views/TeamsDirectoryView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.teams' }
    },
    {
      path: '/:locale(fa|en)/teams/:slug',
      name: 'public-team',
      component: () => import('./views/PublicTeamView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.teams' }
    },
    {
      path: '/:locale(fa|en)/players',
      name: 'players',
      component: () => import('./views/PlayersDirectoryView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.players' }
    },
    // Stream discovery and the watch page are crawlable, but they are a secondary
    // surface rather than the first-paint landing, and the public entry chunk is close
    // to its budget — so they are lazy like the other non-landing routes.
    {
      path: '/:locale(fa|en)/streams',
      name: 'streams',
      component: () => import('./views/StreamsListView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.streams' }
    },
    {
      path: '/:locale(fa|en)/streams/:slug',
      name: 'stream-detail',
      component: () => import('./views/StreamDetailView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.streams' }
    },
    // Academy: the catalog and course detail are crawlable; the player is a personalized
    // surface and is never indexed. All lazy, like the other non-landing routes.
    {
      path: '/:locale(fa|en)/academy',
      name: 'academy',
      component: () => import('./views/AcademyCatalogView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.academy' }
    },
    {
      path: '/:locale(fa|en)/academy/courses/:slug',
      name: 'course-detail',
      component: () => import('./views/CourseDetailView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.academy' }
    },
    {
      path: '/:locale(fa|en)/academy/learn/:enrollmentId',
      name: 'course-player',
      component: () => import('./views/CoursePlayerView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.academy' }
    },
    // Store: the catalog and product pages are crawlable public pages; the cart, checkout,
    // and orders are personalized and never indexed.
    {
      path: '/:locale(fa|en)/store',
      name: 'store',
      component: () => import('./views/StoreCatalogView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.store' }
    },
    {
      path: '/:locale(fa|en)/store/products/:slug',
      name: 'store-product',
      component: () => import('./views/StoreProductView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.store' }
    },
    {
      path: '/:locale(fa|en)/cart',
      name: 'cart',
      component: () => import('./views/CartView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.cart' }
    },
    {
      path: '/:locale(fa|en)/checkout',
      name: 'checkout',
      component: () => import('./views/CheckoutView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.checkout' }
    },
    {
      path: '/:locale(fa|en)/account/orders',
      name: 'account-orders',
      component: () => import('./views/AccountOrdersView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.orders' }
    },
    // A participant's own registrations and fixtures (PAGE-017, PAGE-018). Session-only
    // and never indexed: both are a single account's private record.
    {
      path: '/:locale(fa|en)/account/registrations',
      name: 'account-registrations',
      component: () => import('./views/AccountRegistrationsView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.registrations' }
    },
    {
      path: '/:locale(fa|en)/account/matches',
      name: 'account-matches',
      component: () => import('./views/AccountMatchesView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.matches' }
    },
    // Community: a personalized, session-only surface. Never indexed — a feed is assembled
    // per viewer from their follows, so there is no stable public page to crawl.
    {
      path: '/:locale(fa|en)/community',
      name: 'community',
      component: () => import('./views/CommunityFeedView.vue'),
      meta: { shell: 'public', indexable: false, titleKey: 'meta.title.community' }
    },
    {
      path: '/:locale(fa|en)/community/posts/:id',
      name: 'community-post',
      component: () => import('./views/CommunityPostView.vue'),
      meta: { shell: 'public', indexable: false, titleKey: 'meta.title.community' }
    },
    {
      // Global search is a utility surface, not a landing page: it must not be indexed,
      // and for the same reason it is not part of the first-paint bundle — an anonymous
      // visitor landing on an article should not download it.
      path: '/:locale(fa|en)/search',
      name: 'search',
      component: () => import('./views/SearchView.vue'),
      meta: { shell: 'public', indexable: false, titleKey: 'meta.title.search' }
    },
    // Public help and support entry point (PAGE-023). Indexable: it is a genuine public
    // page, unlike the personalized account surfaces around it.
    {
      path: '/:locale(fa|en)/help',
      name: 'help',
      component: () => import('./views/HelpView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.help' }
    },
    {
      path: '/:locale(fa|en)/players/:username',
      name: 'public-player',
      component: () => import('./views/PublicPlayerView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.player' }
    },
    {
      path: '/:locale(fa|en)/auth/mobile',
      name: 'auth-mobile',
      // Never a landing page and never indexed: a deliberate click from the chrome.
      component: () => import('./views/AuthMobileView.vue'),
      meta: { shell: 'public', indexable: false, titleKey: 'meta.title.signIn' }
    },
    {
      path: '/:locale(fa|en)/account',
      name: 'account',
      component: () => import('./views/AccountOverviewView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.account' }
    },
    {
      path: '/:locale(fa|en)/account/profile',
      name: 'account-profile',
      component: () => import('./views/AccountProfileView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.profile' }
    },
    {
      path: '/:locale(fa|en)/account/security',
      name: 'account-security',
      component: () => import('./views/AccountSecurityView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.security' }
    },
    {
      path: '/:locale(fa|en)/account/wallet',
      name: 'account-wallet',
      component: () => import('./views/AccountWalletView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.wallet' }
    },
    {
      path: '/:locale(fa|en)/account/notifications',
      name: 'account-notifications',
      component: () => import('./views/NotificationsInboxView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.notifications' }
    },
    {
      path: '/:locale(fa|en)/account/teams',
      name: 'account-teams',
      component: () => import('./views/TeamsView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.teams' }
    },
    {
      path: '/:locale(fa|en)/account/teams/:id',
      name: 'account-team-detail',
      component: () => import('./views/TeamDetailView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.teams' }
    },
    {
      path: '/:locale(fa|en)/account/gaming-identities',
      name: 'account-gaming-identities',
      component: () => import('./views/GamingIdentitiesView.vue'),
      meta: { shell: 'account', indexable: false, titleKey: 'meta.title.gamingIdentities' }
    },
    {
      path: '/:locale(fa|en)/admin',
      name: 'admin',
      component: () => import('./views/AdminOverviewView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.admin' }
    },
    {
      path: '/:locale(fa|en)/admin/users',
      name: 'admin-users',
      component: () => import('./views/AdminUsersView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminUsers' }
    },
    {
      path: '/:locale(fa|en)/admin/audit',
      name: 'admin-audit',
      component: () => import('./views/AdminAuditView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminAudit' }
    },
    {
      path: '/:locale(fa|en)/admin/moderation',
      name: 'admin-moderation',
      component: () => import('./views/AdminModerationView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminModeration' }
    },
    {
      path: '/:locale(fa|en)/admin/courses',
      name: 'admin-courses',
      component: () => import('./views/AdminCoursesView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminCourses' }
    },
    {
      path: '/:locale(fa|en)/admin/chat',
      name: 'admin-chat',
      component: () => import('./views/AdminChatView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminChat' }
    },
    {
      path: '/:locale(fa|en)/admin/streams',
      name: 'admin-streams',
      component: () => import('./views/AdminStreamsView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminStreams' }
    },
    {
      path: '/:locale(fa|en)/admin/prizes',
      name: 'admin-prizes',
      component: () => import('./views/AdminPrizesView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminPrizes' }
    },
    {
      path: '/:locale(fa|en)/admin/store',
      name: 'admin-store',
      component: () => import('./views/AdminStoreView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminStore' }
    },
    {
      path: '/:locale(fa|en)/admin/orders',
      name: 'admin-orders',
      component: () => import('./views/AdminOrdersView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminOrders' }
    },
    {
      path: '/:locale(fa|en)/admin/community',
      name: 'admin-community',
      component: () => import('./views/AdminCommunityView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminCommunity' }
    },
    {
      path: '/:locale(fa|en)/admin/media',
      name: 'admin-media',
      component: () => import('./views/AdminMediaView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminMedia' }
    },
    {
      path: '/:locale(fa|en)/admin/configuration',
      name: 'admin-configuration',
      component: () => import('./views/AdminConfigurationView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminConfiguration' }
    },
    {
      path: '/:locale(fa|en)/admin/notifications',
      name: 'admin-notifications',
      component: () => import('./views/AdminNotificationsView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminNotifications' }
    },
    {
      path: '/:locale(fa|en)/admin/organizer',
      name: 'admin-organizer',
      component: () => import('./views/OrganizerWorkspaceView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminOrganizer' }
    },
    {
      path: '/:locale(fa|en)/admin/finance',
      name: 'admin-finance',
      component: () => import('./views/AdminFinanceView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminFinance' }
    },
    {
      path: '/:locale(fa|en)/admin/support',
      name: 'admin-support',
      component: () => import('./views/AdminSupportView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminSupport' }
    },
    {
      path: '/:locale(fa|en)/admin/operations',
      name: 'admin-operations',
      component: () => import('./views/AdminOperationsView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminOperations' }
    },
    {
      path: '/:locale(fa|en)/admin/content',
      name: 'admin-content',
      component: () => import('./views/AdminContentView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminContent' }
    },
    {
      path: '/:locale(fa|en)/admin/games',
      name: 'admin-games',
      component: () => import('./views/AdminGamesView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminGames' }
    },
    {
      path: '/:locale(fa|en)/admin/tournaments',
      name: 'admin-tournaments',
      component: () => import('./views/AdminTournamentsView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminTournaments' }
    },
    {
      path: '/:locale(fa|en)/admin/tournaments/:id/registrations',
      name: 'admin-tournament-registrations',
      component: () => import('./views/AdminTournamentRegistrationsView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminTournaments' }
    },
    {
      path: '/:locale(fa|en)/admin/tournaments/:id/competition',
      name: 'admin-tournament-competition',
      component: () => import('./views/AdminTournamentCompetitionView.vue'),
      meta: { shell: 'admin', indexable: false, titleKey: 'meta.title.adminTournaments' }
    },
    {
      path: '/:locale(fa|en)/403',
      name: 'forbidden',
      component: () => import('./views/ForbiddenView.vue'),
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

/**
 * Keeps the active locale, document direction, and stored preference in sync with the URL.
 *
 * Deliberately synchronous: `<main>` is keyed on the full path, so an async guard would
 * move the remount after the browser has settled focus on a same-page `#main-content`
 * jump and silently break the skip link.
 */
router.beforeEach((to: RouteLocationNormalized) => {
  const requested = to.params['locale'];
  const locale = isLocale(requested) ? requested : activeLocale();
  if (i18n.global.locale.value !== locale) i18n.global.locale.value = locale;
  applyDocumentLocale(locale);
  persistLocale(locale);
});

// Title, canonical, hreflang, and indexability follow the resolved route.
router.afterEach((to: RouteLocationNormalized, from: RouteLocationNormalized) => {
  const locale = isLocale(to.params['locale']) ? (to.params['locale'] as Locale) : activeLocale();
  applyHead({
    title: `${i18n.global.t(to.meta.titleKey)} — ${i18n.global.t('app.name')}`,
    locale,
    path: to.fullPath,
    indexable: to.meta.indexable
  });
  // A11Y: move focus to the main landmark on a client-side navigation so keyboard and
  // screen-reader users land on the new page context instead of the stale focused link
  // (or <body>). Skipped on the first load, where no prior focus exists to correct, and
  // deferred until the new view has rendered. This fires only on real route changes, not
  // on background/polling updates, so focus is never yanked mid-task.
  //
  // The initial load is identified by vue-router's own START_LOCATION rather than by
  // counting navigations: a counter also depends on *when* the app mounts, and once the
  // mount was deferred behind the locale bundle it started swallowing the first real
  // navigation instead — which is the skip link, whose whole job is to move focus here.
  if (from === START_LOCATION) return;
  const document = globalThis.document;
  if (document === undefined) return;
  requestAnimationFrame(() => {
    const main = document.getElementById('main-content');
    main?.focus({ preventScroll: false });
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
