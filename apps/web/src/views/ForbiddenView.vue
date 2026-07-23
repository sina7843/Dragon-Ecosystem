<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';

// Section 16.4: an authenticated but unauthorized request shows 403. Server-side
// enforcement is mandatory and independent of this page.
const { t } = useI18n();
</script>

<template>
  <section class="gated">
    <h1>{{ t('state.forbidden.heading') }}</h1>
    <StateBlock variant="forbidden" />
    <p class="back">
      <RouterLink
        class="btn btn-primary"
        to="/"
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
