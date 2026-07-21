<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { localePath } from '../router.ts';
import { isLocale } from '../i18n/locale.ts';

const { t, locale } = useI18n();
const homePath = localePath(isLocale(locale.value) ? locale.value : 'fa');
</script>

<template>
  <section>
    <h1>{{ t('notFound.heading') }}</h1>
    <p>{{ t('notFound.message') }}</p>
    <RouterLink :to="homePath">
      {{ t('notFound.backHome') }}
    </RouterLink>
  </section>
</template>
