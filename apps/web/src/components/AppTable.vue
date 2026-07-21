<script setup lang="ts">
export interface TableColumn {
  readonly key: string;
  /** Already-localized header text. */
  readonly label: string;
  /** Right-aligned tabular numerals, readable in both directions (section 17.5). */
  readonly numeric?: boolean;
  /** Code-like value kept LTR and bidi-isolated inside Persian text. */
  readonly latin?: boolean;
}

/**
 * Data table with a caption and column headers (A11Y-014). The scroll container
 * is focusable and labelled so keyboard users can reach overflowing content
 * (section 22.2).
 */
const props = defineProps<{
  caption: string;
  columns: readonly TableColumn[];
  rows: ReadonlyArray<Record<string, string>>;
  emptyMessage: string;
  dense?: boolean;
}>();
</script>

<template>
  <div
    class="scroll"
    role="region"
    :aria-label="props.caption"
    tabindex="0"
  >
    <table :class="{ dense: props.dense }">
      <caption>{{ props.caption }}</caption>
      <thead>
        <tr>
          <th
            v-for="column in props.columns"
            :key="column.key"
            scope="col"
            :class="{ numeric: column.numeric }"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, index) in props.rows"
          :key="index"
        >
          <td
            v-for="column in props.columns"
            :key="column.key"
            :class="{ numeric: column.numeric }"
          >
            <bdi
              v-if="column.latin"
              class="latin-value"
            >{{ row[column.key] }}</bdi>
            <template v-else>
              {{ row[column.key] }}
            </template>
          </td>
        </tr>
        <tr v-if="props.rows.length === 0">
          <td
            :colspan="props.columns.length"
            class="empty"
          >
            {{ props.emptyMessage }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.scroll {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

table {
  inline-size: 100%;
  border-collapse: collapse;
}

caption {
  padding: var(--space-3);
  text-align: start;
  font-weight: 600;
}

th,
td {
  padding: var(--space-3);
  text-align: start;
  border-block-start: 1px solid var(--color-border);
}

th {
  background-color: var(--color-surface-raised);
}

/* Compact administration density without shrinking touch targets (section 23.2). */
.dense th,
.dense td {
  padding-block: var(--space-2);
  font-size: var(--text-sm);
}

.empty {
  color: var(--color-text-muted);
  text-align: center;
}
</style>
