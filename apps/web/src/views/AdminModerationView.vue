<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSearch from '../components/AppSearch.vue';
import AppTable, { type TableColumn } from '../components/AppTable.vue';
import StateBlock from '../components/StateBlock.vue';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { listModerationCases, type ModerationCaseView } from '../composables/useModerationApi.ts';
import { formatDateTime, formatNumber, formatRelativeTime } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Read-only moderation case queue (DRAGON-14). Lists cases with a state filter;
 * no case-mutation actions in this slice. Mirrors AdminAuditView.vue.
 */

const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();

const STATES = ['open', 'assigned', 'actioned', 'dismissed', 'all'] as const;

const loading = ref(true);
const error = ref<string | undefined>(undefined);
const cases = ref<ModerationCaseView[]>([]);
const nextCursor = ref<string | null>(null);
const state = ref<(typeof STATES)[number]>('open');

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));

const columns: TableColumn[] = [
  { key: 'createdAt', label: t('admin.moderation.time') },
  { key: 'subject', label: t('admin.moderation.subject'), latin: true },
  { key: 'severity', label: t('admin.moderation.severity') },
  { key: 'state', label: t('admin.moderation.state') },
  { key: 'reportCount', label: t('admin.moderation.reportCount'), numeric: true },
  { key: 'emergency', label: t('admin.moderation.emergency') }
];

const search = ref('');

/** First segment of a UUID: enough to tell two rows apart, short enough to read. */
function shortId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
}

/**
 * The subject a case is about. A reported user resolves to their name (the server does
 * the lookup); content and tournaments are not accounts, so they keep a readable
 * `type · short-id`. The exact `type:id` stays in the cell's title either way — a
 * moderator still needs it, but it does not belong in every screenshot.
 */
function subjectLabel(c: ModerationCaseView): string {
  const type = t(`admin.moderation.subjectType.${c.subjectType}`);
  return `${type} · ${c.subjectName?.displayName || c.subjectName?.username || shortId(c.subjectId)}`;
}

/** Cells and the exact values behind them, built and filtered together so they stay aligned. */
const entries = computed(() =>
  cases.value.map((c) => ({
    row: {
      createdAt: formatRelativeTime(c.createdAt, activeLocale.value),
      subject: subjectLabel(c),
      severity: t(`admin.moderation.severityValue.${c.severity}`),
      state: t(`admin.moderation.stateValue.${c.state}`),
      // Locale digits, like every other figure on the page (the relative time beside it
      // already renders Persian numerals).
      reportCount: formatNumber(c.reportCount, activeLocale.value),
      emergency: c.emergency ? t('admin.audit.yes') : t('admin.audit.no')
    },
    title: {
      createdAt: formatDateTime(c.createdAt, activeLocale.value, 'Asia/Tehran'),
      subject: `${c.subjectType}:${c.subjectId}`
    }
  }))
);
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return entries.value;
  return entries.value.filter((e) => `${e.row.subject} ${e.row.severity} ${e.row.state} ${e.title.subject}`.toLowerCase().includes(q));
});
const filteredRows = computed(() => filtered.value.map((e) => e.row));
const filteredTitles = computed(() => filtered.value.map((e) => e.title));

async function load(cursor?: string): Promise<void> {
  loading.value = true;
  try {
    const page = await listModerationCases(state.value, cursor);
    cases.value = cursor === undefined ? page.items : [...cases.value, ...page.items];
    nextCursor.value = page.nextCursor;
    error.value = undefined;
  } catch (caught) {
    error.value = messageFor(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await refreshCaps();
  await load();
});

function onStateChange(): void {
  void load();
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('admin.moderation.heading') }}</h1>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="moderation-forbidden"
    />
    <template v-else>
      <div class="toolbar">
        <label
          class="filter-label"
          for="moderation-state-filter"
        >{{ t('admin.moderation.stateFilter') }}</label>
        <select
          id="moderation-state-filter"
          v-model="state"
          data-testid="state-filter"
          @change="onStateChange"
        >
          <option
            v-for="s in STATES"
            :key="s"
            :value="s"
          >
            {{ s === 'all' ? t('admin.moderation.stateValue.all') : t(`admin.moderation.stateValue.${s}`) }}
          </option>
        </select>
      </div>

      <StateBlock
        v-if="loading && cases.length === 0"
        variant="loading"
      />
      <StateBlock
        v-else-if="error"
        variant="error"
        :message="error"
      />
      <template v-else>
        <AppSearch
          v-model="search"
          input-id="admin-moderation-search"
        />
        <AppTable
          :caption="t('admin.moderation.caption')"
          :columns="columns"
          :rows="filteredRows"
          :titles="filteredTitles"
          :empty-message="search.trim() === '' ? t('admin.moderation.empty') : t('search.noResults')"
          dense
        />
        <button
          v-if="nextCursor"
          type="button"
          class="btn btn-secondary more"
          data-testid="load-more"
          @click="load(nextCursor ?? undefined)"
        >
          {{ t('admin.moderation.loadMore') }}
        </button>
      </template>
    </template>
  </section>
</template>

<style scoped>
.filter-label {
  font-weight: var(--weight-semibold);
  font-size: var(--text-sm);
}

select {
  padding: var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.more {
  margin-block-start: var(--space-4);
}
</style>

