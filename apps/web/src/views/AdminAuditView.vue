<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppTable, { type TableColumn } from '../components/AppTable.vue';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { formatDateTime } from '../i18n/format.ts';
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

const rows = computed(() =>
  events.value.map((event) => ({
    occurredAt: formatDateTime(event.occurredAt, activeLocale.value, 'Asia/Tehran'),
    action: event.action,
    resource: `${event.resourceType}:${event.resourceId}`,
    actor: event.actor.accountId ?? t('admin.audit.system'),
    emergency: event.emergency ? t('admin.audit.yes') : t('admin.audit.no')
  }))
);

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
        <AppTable
          :caption="t('admin.audit.caption')"
          :columns="columns"
          :rows="rows"
          :empty-message="t('admin.audit.empty')"
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
