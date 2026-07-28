<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTheme } from '../composables/useTheme.ts';

/**
 * Theme control: a single icon button that flips between light and dark. It shows
 * the sun when the resolved theme is dark (click makes it light) and the moon when
 * light (click makes it dark). The three-way mode (incl. system) still lives in the
 * store and the default; this control is the quick binary toggle in the chrome.
 */
const { t } = useI18n();
const { resolved, setMode } = useTheme();

const isDark = computed(() => resolved.value === 'dark');

function toggle(): void {
  setMode(isDark.value ? 'light' : 'dark');
}
</script>

<template>
  <button
    type="button"
    class="icon-btn"
    data-testid="theme-toggle"
    :aria-label="t('theme.toggle')"
    :title="t('theme.toggle')"
    :aria-pressed="isDark"
    @click="toggle"
  >
    <!-- Sun: shown in dark mode, offering a switch to light. -->
    <svg
      v-if="isDark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="4.5"
      />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
    <!-- Moon: shown in light mode, offering a switch to dark. -->
    <svg
      v-else
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
    </svg>
  </button>
</template>

<style scoped>
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 2.625rem;
  block-size: 2.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-overlay);
  color: var(--color-text);
  cursor: pointer;
  transition:
    color var(--motion-fast) var(--motion-ease),
    border-color var(--motion-fast) var(--motion-ease),
    background-color var(--motion-fast) var(--motion-ease);
}
.icon-btn:hover {
  color: var(--color-accent);
  border-color: var(--color-border-strong);
}
.icon-btn svg {
  inline-size: 1.15rem;
  block-size: 1.15rem;
}
</style>
