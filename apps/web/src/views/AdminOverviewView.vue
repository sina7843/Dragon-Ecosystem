<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';

// Administration shell only. Navigation for real modules is generated from
// effective permissions once DRAGON-04 delivers them (section 9.4).
const { t } = useI18n();
</script>

<template>
  <section>
    <h1>{{ t('admin.heading') }}</h1>
    <StateBlock
      variant="empty"
      :message="t('admin.emptyMessage')"
    />
  </section>
</template>
