<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { useAuth } from '../composables/useAuth.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import { useAdminAreas } from '../composables/useAdminAreas.ts';
import { isLocale } from '../i18n/locale.ts';

/**
 * Role-aware dashboard (replaces the separate account/admin overview landings).
 * Everyone sees their personal account modules; a caller who holds administrative
 * capabilities also sees an Administration section, generated from the server's
 * effective-permission list (section 9.4). Hiding a control is never the boundary —
 * the server enforces access on every route and API regardless of the menu.
 */
const { t, locale } = useI18n();
const { authenticated, displayName, profileComplete, loaded, refresh } = useAuth();
const { loaded: adminLoaded, isSuperAdmin, refresh: refreshAdmin } = useAdmin();

const prefix = computed(() => `/${isLocale(locale.value) ? locale.value : 'fa'}`);

// Personal modules every signed-in user has.
const modules = computed(() => [
  { to: `${prefix.value}/account/profile`, label: t('nav.profile') },
  { to: `${prefix.value}/account/wallet`, label: t('nav.wallet') },
  { to: `${prefix.value}/account/teams`, label: t('nav.teams') },
  { to: `${prefix.value}/account/gaming-identities`, label: t('nav.gamingIdentities') },
  { to: `${prefix.value}/account/notifications`, label: t('nav.notifications') },
  { to: `${prefix.value}/account/security`, label: t('nav.security') }
]);

// Administration areas come from one shared definition (see useAdminAreas), so this
// dashboard and the /admin landing can never list different areas.
const { areas: adminAreas } = useAdminAreas();

const isStaff = computed(() => adminAreas.value.length > 0 || isSuperAdmin.value);
const roleLabel = computed(() => {
  if (isSuperAdmin.value) return t('admin.superAdmin');
  if (isStaff.value) return t('dashboard.role.staff');
  return t('dashboard.role.player');
});
const greeting = computed(() =>
  displayName.value ? t('dashboard.greeting', { name: displayName.value }) : t('dashboard.greetingAnonymous')
);

onMounted(async () => {
  if (!loaded.value) await refresh();
  // Probe admin capabilities only for a signed-in caller; a non-admin resolves to zero areas.
  if (authenticated.value) await refreshAdmin();
});
</script>

<template>
  <section>
    <StateBlock
      v-if="!loaded"
      variant="loading"
    />

    <template v-else-if="authenticated">
      <div class="dash-header">
        <div>
          <h1>{{ greeting }}</h1>
          <p
            class="page-lead"
            data-testid="account-signed-in"
          >
            {{ t('account.signedIn') }}
          </p>
        </div>
        <span
          class="status-pill"
          :class="isSuperAdmin ? 'status-pill-warning' : isStaff ? 'status-pill-accent' : 'status-pill-neutral'"
          data-testid="dashboard-role"
        >{{ roleLabel }}</span>
      </div>

      <p
        v-if="!profileComplete"
        class="notice badge badge-warning"
        data-testid="profile-incomplete"
      >
        {{ t('account.completeProfile') }}
      </p>

      <h2 class="section-title">
        {{ t('dashboard.personal') }}
      </h2>
      <ul class="card-grid reset-list">
        <li
          v-for="module in modules"
          :key="module.to"
          class="card card-interactive"
        >
          <RouterLink
            class="card-link"
            :to="module.to"
          >
            <h3 class="card-title">
              {{ module.label }}
            </h3>
          </RouterLink>
        </li>
      </ul>

      <template v-if="adminLoaded && isStaff">
        <h2 class="section-title">
          {{ t('admin.heading') }}
        </h2>
        <ul class="card-grid reset-list">
          <li
            v-for="area in adminAreas"
            :key="area.to"
            class="card card-interactive"
          >
            <RouterLink
              class="card-link"
              :to="area.to"
              :data-testid="area.testid"
            >
              <h3 class="card-title">
                {{ area.label }}
              </h3>
            </RouterLink>
          </li>
        </ul>
      </template>
    </template>

    <template v-else>
      <div class="page-header">
        <h1>{{ t('account.heading') }}</h1>
      </div>
      <StateBlock
        variant="empty"
        :message="t('account.signedOutMessage')"
      />
      <p class="links">
        <RouterLink
          class="btn btn-primary"
          :to="`${prefix}/auth/mobile`"
          data-testid="sign-in-link"
        >
          {{ t('nav.signIn') }}
        </RouterLink>
      </p>
    </template>
  </section>
</template>

<style scoped>
.dash-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-block-end: var(--space-5);
}
.dash-header h1 {
  margin: 0;
}
.page-lead {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
}

.section-title {
  margin-block: var(--space-6) var(--space-4);
  font-size: var(--text-lg);
}
.section-title:first-of-type {
  margin-block-start: 0;
}

.reset-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.card-link {
  display: block;
  color: inherit;
  text-decoration: none;
}
.card-title {
  margin: 0;
}

.notice {
  display: block;
  width: fit-content;
  margin-block-end: var(--space-5);
  padding: var(--space-2) var(--space-3);
}

.links {
  margin-block: var(--space-4);
}
</style>
