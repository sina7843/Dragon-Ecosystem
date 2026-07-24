<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppNav, { type NavItem } from './AppNav.vue';
import LocaleSwitcher from './LocaleSwitcher.vue';
import SkipLink from './SkipLink.vue';
import ThemeToggle from './ThemeToggle.vue';
import ToastRegion from './ToastRegion.vue';
import { useAuth } from '../composables/useAuth.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import { useToasts } from '../composables/useToasts.ts';
import { isLocale } from '../i18n/locale.ts';

/**
 * Shared application shell for the public, account, and administration areas
 * (Requirements sections 9.4 and 22.2).
 *
 * Navigation is generated per area. Administration uses compact density. Hidden
 * menu items never substitute for server-side authorization (section 9.4); this
 * shell renders chrome only.
 */
export type ShellVariant = 'public' | 'account' | 'admin';

const props = defineProps<{ variant: ShellVariant }>();

const { t, locale } = useI18n();

const localePrefix = computed(() => `/${isLocale(locale.value) ? locale.value : 'fa'}`);

const NAV_KEYS: Readonly<Record<ShellVariant, ReadonlyArray<{ path: string; key: string }>>> = {
  public: [
    { path: '', key: 'nav.home' },
    { path: '/content', key: 'nav.content' },
    { path: '/games', key: 'nav.games' },
    { path: '/tournaments', key: 'nav.tournaments' },
    { path: '/account', key: 'nav.account' }
  ],
  account: [
    { path: '/account', key: 'nav.accountOverview' },
    { path: '/account/profile', key: 'nav.profile' },
    { path: '/account/teams', key: 'nav.teams' },
    { path: '/account/gaming-identities', key: 'nav.gamingIdentities' },
    { path: '/account/wallet', key: 'nav.wallet' },
    { path: '/account/notifications', key: 'nav.notifications' },
    { path: '/account/security', key: 'nav.security' },
    { path: '', key: 'nav.home' }
  ],
  admin: [
    { path: '/admin', key: 'nav.adminOverview' },
    { path: '', key: 'nav.home' }
  ]
};

// An admin link appears in the public/account chrome once the caller is confirmed to
// hold at least one administrative capability. This is convenience only — the server
// enforces access on every /admin route and API regardless of what the menu shows.
const canAdmin = computed(
  () =>
    authenticated.value &&
    !adminForbidden.value &&
    (isSuperAdmin.value ||
      canReadUsers.value ||
      canReadAudit.value ||
      canReadConfig.value ||
      canWriteContent.value ||
      canManageGames.value ||
      canManageTournaments.value ||
      canManageModeration.value)
);

const navItems = computed<NavItem[]>(() => {
  const items = NAV_KEYS[props.variant].map((item) => ({
    to: `${localePrefix.value}${item.path}`,
    label: t(item.key)
  }));
  if (props.variant !== 'admin' && canAdmin.value) {
    items.push({ to: `${localePrefix.value}/admin`, label: t('nav.adminOverview') });
  }
  return items;
});

const navLabel = computed(() => t(`nav.region.${props.variant}`));
const isAdmin = computed(() => props.variant === 'admin');

const router = useRouter();
const { authenticated, loaded, refresh, signOut } = useAuth();
const {
  refresh: refreshAdmin,
  forbidden: adminForbidden,
  isSuperAdmin,
  canReadUsers,
  canReadAudit,
  canReadConfig,
  canWriteContent,
  canManageGames,
  canManageTournaments,
  canManageModeration
} = useAdmin();
const { push } = useToasts();

// The shell learns the session state once; views reuse the same store. Admin
// capabilities are probed only for a signed-in caller.
onMounted(async () => {
  if (!loaded.value) await refresh();
  if (authenticated.value) await refreshAdmin();
});

// A later sign-in (without a full reload) still reveals the admin entry.
watch(authenticated, (isAuth) => {
  if (isAuth) void refreshAdmin();
});

async function onSignOut(): Promise<void> {
  await signOut();
  push('info', t('auth.signedOut'));
  await router.push(localePrefix.value);
}
</script>

<template>
  <div :class="['shell', props.variant]">
    <SkipLink />

    <header class="header">
      <div class="header-bar">
        <RouterLink
          class="brand"
          :to="localePrefix"
        >
          <span
            class="brand-mark"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 2l2.6 5.5L21 8.3l-4.5 4.2 1.2 6.1L12 15.8 6.3 18.6l1.2-6.1L3 8.3l6.4-.8z" />
            </svg>
          </span>
          <span class="brand-text">
            <span class="brand-name">{{ t('app.name') }}</span>
            <span class="brand-tagline">{{ t('app.tagline') }}</span>
          </span>
        </RouterLink>

        <AppNav
          :items="navItems"
          :region-label="navLabel"
          :open-label="t('nav.openMenu')"
          :close-label="t('nav.closeMenu')"
          :dense="isAdmin"
        />

        <div class="controls">
          <RouterLink
            v-if="loaded && !authenticated"
            class="btn btn-primary"
            :to="`${localePrefix}/auth/mobile`"
            data-testid="header-sign-in"
          >
            {{ t('nav.signIn') }}
          </RouterLink>
          <button
            v-else-if="loaded"
            type="button"
            class="btn btn-neutral"
            data-testid="header-sign-out"
            @click="onSignOut"
          >
            {{ t('nav.signOut') }}
          </button>

          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>

    <!-- tabindex allows the skip link to move focus here (A11Y-013). -->
    <main
      id="main-content"
      class="main"
      tabindex="-1"
    >
      <slot />
    </main>

    <footer class="footer">
      <p>{{ t('app.tagline') }}</p>
    </footer>

    <ToastRegion />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-block-size: 100vh;
}

/* The design floats the chrome as a rounded glass bar over the ambient field,
   rather than pinning a full-bleed band to the viewport edge. */
.header {
  position: sticky;
  inset-block-start: 0;
  z-index: var(--z-nav);
  padding: var(--space-3) clamp(var(--space-4), 4vw, var(--space-6));
}

.header-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-5);
  inline-size: 100%;
  max-inline-size: var(--shell-max);
  margin-inline: auto;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-md);
}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .header-bar {
    background-color: var(--glass-bg);
    border-color: var(--glass-border);
    -webkit-backdrop-filter: blur(var(--glass-blur));
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--glass-highlight), var(--shadow-lg);
  }
}
@media (prefers-reduced-transparency: reduce) {
  .header-bar {
    background-color: var(--color-surface);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text);
  text-decoration: none;
}

.brand-mark {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 2.5rem;
  block-size: 2.5rem;
  border-radius: var(--radius-md);
  background: var(--color-primary-strong);
  color: var(--color-primary-text);
  box-shadow: var(--glow-primary);
}

.brand-mark svg {
  inline-size: 1.375rem;
  block-size: 1.375rem;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
  text-align: start;
}

.brand-name {
  font-size: var(--text-md);
  font-weight: var(--weight-black);
  letter-spacing: var(--tracking-tight);
}

.brand-tagline {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--color-text-muted);
}

/* One line of chrome is enough; the tagline is decorative on narrow screens. */
@media (max-width: 480px) {
  .brand-tagline {
    display: none;
  }
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-inline-start: auto;
}

.main {
  flex: 1;
  inline-size: 100%;
  max-inline-size: var(--shell-max);
  margin-inline: auto;
  padding: clamp(var(--space-5), 4vw, var(--space-7)) clamp(var(--space-4), 4vw, var(--space-6))
    var(--space-8);
}

/* Administration is a denser, wider working surface (section 23.2). */
.admin .main {
  max-inline-size: 96rem;
  padding-block: var(--space-5);
}

.footer {
  margin-block-start: var(--space-6);
  padding: var(--space-5) clamp(var(--space-4), 4vw, var(--space-6));
  border-block-start: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.footer p {
  max-inline-size: var(--shell-max);
  margin: 0 auto;
}
</style>
