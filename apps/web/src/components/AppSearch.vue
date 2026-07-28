<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * Reusable search field for list views. A labelled search input with a leading
 * magnifier and a clear button, styled from the design tokens. Filtering itself
 * stays in the parent (client-side over the loaded rows, or wired to a server
 * query where the endpoint supports it).
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** DOM id so the visually-hidden label associates with the input. */
    inputId: string;
    placeholder?: string | undefined;
  }>(),
  { placeholder: undefined }
);

const emit = defineEmits<{ 'update:modelValue': [string] }>();
const { t } = useI18n();

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div
    class="app-search"
    role="search"
  >
    <label
      class="field"
      :for="props.inputId"
    >
      <span class="visually-hidden">{{ t('search.label') }}</span>
      <svg
        class="icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <circle
          cx="11"
          cy="11"
          r="7"
        />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        :id="props.inputId"
        type="search"
        data-testid="search-input"
        :value="props.modelValue"
        :placeholder="props.placeholder ?? t('search.placeholder')"
        @input="onInput"
      >
      <button
        v-if="props.modelValue !== ''"
        type="button"
        class="clear"
        :aria-label="t('search.clear')"
        @click="emit('update:modelValue', '')"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </label>
  </div>
</template>

<style scoped>
.app-search {
  margin-block-end: var(--space-4);
}
.field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  transition: border-color var(--motion-fast) var(--motion-ease);
}
.field:focus-within {
  border-color: var(--color-primary);
}
.icon {
  flex: none;
  inline-size: 1.1rem;
  block-size: 1.1rem;
  color: var(--color-text-muted);
}
input {
  flex: 1;
  min-inline-size: 0;
  padding-block: var(--space-3);
  border: none;
  background: none;
  color: var(--color-text);
  font: inherit;
  outline: none;
}
input::placeholder {
  color: var(--color-text-muted);
}
.clear {
  display: inline-grid;
  place-items: center;
  flex: none;
  inline-size: 1.75rem;
  block-size: 1.75rem;
  min-block-size: auto;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}
.clear:hover {
  color: var(--color-text);
  background-color: var(--color-surface-sunken);
}
.clear svg {
  inline-size: 0.95rem;
  block-size: 0.95rem;
}
</style>
