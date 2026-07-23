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
const {
  loaded,
  forbidden,
  isSuperAdmin,
  canReadUsers,
  canReadAudit,
  canReadConfig,
  canWriteContent,
  canManageGames,
  canManageTournaments,
  canManageModeration,
  refresh
} = useAdmin();

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
    { to: `${prefix.value}/admin/moderation`, labelKey: 'admin.area.moderation', visible: canManageModeration.value, testid: 'area-moderation' },
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
    <div class="page-header">
      <div>
        <h1>{{ t('admin.heading') }}</h1>
      </div>
      <div
        v-if="loaded && !forbidden && isSuperAdmin"
        class="page-header-actions"
      >
        <span
          class="status-pill status-pill-warning"
          data-testid="super-admin-badge"
        >{{ t('admin.superAdmin') }}</span>
      </div>
    </div>

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
      <nav :aria-label="t('nav.region.admin')">
        <ul class="areas">
          <li
            v-for="area in areas"
            :key="area.to"
            class="card card-interactive"
          >
            <RouterLink
              class="area-link"
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
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
}

.areas .card {
  padding: 0;
}

.area-link {
  display: block;
  padding: var(--space-4) var(--space-5);
  text-decoration: none;
  font-weight: var(--weight-semibold);
  color: var(--color-text);
}
</style>
