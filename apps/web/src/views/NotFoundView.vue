<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { localePath } from '../router.ts';
import { isLocale } from '../i18n/locale.ts';

// SEO-010: a not-found page must offer useful localized navigation.
const { t, locale } = useI18n();
const homePath = localePath(isLocale(locale.value) ? locale.value : 'fa');
</script>

<template>
  <section>
    <h1>{{ t('state.notFound.heading') }}</h1>
    <StateBlock variant="notFound" />
    <p class="back">
      <RouterLink :to="homePath">
        {{ t('state.notFound.action') }}
      </RouterLink>
    </p>
  </section>
</template>

<style scoped>
.back {
  margin-block-start: var(--space-4);
}
</style>
