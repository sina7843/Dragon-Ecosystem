<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';

// The account area exists as a shell. No account module is enabled yet, so the
// page shows an honest empty state rather than placeholder controls that do
// nothing (section 32.2).
const { t } = useI18n();
</script>

<template>
  <section>
    <h1>{{ t('account.heading') }}</h1>
    <StateBlock
      variant="empty"
      :message="t('account.emptyMessage')"
    />
  </section>
</template>
