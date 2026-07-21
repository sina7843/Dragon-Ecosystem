<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';

// Section 16.4: an authenticated but unauthorized request shows 403. Server-side
// enforcement is mandatory and independent of this page.
const { t } = useI18n();
</script>

<template>
  <section>
    <h1>{{ t('state.forbidden.heading') }}</h1>
    <StateBlock variant="forbidden" />
    <p class="back">
      <RouterLink to="/">
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
