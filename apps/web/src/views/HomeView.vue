<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

type ApiStatus = 'checking' | 'online' | 'unavailable';

const { t, locale } = useI18n();
const apiStatus = ref<ApiStatus>('checking');

const STATUS_LABEL: Record<ApiStatus, string> = {
  checking: 'home.statusChecking',
  online: 'home.statusOnline',
  unavailable: 'home.statusUnavailable'
};

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
  <section class="home">
    <h1>{{ t('home.heading') }}</h1>
    <p>{{ t('home.intro') }}</p>

    <h2>{{ t('home.statusHeading') }}</h2>
    <dl class="status">
      <dt>{{ t('home.apiLabel') }}</dt>
      <dd
        data-testid="api-status"
        :data-state="apiStatus"
      >
        {{ t(STATUS_LABEL[apiStatus]) }}
      </dd>
      <dt>{{ t('home.localeLabel') }}</dt>
      <dd data-testid="active-locale">
        {{ t(`locale.name.${locale}`) }}
      </dd>
    </dl>
  </section>
</template>

<style scoped>
.home {
  /* Logical properties keep the layout correct in both RTL and LTR (section 17.5). */
  margin-block: 2rem;
  text-align: start;
}

.status {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.5rem 1rem;
  margin-block-start: 1rem;
}

.status dt {
  font-weight: 600;
}

.status dd {
  margin-inline-start: 0;
}
</style>
