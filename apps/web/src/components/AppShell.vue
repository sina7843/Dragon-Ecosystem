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
    { path: '/tournaments', key: 'nav.tournaments' },
    { path: '/streams', key: 'nav.streams' },
    { path: '/academy', key: 'nav.academy' },
    // The team and player directories existed only as detail URLs until now; without a
    // nav entry nothing on the site linked to them at all.
    { path: '/teams', key: 'nav.teamsDirectory' },
    { path: '/players', key: 'nav.playersDirectory' }
  ],
  account: [
    { path: '/account', key: 'nav.dashboard' },
    { path: '/account/profile', key: 'nav.profile' },
    { path: '/account/teams', key: 'nav.teams' },
    { path: '/account/registrations', key: 'nav.registrations' },
    { path: '/account/matches', key: 'nav.matches' },
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
          <!-- Global search sits with the other chrome controls: reachable from every
               page without taking a slot in the primary navigation. -->
          <RouterLink
            class="icon-btn"
            :to="`${localePrefix}/search`"
            :aria-label="t('search.global.heading')"
            :title="t('search.global.heading')"
            data-testid="global-search-link"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle
                cx="11"
                cy="11"
                r="7"
              />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </RouterLink>
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

/* The chrome is a chamfered HUD plate floating over the ambient field, lit along
   its top edge, rather than a full-bleed band pinned to the viewport. */
.header {
  position: sticky;
  inset-block-start: 0;
  z-index: var(--z-nav);
  padding: var(--space-3) clamp(var(--space-4), 4vw, var(--space-6));
}

.header-bar {
  --hud-cut: var(--hud-cut-md);
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-5);
  inline-size: 100%;
  max-inline-size: var(--shell-max);
  margin-inline: auto;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-raised);
  clip-path: polygon(
    0 0,
    100% 0,
    100% calc(100% - var(--hud-cut)),
    calc(100% - var(--hud-cut)) 100%,
    var(--hud-cut) 100%,
    0 calc(100% - var(--hud-cut))
  );
  background-image:
    linear-gradient(135deg, transparent calc(50% - 1px), var(--plate-edge) calc(50% - 1px) 50%, transparent 50%),
    linear-gradient(45deg, transparent calc(50% - 1px), var(--plate-edge) calc(50% - 1px) 50%, transparent 50%);
  background-size: var(--hud-cut) var(--hud-cut);
  background-position: bottom right, bottom left;
  background-repeat: no-repeat;
  box-shadow: var(--glass-highlight), var(--shadow-lg);
}

/* The bracket seam starts here: a gold run along the leading half of the bar. */
.header-bar::before {
  content: '';
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  inline-size: min(9rem, 34%);
  block-size: var(--seam-width);
  background-color: var(--color-accent);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text);
  text-decoration: none;
}

.brand-mark {
  --hud-cut: 0.5rem;
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 2.5rem;
  block-size: 2.5rem;
  clip-path: polygon(
    0 0,
    100% 0,
    100% calc(100% - var(--hud-cut)),
    calc(100% - var(--hud-cut)) 100%,
    var(--hud-cut) 100%,
    0 calc(100% - var(--hud-cut))
  );
  background: var(--gradient-brand);
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
  gap: 0.15rem;
  line-height: 1.15;
  text-align: start;
}

.brand-name {
  font-family: var(--font-display);
  font-variation-settings: 'wdth' var(--display-width);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-tight);
}
[lang='fa'] .brand-name {
  font-family: var(--font-sans);
  font-variation-settings: normal;
  letter-spacing: normal;
  font-size: var(--text-md);
}

.brand-tagline {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--color-text-muted);
}
[lang='fa'] .brand-tagline {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  letter-spacing: normal;
  text-transform: none;
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

/* Matches the theme and locale controls beside it, so the chrome row reads as one set. */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 2.625rem;
  block-size: 2.625rem;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-sunken);
  color: var(--color-text);
  transition:
    color var(--motion-fast) var(--motion-ease),
    background-color var(--motion-fast) var(--motion-ease),
    border-color var(--motion-fast) var(--motion-ease);
}
.icon-btn:hover {
  color: var(--color-accent);
  background-color: var(--color-primary-soft);
  border-color: var(--color-accent);
}
.icon-btn svg {
  inline-size: 1.15rem;
  block-size: 1.15rem;
}

.profile-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding-inline: var(--space-1) var(--space-3);
  block-size: 2.625rem;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-sunken);
  color: var(--color-text);
  text-decoration: none;
  transition:
    border-color var(--motion-fast) var(--motion-ease),
    background-color var(--motion-fast) var(--motion-ease);
}
.profile-chip:hover {
  border-color: var(--color-accent);
  background-color: var(--color-primary-soft);
}
.profile-avatar {
  display: grid;
  place-items: center;
  inline-size: 1.875rem;
  block-size: 1.875rem;
  border-radius: var(--radius-sm);
  background: var(--gradient-brand);
  color: var(--color-primary-text);
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
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
  --hud-cut: var(--hud-cut-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-raised);
  clip-path: polygon(
    0 0,
    100% 0,
    100% calc(100% - var(--hud-cut)),
    calc(100% - var(--hud-cut)) 100%,
    var(--hud-cut) 100%,
    0 calc(100% - var(--hud-cut))
  );
  background-image:
    linear-gradient(135deg, transparent calc(50% - 1px), var(--plate-edge) calc(50% - 1px) 50%, transparent 50%),
    linear-gradient(45deg, transparent calc(50% - 1px), var(--plate-edge) calc(50% - 1px) 50%, transparent 50%);
  background-size: var(--hud-cut) var(--hud-cut);
  background-position: bottom right, bottom left;
  background-repeat: no-repeat;
  box-shadow: var(--glass-highlight), var(--shadow-md);
}

.rail-link {
  display: flex;
  align-items: center;
  padding: var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
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
  font-weight: var(--weight-bold);
  background-color: var(--color-primary-soft);
  border-color: var(--color-border-strong);
  /* Non-colour cue: a lit marker on the leading edge (section 23.2). */
  box-shadow: inset 0.2rem 0 0 var(--color-accent);
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
    box-shadow: inset 0 -0.2rem 0 var(--color-accent);
  }
}

/* The footer closes the page on the same lapis plate, capped by the gold seam. */
.footer {
  position: relative;
  margin-block-start: var(--space-7);
  padding: var(--space-7) clamp(var(--space-4), 4vw, var(--space-6)) var(--space-6);
  border-block-start: 1px solid var(--color-border);
  background-color: var(--color-surface-sunken);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.footer::before {
  content: '';
  position: absolute;
  inset-block-start: -1px;
  inset-inline-start: 0;
  inline-size: 6rem;
  block-size: var(--seam-width);
  background-color: var(--color-accent);
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
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--color-text-soft);
}
[lang='fa'] .footer-heading {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  letter-spacing: normal;
  text-transform: none;
}

.footer-tagline {
  margin: 0;
  padding-block-start: var(--space-4);
  border-block-start: 1px solid var(--color-border);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}
[lang='fa'] .footer-tagline {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  letter-spacing: normal;
  text-transform: none;
}
</style>
