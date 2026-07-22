<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { useAdmin } from '../composables/useAdmin.ts';
import { isLocale } from '../i18n/locale.ts';

/**
 * Administration landing page. The area links are generated from the user's
 * effective permissions (section 9.4); a caller without admin access sees the
 * forbidden state, and the server enforces the same regardless of the UI.
 */
const { t, locale } = useI18n();
const { loaded, forbidden, isSuperAdmin, canReadUsers, canReadAudit, canReadConfig, canWriteContent, canManageGames, canManageTournaments, refresh } =
  useAdmin();

const prefix = computed(() => `/${isLocale(locale.value) ? locale.value : 'fa'}`);

interface Area {
  readonly to: string;
  readonly labelKey: string;
  readonly visible: boolean;
  readonly testid: string;
}

const areas = computed<Area[]>(() =>
  [
    { to: `${prefix.value}/admin/content`, labelKey: 'admin.area.content', visible: canWriteContent.value, testid: 'area-content' },
    { to: `${prefix.value}/admin/games`, labelKey: 'admin.area.games', visible: canManageGames.value, testid: 'area-games' },
    { to: `${prefix.value}/admin/tournaments`, labelKey: 'admin.area.tournaments', visible: canManageTournaments.value, testid: 'area-tournaments' },
    { to: `${prefix.value}/admin/users`, labelKey: 'admin.area.users', visible: canReadUsers.value, testid: 'area-users' },
    { to: `${prefix.value}/admin/audit`, labelKey: 'admin.area.audit', visible: canReadAudit.value, testid: 'area-audit' },
    {
      to: `${prefix.value}/admin/configuration`,
      labelKey: 'admin.area.configuration',
      visible: canReadConfig.value,
      testid: 'area-configuration'
    }
  ].filter((area) => area.visible)
);

onMounted(refresh);
</script>

<template>
  <section>
    <h1>{{ t('admin.heading') }}</h1>

    <StateBlock
      v-if="!loaded"
      variant="loading"
    />

    <StateBlock
      v-else-if="forbidden"
      variant="forbidden"
      data-testid="admin-forbidden"
    />

    <template v-else>
      <p
        v-if="isSuperAdmin"
        class="super"
        data-testid="super-admin-badge"
      >
        {{ t('admin.superAdmin') }}
      </p>

      <nav :aria-label="t('nav.region.admin')">
        <ul class="areas">
          <li
            v-for="area in areas"
            :key="area.to"
          >
            <RouterLink
              :to="area.to"
              :data-testid="area.testid"
            >
              {{ t(area.labelKey) }}
            </RouterLink>
          </li>
        </ul>
      </nav>

      <StateBlock
        v-if="areas.length === 0"
        variant="empty"
        :message="t('admin.noAreas')"
      />
    </template>
  </section>
</template>

<style scoped>
.areas {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
}

.areas a {
  display: block;
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  text-decoration: none;
  font-weight: 600;
}

.super {
  display: inline-block;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background-color: var(--color-warning-surface);
  color: var(--color-warning-text);
  font-weight: 700;
}
</style>
