<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import AppNav, { type NavItem } from './AppNav.vue';
import LocaleSwitcher from './LocaleSwitcher.vue';
import PartnersStrip from './PartnersStrip.vue';
import SkipLink from './SkipLink.vue';
import ThemeToggle from './ThemeToggle.vue';
import ToastRegion from './ToastRegion.vue';
import { useAuth } from '../composables/useAuth.ts';
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

// The public bar no longer carries an "Account" text link (the profile chip on the
// right is the entry point), and neither the account nor admin area shows a separate
// "overview" entry — the role-aware dashboard at /account is the single landing.
const NAV_KEYS: Readonly<Record<ShellVariant, ReadonlyArray<{ path: string; key: string }>>> = {
  public: [
    { path: '', key: 'nav.home' },
    { path: '/content', key: 'nav.content' },
    { path: '/games', key: 'nav.games' },
    { path: '/tournaments', key: 'nav.tournaments' }
  ],
  account: [
    { path: '/account', key: 'nav.dashboard' },
    { path: '/account/profile', key: 'nav.profile' },
    { path: '/account/teams', key: 'nav.teams' },
    { path: '/account/gaming-identities', key: 'nav.gamingIdentities' },
    { path: '/account/wallet', key: 'nav.wallet' },
    { path: '/account/notifications', key: 'nav.notifications' },
    { path: '/account/security', key: 'nav.security' },
    { path: '', key: 'nav.home' }
  ],
  admin: [
    { path: '/account', key: 'nav.dashboard' },
    { path: '', key: 'nav.home' }
  ]
};

const navItems = computed<NavItem[]>(() =>
  NAV_KEYS[props.variant].map((item) => ({
    to: `${localePrefix.value}${item.path}`,
    label: t(item.key)
  }))
);

// The profile chip shows the signed-in user's name; its initial doubles as an avatar.
const profileInitial = computed(() => (displayName.value ?? '?').trim().charAt(0).toUpperCase());

const navLabel = computed(() => t(`nav.region.${props.variant}`));
const isAdmin = computed(() => props.variant === 'admin');

const router = useRouter();
const route = useRoute();
// Re-keying <main> per route replays its entrance animation on every navigation.
const pageKey = computed(() => route.fullPath);
const { authenticated, displayName, profile, loaded, refresh, signOut } = useAuth();
const avatarUrl = computed(() => profile.value?.avatarUrl ?? null);
const { push } = useToasts();

// The shell learns the session state once; views reuse the same store. The role-aware
// dashboard probes admin capabilities itself, so the chrome no longer needs them.
onMounted(async () => {
  if (!loaded.value) await refresh();
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

        <!-- The account area moves its navigation into a side rail below, so the top
             bar stays a clean brand + controls row there. -->
        <AppNav
          v-if="props.variant !== 'account'"
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
          <template v-else-if="loaded">
            <!-- Profile chip: avatar initial + name, links to the role-aware dashboard. -->
            <RouterLink
              class="profile-chip"
              :to="`${localePrefix}/account`"
              data-testid="header-profile"
            >
              <img
                v-if="avatarUrl"
                class="profile-avatar profile-avatar-img"
                :src="avatarUrl"
                :alt="displayName ?? ''"
              >
              <span
                v-else
                class="profile-avatar"
                aria-hidden="true"
              >{{ profileInitial }}</span>
              <span
                v-if="displayName"
                class="profile-name"
              >{{ displayName }}</span>
              <span
                v-else
                class="profile-name"
              >{{ t('nav.dashboard') }}</span>
            </RouterLink>
            <button
              type="button"
              class="btn btn-neutral"
              data-testid="header-sign-out"
              @click="onSignOut"
            >
              {{ t('nav.signOut') }}
            </button>
          </template>

          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>

    <div :class="['shell-body', { 'with-rail': props.variant === 'account' }]">
      <!-- Account navigation as a vertical side rail (a column menu), not a top bar. -->
      <aside
        v-if="props.variant === 'account'"
        class="side-rail"
      >
        <nav
          class="rail-nav"
          :aria-label="navLabel"
        >
          <RouterLink
            v-for="item in navItems"
            :key="item.to"
            class="rail-link"
            :to="item.to"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
      </aside>

      <!-- tabindex allows the skip link to move focus here (A11Y-013).
           Keyed by route so the page-enter animation replays on navigation. -->
      <main
        id="main-content"
        :key="pageKey"
        class="main page-view"
        tabindex="-1"
      >
        <slot />
      </main>
    </div>

    <footer class="footer">
      <div class="footer-inner">
        <section
          class="footer-partners"
          :aria-label="t('partners.heading')"
        >
          <h2 class="footer-heading">
            {{ t('partners.heading') }}
          </h2>
          <PartnersStrip variant="footer" />
        </section>
        <p class="footer-tagline">
          {{ t('app.tagline') }}
        </p>
      </div>
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

.profile-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding-inline: var(--space-1) var(--space-3);
  block-size: 2.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-overlay);
  color: var(--color-text);
  text-decoration: none;
  transition: border-color var(--motion-fast) var(--motion-ease);
}
.profile-chip:hover {
  border-color: var(--color-border-strong);
}
.profile-avatar {
  display: grid;
  place-items: center;
  inline-size: 1.875rem;
  block-size: 1.875rem;
  border-radius: var(--radius-sm);
  background-color: var(--color-primary-strong);
  color: var(--color-primary-text);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}
.profile-avatar-img {
  object-fit: cover;
}
.profile-name {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  max-inline-size: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The name is decoration next to the avatar on the tightest screens. */
@media (max-width: 560px) {
  .profile-name {
    display: none;
  }
}

.shell-body {
  flex: 1;
  display: flex;
  flex-direction: column;
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

/* Gentle fade + rise as each new page mounts (keyed by route above). */
.page-view {
  animation: page-enter var(--motion-slow) var(--motion-ease) both;
}
@keyframes page-enter {
  from {
    opacity: 0;
    transform: translateY(0.625rem);
  }
}
@media (prefers-reduced-motion: reduce) {
  .page-view {
    animation: none;
  }
}

/* ---- Account area: vertical side rail (column menu) beside the content ---- */
.shell-body.with-rail {
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr);
  gap: clamp(var(--space-4), 3vw, var(--space-6));
  inline-size: 100%;
  max-inline-size: var(--shell-max);
  margin-inline: auto;
  padding: clamp(var(--space-5), 4vw, var(--space-7)) clamp(var(--space-4), 4vw, var(--space-6))
    var(--space-8);
  align-items: start;
}
.with-rail .main {
  max-inline-size: none;
  margin-inline: 0;
  padding: 0;
}

.side-rail {
  position: sticky;
  inset-block-start: 6rem;
}
.rail-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-sm);
}
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .rail-nav {
    background-color: var(--glass-bg);
    border-color: var(--glass-border);
    -webkit-backdrop-filter: blur(var(--glass-blur));
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--glass-highlight), var(--shadow-md);
  }
}

.rail-link {
  display: flex;
  align-items: center;
  padding: var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  text-decoration: none;
  color: var(--color-text-soft);
  font-weight: var(--weight-semibold);
  font-size: var(--text-sm);
  min-block-size: var(--target-min);
  transition:
    color var(--motion-fast) var(--motion-ease),
    background-color var(--motion-fast) var(--motion-ease),
    border-color var(--motion-fast) var(--motion-ease);
}
.rail-link:hover {
  color: var(--color-text);
  background-color: var(--color-surface-sunken);
}
.rail-link.router-link-active {
  color: var(--color-accent);
  font-weight: var(--weight-black);
  background-color: var(--color-primary-soft);
  border-color: var(--color-border-strong);
  /* Non-colour cue: a lit marker on the leading edge (section 23.2). */
  box-shadow: inset 0.2rem 0 0 var(--color-primary);
}

/* Below the laptop breakpoint the rail sits above the content as a horizontal,
   scrollable strip so it never eats the narrow viewport. */
@media (max-width: 1023px) {
  .shell-body.with-rail {
    display: block;
  }
  .side-rail {
    position: static;
    margin-block-end: var(--space-5);
  }
  .rail-nav {
    flex-direction: row;
    overflow-x: auto;
    padding: var(--space-2);
  }
  .rail-link {
    flex: none;
    white-space: nowrap;
  }
  .rail-link.router-link-active {
    box-shadow: inset 0 -0.2rem 0 var(--color-primary);
  }
}

.footer {
  margin-block-start: var(--space-6);
  padding: var(--space-6) clamp(var(--space-4), 4vw, var(--space-6));
  border-block-start: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.footer-inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  max-inline-size: var(--shell-max);
  margin: 0 auto;
}

.footer-heading {
  margin: 0 0 var(--space-3);
  font-size: var(--text-md);
  color: var(--color-text);
}

.footer-tagline {
  margin: 0;
  padding-block-start: var(--space-4);
  border-block-start: 1px solid var(--color-border);
}
</style>
