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
    <!-- Globe marks this as the language control; the codes stay reachable for a11y + tests. -->
    <span
      class="globe"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
        />
        <path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" />
      </svg>
    </span>
    <RouterLink
      v-for="option in SUPPORTED_LOCALES"
      :key="option"
      :to="localePath(option)"
      :lang="option"
      class="code"
      :aria-current="isActive(option) ? 'true' : undefined"
      :data-testid="`locale-link-${option}`"
    >
      {{ option.toUpperCase() }}
    </RouterLink>
  </nav>
</template>

<style scoped>
/* A single compact pill: globe icon plus the two language codes as a segmented toggle. */
.locale-switcher {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding-inline: var(--space-2);
  block-size: 2.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-overlay);
}

.globe {
  display: inline-flex;
  color: var(--color-text-muted);
}
.globe svg {
  inline-size: 1.05rem;
  block-size: 1.05rem;
}

.code {
  display: inline-flex;
  align-items: center;
  padding-inline: var(--space-2);
  block-size: 1.875rem;
  border-radius: var(--radius-sm);
  text-decoration: none;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: 0.02em;
  color: var(--color-text-muted);
  transition:
    color var(--motion-fast) var(--motion-ease),
    background-color var(--motion-fast) var(--motion-ease);
}
.code:hover {
  color: var(--color-text);
}
.code[aria-current='true'] {
  color: var(--color-accent);
  background-color: var(--color-primary-soft);
}
</style>
