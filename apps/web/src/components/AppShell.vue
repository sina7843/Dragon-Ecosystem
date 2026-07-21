<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppNav, { type NavItem } from './AppNav.vue';
import LocaleSwitcher from './LocaleSwitcher.vue';
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

const NAV_KEYS: Readonly<Record<ShellVariant, ReadonlyArray<{ path: string; key: string }>>> = {
  public: [
    { path: '', key: 'nav.home' },
    { path: '/design-system', key: 'nav.designSystem' },
    { path: '/account', key: 'nav.account' }
  ],
  account: [
    { path: '/account', key: 'nav.accountOverview' },
    { path: '/account/profile', key: 'nav.profile' },
    { path: '/account/security', key: 'nav.security' },
    { path: '', key: 'nav.home' }
  ],
  admin: [
    { path: '/admin', key: 'nav.adminOverview' },
    { path: '', key: 'nav.home' }
  ]
};

const navItems = computed<NavItem[]>(() =>
  NAV_KEYS[props.variant].map((item) => ({
    to: `${localePrefix.value}${item.path}`,
    label: t(item.key)
  }))
);

const navLabel = computed(() => t(`nav.region.${props.variant}`));
const isAdmin = computed(() => props.variant === 'admin');

const router = useRouter();
const { authenticated, loaded, refresh, signOut } = useAuth();
const { push } = useToasts();

// The shell learns the session state once; views reuse the same store.
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
      <RouterLink
        class="brand"
        :to="localePrefix"
      >
        {{ t('app.name') }}
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
          :to="`${localePrefix}/auth/mobile`"
          data-testid="header-sign-in"
        >
          {{ t('nav.signIn') }}
        </RouterLink>
        <button
          v-else-if="loaded"
          type="button"
          class="sign-out"
          data-testid="header-sign-out"
          @click="onSignOut"
        >
          {{ t('nav.signOut') }}
        </button>

        <LocaleSwitcher />
        <ThemeToggle />
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

.header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-5);
  padding: var(--space-3) var(--space-4);
  border-block-end: 1px solid var(--color-border);
  background-color: var(--color-surface-raised);
}

.brand {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-text);
  text-decoration: none;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  margin-inline-start: auto;
}

.sign-out {
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.main {
  flex: 1;
  inline-size: 100%;
  max-inline-size: 72rem;
  margin-inline: auto;
  padding: var(--space-6) var(--space-4);
}

/* Administration is a denser, wider working surface (section 23.2). */
.admin .main {
  max-inline-size: 90rem;
  padding-block: var(--space-5);
}

.footer {
  padding: var(--space-4);
  border-block-start: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.footer p {
  margin: 0;
}
</style>
