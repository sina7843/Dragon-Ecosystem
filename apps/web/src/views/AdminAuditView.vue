<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSearch from '../components/AppSearch.vue';
import AppTable, { type TableColumn } from '../components/AppTable.vue';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { formatDateTime, formatRelativeTime } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Immutable audit search and export (AUDIT-006, AUDIT-007). Read-only: there is
 * no control that edits an event. Export is a distinct, permissioned action that
 * itself gets audited on the server.
 */
interface AuditEventView {
  action: string;
  resourceType: string;
  resourceId: string;
  reason: string | null;
  emergency: boolean;
  occurredAt: string;
  actor: { accountId: string | null };
  /** Resolved server-side; null when the actor has no profile or is the system. */
  actorName: { username: string; displayName: string } | null;
}
interface AuditPage {
  items: AuditEventView[];
  nextCursor: string | null;
}

const { t, locale } = useI18n();
const { forbidden, has, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const loading = ref(true);
const error = ref<string | undefined>(undefined);
const events = ref<AuditEventView[]>([]);
const nextCursor = ref<string | null>(null);
const emergencyOnly = ref(false);

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const canExport = computed(() => has('audit.export'));

const columns: TableColumn[] = [
  { key: 'occurredAt', label: t('admin.audit.time') },
  { key: 'action', label: t('admin.audit.action') },
  { key: 'resource', label: t('admin.audit.resource') },
  { key: 'actor', label: t('admin.audit.actor'), latin: true },
  { key: 'emergency', label: t('admin.audit.emergency') }
];

const search = ref('');

/** First segment of a UUID: enough to tell two rows apart, short enough to read. */
function shortId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
}

/**
 * Who acted, in that order of preference: their display name, their username, then the
 * raw account id. The console exists to answer "who did this", and a UUID does not.
 * The full id stays in the cell's `title` so it is still copyable for a support ticket.
 */
function actorLabel(event: AuditEventView): string {
  if (event.actor.accountId === null) return t('admin.audit.system');
  if (event.actorName !== null) return event.actorName.displayName || event.actorName.username;
  return shortId(event.actor.accountId);
}

/**
 * Each event as its displayed cells plus the exact values behind the shortened ones.
 * They are built together and filtered together so a row can never drift away from its
 * own tooltips.
 */
const entries = computed(() =>
  events.value.map((event) => ({
    row: {
      // Relative reads at a glance; the exact time lives in the title beside it.
      occurredAt: formatRelativeTime(event.occurredAt, activeLocale.value),
      action: event.action,
      resource: `${event.resourceType} · ${shortId(event.resourceId)}`,
      actor: actorLabel(event),
      emergency: event.emergency ? t('admin.audit.yes') : t('admin.audit.no')
    },
    title: {
      occurredAt: formatDateTime(event.occurredAt, activeLocale.value, 'Asia/Tehran'),
      resource: `${event.resourceType}:${event.resourceId}`,
      actor: event.actor.accountId ?? t('admin.audit.system')
    }
  }))
);
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return entries.value;
  // The exact values are searched too, so pasting a full UUID still finds its row even
  // though the cell shows a truncated one.
  return entries.value.filter((e) =>
    `${e.row.action} ${e.row.resource} ${e.row.actor} ${e.title.resource} ${e.title.actor}`.toLowerCase().includes(q)
  );
});
const filteredRows = computed(() => filtered.value.map((e) => e.row));
const filteredTitles = computed(() => filtered.value.map((e) => e.title));

async function load(cursor?: string): Promise<void> {
  loading.value = true;
  try {
    const path = emergencyOnly.value ? '/admin/audit/emergency' : '/admin/audit';
    const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
    const page = await apiFetch<AuditPage>(`${path}${query}`);
    events.value = cursor === undefined ? page.items : [...events.value, ...page.items];
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

function toggleEmergency(): void {
  emergencyOnly.value = !emergencyOnly.value;
  void load();
}

async function exportAudit(): Promise<void> {
  const reason = globalThis.prompt(t('admin.audit.exportReasonPrompt')) ?? '';
  if (reason.trim() === '') return;
  try {
    await apiFetch('/admin/audit/export', {
      method: 'POST',
      body: JSON.stringify({ reason, ...(emergencyOnly.value ? { emergency: true } : {}) })
    });
    push('success', t('admin.audit.exported'));
    // The export produced a new audit event; refresh so it is visible.
    await load();
  } catch (caught) {
    push('danger', messageFor(caught));
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('admin.audit.heading') }}</h1>
      </div>
      <div
        v-if="canExport"
        class="page-header-actions"
      >
        <button
          type="button"
          class="btn btn-secondary"
          data-testid="export-audit"
          @click="exportAudit"
        >
          {{ t('admin.audit.export') }}
        </button>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="audit-forbidden"
    />
    <template v-else>
      <div class="toolbar">
        <label class="filter-check">
          <input
            type="checkbox"
            data-testid="emergency-filter"
            :checked="emergencyOnly"
            @change="toggleEmergency"
          >
          {{ t('admin.audit.emergencyOnly') }}
        </label>
      </div>

      <StateBlock
        v-if="loading && events.length === 0"
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
          input-id="admin-audit-search"
        />
        <AppTable
          :caption="t('admin.audit.caption')"
          :columns="columns"
          :rows="filteredRows"
          :titles="filteredTitles"
          :empty-message="search.trim() === '' ? t('admin.audit.empty') : t('search.noResults')"
          dense
        />
        <button
          v-if="nextCursor"
          type="button"
          class="btn btn-neutral more"
          data-testid="load-more"
          @click="load(nextCursor ?? undefined)"
        >
          {{ t('admin.audit.loadMore') }}
        </button>
      </template>
    </template>
  </section>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  margin-block-end: var(--space-4);
}

button {
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}

.more {
  margin-block-start: var(--space-4);
}
</style>
