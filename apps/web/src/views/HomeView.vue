<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';

type ApiStatus = 'checking' | 'online' | 'unavailable';

const { t, locale } = useI18n();
const apiStatus = ref<ApiStatus>('checking');

// Same-origin call; Vite proxies it in development and nginx proxies it in containers.
onMounted(async () => {
  try {
    const response = await fetch('/api/v1/meta', { headers: { accept: 'application/json' } });
    apiStatus.value = response.ok ? 'online' : 'unavailable';
  } catch {
    apiStatus.value = 'unavailable';
  }
});
</script>

<template>
  <section>
    <h1>{{ t('home.heading') }}</h1>
    <p>{{ t('home.intro') }}</p>

    <h2>{{ t('home.statusHeading') }}</h2>

    <StateBlock
      v-if="apiStatus === 'checking'"
      variant="loading"
    />

    <!-- A failed dependency shows the shared error state, not a silent blank. -->
    <StateBlock
      v-else-if="apiStatus === 'unavailable'"
      variant="error"
      :message="t('home.apiUnavailable')"
    />

    <dl
      v-else
      class="status"
    >
      <dt>{{ t('home.apiLabel') }}</dt>
      <dd
        data-testid="api-status"
        :data-state="apiStatus"
      >
        {{ t('home.statusOnline') }}
      </dd>
      <dt>{{ t('home.localeLabel') }}</dt>
      <dd data-testid="active-locale">
        {{ t(`locale.name.${locale}`) }}
      </dd>
    </dl>
  </section>
</template>

<style scoped>
.status {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-2) var(--space-5);
  margin-block-start: var(--space-4);
}

.status dt {
  font-weight: 600;
}

.status dd {
  margin-inline-start: 0;
}

/* Single column on narrow screens (section 22.2). */
@media (max-width: 374px) {
  .status {
    grid-template-columns: 1fr;
  }
}
</style>
