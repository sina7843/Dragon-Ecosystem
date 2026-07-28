import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router';
// Public routes are eagerly imported (they are the crawlable, first-paint surface).
// Admin and account routes are lazily imported below so an anonymous public visitor
// never downloads privileged/personalized code (bundle: disabled/gated code is split out).
import AuthMobileView from './views/AuthMobileView.vue';
import ContentListView from './views/ContentListView.vue';
import ContentDetailView from './views/ContentDetailView.vue';
import GamesCatalogView from './views/GamesCatalogView.vue';
import GameDetailView from './views/GameDetailView.vue';
import PublicTeamView from './views/PublicTeamView.vue';
import TeamsDirectoryView from './views/TeamsDirectoryView.vue';
import PlayersDirectoryView from './views/PlayersDirectoryView.vue';
import TournamentsListView from './views/TournamentsListView.vue';
import TournamentCalendarView from './views/TournamentCalendarView.vue';
import TournamentDetailView from './views/TournamentDetailView.vue';
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
      component: ContentDetailView,
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
      component: GameDetailView,
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
      component: TournamentCalendarView,
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.tournaments' }
    },
    {
      path: '/:locale(fa|en)/tournaments/:slug',
      name: 'tournament-detail',
      component: TournamentDetailView,
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.tournaments' }
    },
    // The directories come before their detail routes so `/teams` is not swallowed by
    // `/teams/:slug`. Both are crawlable index pages over the existing search endpoints.
    {
      path: '/:locale(fa|en)/teams',
      name: 'teams',
      component: TeamsDirectoryView,
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.teams' }
    },
    {
      path: '/:locale(fa|en)/teams/:slug',
      name: 'public-team',
      component: PublicTeamView,
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.teams' }
    },
    {
      path: '/:locale(fa|en)/players',
      name: 'players',
      component: PlayersDirectoryView,
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.players' }
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
    {
      path: '/:locale(fa|en)/players/:username',
      name: 'public-player',
      component: () => import('./views/PublicPlayerView.vue'),
      meta: { shell: 'public', indexable: true, titleKey: 'meta.title.player' }
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

let firstNavigation = true;

// Title, canonical, hreflang, and indexability follow the resolved route.
router.afterEach((to: RouteLocationNormalized) => {
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
  if (firstNavigation) {
    firstNavigation = false;
    return;
  }
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
