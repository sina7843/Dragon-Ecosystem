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
  /**
   * Optional per-cell `title`, parallel to `rows` and keyed by column.
   *
   * Lets a cell show a short, readable value while keeping the exact one reachable —
   * a relative timestamp with the absolute time behind it, or a truncated identifier
   * with the full id behind it. Never the only place a value appears if a user needs it,
   * because a `title` is not reachable by touch or by every screen reader.
   */
  titles?: ReadonlyArray<Record<string, string | undefined>>;
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
            :title="props.titles?.[index]?.[column.key]"
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
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

table {
  inline-size: 100%;
  border-collapse: collapse;
}

caption {
  padding: var(--space-3) var(--space-4);
  text-align: start;
  font-weight: var(--weight-semibold);
  color: var(--color-text-soft);
  font-size: var(--text-sm);
  border-block-end: 1px solid var(--color-border);
}

th,
td {
  padding: var(--space-3) var(--space-4);
  text-align: start;
  border-block-start: 1px solid var(--color-border);
}

/* Column heads are labels, so they take the utility face — the same treatment as
   every other label in the system. */
th {
  position: sticky;
  inset-block-start: 0;
  background-color: var(--color-surface-sunken);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
}

/* Letter-spacing breaks Persian connected script — reset it there (17.5). */
[lang='fa'] th {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  letter-spacing: normal;
  text-transform: none;
}

tbody tr {
  transition: background-color var(--motion-fast) var(--motion-ease);
}
tbody tr:hover {
  background-color: var(--color-primary-soft);
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
