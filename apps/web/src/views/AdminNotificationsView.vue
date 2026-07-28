<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSearch from '../components/AppSearch.vue';
import AppTable, { type TableColumn } from '../components/AppTable.vue';
import StateBlock from '../components/StateBlock.vue';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import {
  approveNotificationTemplate,
  listNotificationDeliveries,
  listNotificationTemplates,
  processNotifications,
  type NotificationDelivery,
  type NotificationTemplate
} from '../composables/useAdminConsolesApi.ts';
import { formatDateTime, formatNumber, formatRelativeTime, viewerTimeZone } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Notification templates and the delivery log (FEATURE-007).
 *
 * Both endpoints existed with no screen, so an operator could neither see which template
 * versions were approved nor why a message had not arrived. Recipients are masked by the
 * server and stay masked here — this console shows delivery *state*, never contact
 * details, and no control on it can send a message to a specific person.
 */
const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const DELIVERY_STATES = ['', 'pending', 'sent', 'failed', 'dead', 'suppressed'] as const;

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const loading = ref(true);
const error = ref<string | undefined>(undefined);
const templates = ref<NotificationTemplate[]>([]);
const deliveries = ref<NotificationDelivery[]>([]);
const nextCursor = ref<string | null>(null);
const statusFilter = ref<(typeof DELIVERY_STATES)[number]>('');
const search = ref('');
const busy = ref(false);

const columns: TableColumn[] = [
  { key: 'createdAt', label: t('admin.notifications.time') },
  { key: 'templateKey', label: t('admin.notifications.template'), latin: true },
  { key: 'channel', label: t('admin.notifications.channel') },
  { key: 'recipient', label: t('admin.notifications.recipient'), latin: true },
  { key: 'status', label: t('admin.notifications.status') },
  { key: 'attempts', label: t('admin.notifications.attempts'), numeric: true }
];

/**
 * A suppressed delivery is only useful with its reason — "no contact", "channel
 * disabled", and "no consent" are three different operator problems.
 */
function statusLabel(delivery: NotificationDelivery): string {
  const base = t(`admin.notifications.statusValue.${delivery.status}`);
  if (delivery.status !== 'suppressed' || delivery.suppressedReason === null) return base;
  return `${base} · ${t(`admin.notifications.suppressed.${delivery.suppressedReason}`, delivery.suppressedReason)}`;
}

const entries = computed(() =>
  deliveries.value.map((d) => ({
    row: {
      createdAt: formatRelativeTime(d.createdAt, activeLocale.value),
      templateKey: d.templateKey,
      channel: t(`admin.notifications.channelValue.${d.channel}`),
      recipient: d.recipientMasked,
      status: statusLabel(d),
      attempts: formatNumber(d.attempts, activeLocale.value)
    },
    title: { createdAt: formatDateTime(d.createdAt, activeLocale.value, viewerTimeZone()) }
  }))
);
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return entries.value;
  return entries.value.filter((e) => `${e.row.templateKey} ${e.row.status} ${e.row.recipient}`.toLowerCase().includes(q));
});
const filteredRows = computed(() => filtered.value.map((e) => e.row));
const filteredTitles = computed(() => filtered.value.map((e) => e.title));

/** Only an approved template is ever rendered for delivery, so drafts are worth flagging. */
const drafts = computed(() => templates.value.filter((tpl) => tpl.status === 'draft').length);

async function loadTemplates(): Promise<void> {
  templates.value = (await listNotificationTemplates()).templates;
}

async function loadDeliveries(cursor?: string): Promise<void> {
  const page = await listNotificationDeliveries({
    ...(statusFilter.value === '' ? {} : { status: statusFilter.value }),
    ...(cursor === undefined ? {} : { cursor })
  });
  deliveries.value = cursor === undefined ? page.items : [...deliveries.value, ...page.items];
  nextCursor.value = page.nextCursor;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    await Promise.all([loadTemplates(), loadDeliveries()]);
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

function onStatusChange(): void {
  void loadDeliveries().catch((caught: unknown) => {
    error.value = messageFor(caught);
  });
}

async function onApprove(template: NotificationTemplate): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const approved = await approveNotificationTemplate(template.id);
    templates.value = templates.value.map((tpl) => (tpl.id === approved.id ? approved : tpl));
    push('success', t('admin.notifications.templateApproved'));
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = false;
  }
}

/**
 * Drains the outbox and settles due deliveries once. The channel gates still decide what
 * may actually be sent, so this can never push a message past a disabled channel.
 */
async function onProcess(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await processNotifications();
    await load();
    push('success', t('admin.notifications.processed'));
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('admin.notifications.heading') }}</h1>
        <p class="page-lead">
          {{ t('admin.notifications.intro') }}
        </p>
      </div>
      <div class="page-header-actions">
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="busy || forbidden"
          data-testid="process-notifications"
          @click="onProcess"
        >
          {{ t('admin.notifications.process') }}
        </button>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="notifications-forbidden"
    />
    <template v-else>
      <StateBlock
        v-if="loading && deliveries.length === 0 && templates.length === 0"
        variant="loading"
      />
      <StateBlock
        v-else-if="error"
        variant="error"
        :message="error"
      />
      <template v-else>
        <section class="block">
          <h2>{{ t('admin.notifications.templates') }}</h2>
          <p
            v-if="drafts > 0"
            class="muted"
          >
            {{ t('admin.notifications.draftCount', { count: formatNumber(drafts, activeLocale) }) }}
          </p>
          <StateBlock
            v-if="templates.length === 0"
            variant="empty"
            :message="t('admin.notifications.noTemplates')"
          />
          <ul
            v-else
            class="templates"
            data-testid="template-list"
          >
            <li
              v-for="template in templates"
              :key="template.id"
              class="template"
              :data-testid="`template-${template.id}`"
            >
              <div class="template-head">
                <bdi class="latin-value template-key">{{ template.templateKey }}</bdi>
                <span class="badge badge-neutral">{{ t(`admin.notifications.channelValue.${template.channel}`) }}</span>
                <span class="numeric muted">v{{ formatNumber(template.version, activeLocale) }}</span>
                <span
                  class="status-pill"
                  :class="template.status === 'approved' ? 'status-pill-success' : 'status-pill-neutral'"
                  :data-testid="`template-status-${template.id}`"
                >{{ t(`admin.notifications.templateStatus.${template.status}`) }}</span>
              </div>
              <p class="template-body">
                {{ template.locales[activeLocale].body }}
              </p>
              <button
                v-if="template.status === 'draft'"
                type="button"
                class="btn btn-primary"
                :disabled="busy"
                :data-testid="`approve-template-${template.id}`"
                @click="onApprove(template)"
              >
                {{ t('admin.notifications.approveTemplate') }}
              </button>
            </li>
          </ul>
        </section>

        <section class="block">
          <h2>{{ t('admin.notifications.deliveries') }}</h2>
          <div class="toolbar">
            <label
              class="filter-label"
              for="delivery-status-filter"
            >{{ t('admin.notifications.statusFilter') }}</label>
            <select
              id="delivery-status-filter"
              v-model="statusFilter"
              data-testid="delivery-status-filter"
              @change="onStatusChange"
            >
              <option
                v-for="s in DELIVERY_STATES"
                :key="s"
                :value="s"
              >
                {{ s === '' ? t('content.hub.all') : t(`admin.notifications.statusValue.${s}`) }}
              </option>
            </select>
          </div>
          <AppSearch
            v-model="search"
            input-id="admin-deliveries-search"
          />
          <AppTable
            :caption="t('admin.notifications.deliveriesCaption')"
            :columns="columns"
            :rows="filteredRows"
            :titles="filteredTitles"
            :empty-message="search.trim() === '' ? t('admin.notifications.noDeliveries') : t('search.noResults')"
            dense
          />
          <button
            v-if="nextCursor"
            type="button"
            class="btn btn-neutral more"
            data-testid="load-more"
            @click="loadDeliveries(nextCursor ?? undefined)"
          >
            {{ t('admin.notifications.loadMore') }}
          </button>
        </section>
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

.templates {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.template {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.template-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.template-key {
  font-weight: var(--weight-semibold);
}

.template-body {
  margin: 0;
  color: var(--color-text-soft);
}

.muted {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.more {
  margin-block-start: var(--space-4);
}
</style>
