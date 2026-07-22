<script setup lang="ts">
import { computed } from 'vue';

/**
 * Pagination control (section 20.3, section 22.2).
 *
 * Labels are text rather than arrow glyphs: an arrow would need direction-aware
 * mirroring, while page numbers keep the same meaning in both directions
 * (section 9.4 and 17.5).
 */
const props = defineProps<{
  page: number;
  pageCount: number;
  label: string;
  previousLabel: string;
  nextLabel: string;
  pageLabel: (page: number) => string;
}>();

const emit = defineEmits<{ 'update:page': [number] }>();

const pages = computed(() => Array.from({ length: props.pageCount }, (_, index) => index + 1));
const canGoBack = computed(() => props.page > 1);
const canGoForward = computed(() => props.page < props.pageCount);

function go(target: number): void {
  if (target >= 1 && target <= props.pageCount) emit('update:page', target);
}
</script>

<template>
  <nav
    class="pagination"
    :aria-label="props.label"
  >
    <button
      type="button"
      data-testid="pagination-previous"
      :disabled="!canGoBack"
      @click="go(props.page - 1)"
    >
      {{ props.previousLabel }}
    </button>

    <ul>
      <li
        v-for="value in pages"
        :key="value"
      >
        <button
          type="button"
          :aria-current="value === props.page ? 'page' : undefined"
          :aria-label="props.pageLabel(value)"
          @click="go(value)"
        >
          {{ value }}
        </button>
      </li>
    </ul>

    <button
      type="button"
      data-testid="pagination-next"
      :disabled="!canGoForward"
      @click="go(props.page + 1)"
    >
      {{ props.nextLabel }}
    </button>
  </nav>
</template>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

ul {
  display: flex;
  gap: var(--space-1);
  list-style: none;
  margin: 0;
  padding: 0;
}

button {
  min-inline-size: var(--target-min);
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

button:hover:not(:disabled) {
  background-color: var(--color-surface-raised);
}

button:disabled {
  color: var(--color-text-muted);
  cursor: not-allowed;
}

/* Selected state carries weight and a border, not colour alone (section 23.2). */
button[aria-current='page'] {
  background-color: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 700;
  border-color: var(--color-accent);
}
</style>
