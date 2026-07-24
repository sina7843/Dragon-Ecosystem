<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useTheme } from '../composables/useTheme.ts';
import { THEME_MODES, type ThemeMode } from '../theme/theme.ts';

const { t } = useI18n();
const { mode, setMode } = useTheme();

function onChange(event: Event): void {
  setMode((event.target as HTMLSelectElement).value as ThemeMode);
}
</script>

<template>
  <div class="theme-toggle">
    <label
      class="label"
      for="theme-select"
    >{{ t('theme.label') }}</label>
    <select
      id="theme-select"
      data-testid="theme-select"
      :value="mode"
      @change="onChange"
    >
      <option
        v-for="option in THEME_MODES"
        :key="option"
        :value="option"
      >
        {{ t(`theme.${option}`) }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.theme-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.label {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

select {
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-overlay);
  color: var(--color-text);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}
</style>
