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

onMounted(async () => {
  if (!loaded.value) await refresh();
});
</script>

<template>
  <section>
    <h1>{{ t('account.heading') }}</h1>

    <StateBlock
      v-if="!loaded"
      variant="loading"
    />

    <template v-else-if="authenticated">
      <p data-testid="account-signed-in">
        {{ t('account.signedIn') }}
      </p>

      <p
        v-if="!profileComplete"
        class="notice"
        data-testid="profile-incomplete"
      >
        {{ t('account.completeProfile') }}
      </p>

      <ul class="links">
        <li>
          <RouterLink :to="`${prefix}/account/profile`">
            {{ t('nav.profile') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink :to="`${prefix}/account/security`">
            {{ t('nav.security') }}
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
.links {
  list-style: none;
  margin-block: var(--space-4);
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.notice {
  padding: var(--space-3);
  border: 1px solid var(--color-warning-text);
  border-radius: var(--radius-md);
  background-color: var(--color-warning-surface);
  color: var(--color-warning-text);
  font-weight: 600;
}

.meta {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
</style>
