<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { localePath } from '../router.ts';
import { SUPPORTED_LOCALES, type Locale } from '../i18n/locale.ts';

// I18N-005 and I18N-007: switch language at runtime while staying on the same route.
const { t, locale } = useI18n();

function isActive(candidate: Locale): boolean {
  return locale.value === candidate;
}
</script>

<template>
  <nav
    class="locale-switcher"
    :aria-label="t('locale.switcherLabel')"
  >
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
</template>

<style scoped>
.locale-switcher {
  display: flex;
  gap: var(--space-1);
}

/* Matches the design's compact header controls: bordered chips, violet when current. */
a {
  display: inline-flex;
  align-items: center;
  padding-inline: var(--space-3);
  min-block-size: var(--target-min);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  text-decoration: none;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-text-muted);
}

a:hover {
  color: var(--color-text);
  background-color: var(--color-surface-sunken);
}

a[aria-current='true'] {
  font-weight: var(--weight-black);
  color: var(--color-accent);
  background-color: var(--color-primary-soft);
  border-color: var(--color-border-strong);
}
</style>
