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
  <section class="gated">
    <h1>{{ t('state.notFound.heading') }}</h1>
    <StateBlock variant="notFound" />
    <p class="back">
      <RouterLink
        class="btn btn-primary"
        :to="homePath"
      >
        {{ t('state.notFound.action') }}
      </RouterLink>
    </p>
  </section>
</template>

<style scoped>
.gated {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-5);
  padding-block: var(--space-8);
}

.back {
  margin: 0;
}
</style>
