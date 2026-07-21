<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { localePath } from './router.ts';
import { SUPPORTED_LOCALES, type Locale } from './i18n/locale.ts';

const { t, locale } = useI18n();

function isActive(candidate: Locale): boolean {
  return locale.value === candidate;
}
</script>

<template>
  <div class="shell">
    <header>
      <p class="brand">
        {{ t('app.name') }}
      </p>
      <p class="tagline">
        {{ t('app.tagline') }}
      </p>

      <nav :aria-label="t('locale.switcherLabel')">
        <RouterLink
          v-for="option in SUPPORTED_LOCALES"
          :key="option"
          :to="localePath(option)"
          :lang="option"
          :aria-current="isActive(option) ? 'true' : undefined"
          :data-testid="`locale-link-${option}`"
        >
          {{ t(`locale.name.${option}`) }}
        </RouterLink>
      </nav>
    </header>

    <main>
      <RouterView />
    </main>
  </div>
</template>

<style>
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
  line-height: 1.6;
}

body {
  margin: 0;
}

.shell {
  max-inline-size: 60rem;
  margin-inline: auto;
  padding-inline: 1.5rem;
  padding-block: 2rem;
}

header nav {
  display: flex;
  gap: 1rem;
  margin-block-start: 1rem;
}

header nav a[aria-current='true'] {
  font-weight: 700;
  text-decoration: none;
}

.brand {
  font-size: 1.5rem;
  font-weight: 700;
  margin-block: 0;
}

.tagline {
  margin-block: 0.25rem 0;
  opacity: 0.8;
}
</style>
