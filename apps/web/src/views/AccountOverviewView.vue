<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { useAuth } from '../composables/useAuth.ts';
import { isLocale } from '../i18n/locale.ts';

/**
 * Account landing page. Signed-out visitors are pointed at sign-in rather than
 * shown controls that would fail server-side (section 9.4).
 */
const { t, locale } = useI18n();
const { account, authenticated, profileComplete, loaded, refresh } = useAuth();

const prefix = computed(() => `/${isLocale(locale.value) ? locale.value : 'fa'}`);

const modules = computed(() => [
  { to: `${prefix.value}/account/profile`, label: t('nav.profile') },
  { to: `${prefix.value}/account/wallet`, label: t('nav.wallet') },
  { to: `${prefix.value}/account/teams`, label: t('nav.teams') },
  { to: `${prefix.value}/account/notifications`, label: t('nav.notifications') },
  { to: `${prefix.value}/account/security`, label: t('nav.security') }
]);

onMounted(async () => {
  if (!loaded.value) await refresh();
});
</script>

<template>
  <section>
    <div class="page-header">
      <h1>{{ t('account.heading') }}</h1>
    </div>

    <StateBlock
      v-if="!loaded"
      variant="loading"
    />

    <template v-else-if="authenticated">
      <p
        class="page-lead"
        data-testid="account-signed-in"
      >
        {{ t('account.signedIn') }}
      </p>

      <p
        v-if="!profileComplete"
        class="notice badge badge-warning"
        data-testid="profile-incomplete"
      >
        {{ t('account.completeProfile') }}
      </p>

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

      <p class="meta">
        {{ t('account.timeZone', { timeZone: account?.timeZone ?? '' }) }}
      </p>
    </template>

    <template v-else>
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
.reset-list {
  list-style: none;
  margin: var(--space-4) 0;
  padding: 0;
}

.card-link {
  display: block;
  color: inherit;
  text-decoration: none;
}

.links {
  margin-block: var(--space-4);
}

.notice {
  display: block;
  width: fit-content;
  margin-block-end: var(--space-4);
  padding: var(--space-2) var(--space-3);
}

.meta {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
</style>
