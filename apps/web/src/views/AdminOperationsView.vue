<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppTable, { type TableColumn } from '../components/AppTable.vue';
import StateBlock from '../components/StateBlock.vue';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import {
  acknowledgeAlert,
  listAlerts,
  listJobExecutions,
  opsMetrics,
  runHealthCheck,
  runJobs,
  type AlertView,
  type JobExecutionView
} from '../composables/useOpsConsolesApi.ts';
import { formatDateTime, formatNumber, formatRelativeTime, viewerTimeZone } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Operations dashboard (FEATURE-012): alerts, job executions, and the metrics snapshot.
 *
 * All three endpoints existed and none had a screen, so a raised alert or a failed job
 * was invisible. The two controls here are the bounded, idempotent passes the server
 * already exposes — running jobs and the health check — not new capabilities.
 */
const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const ALERT_STATES = ['', 'open', 'acknowledged'] as const;

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const loading = ref(true);
const error = ref<string | undefined>(undefined);
const alerts = ref<AlertView[]>([]);
const jobs = ref<JobExecutionView[]>([]);
const metrics = ref<Record<string, unknown>>({});
const alertStatus = ref<(typeof ALERT_STATES)[number]>('');
const busy = ref('');

const jobColumns: TableColumn[] = [
  { key: 'startedAt', label: t('admin.ops.when') },
  { key: 'jobName', label: t('admin.ops.job'), latin: true },
  { key: 'status', label: t('admin.ops.status') },
  { key: 'detail', label: t('admin.ops.detail') }
];

const jobRows = computed(() =>
  jobs.value.map((j) => ({
    row: {
      startedAt: formatRelativeTime(j.startedAt, activeLocale.value),
      jobName: j.jobName,
      status: t(`admin.ops.jobStatus.${j.status}`, j.status),
      detail: j.error ?? '—'
    },
    title: { startedAt: formatDateTime(j.startedAt, activeLocale.value, viewerTimeZone()) }
  }))
);

/**
 * The metrics endpoint returns an open-ended snapshot, so it is rendered generically:
 * a new counter appears here without a UI change, and nothing is silently dropped.
 */
const metricRows = computed(() =>
  Object.entries(metrics.value)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
    .map(([key, value]) => ({
      key,
      label: t(`admin.ops.metric.${key}`, key),
      value: typeof value === 'number' ? formatNumber(value, activeLocale.value) : String(value)
    }))
);

const openAlerts = computed(() => alerts.value.filter((a) => a.status === 'open').length);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [alertPage, jobResult, metricSnapshot] = await Promise.all([
      listAlerts(alertStatus.value === '' ? {} : { status: alertStatus.value }),
      listJobExecutions(),
      opsMetrics()
    ]);
    alerts.value = alertPage.items;
    jobs.value = jobResult.jobs;
    metrics.value = metricSnapshot;
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

async function act(id: string, run: () => Promise<unknown>, successKey: string): Promise<void> {
  if (busy.value !== '') return;
  busy.value = id;
  try {
    await run();
    push('success', t(successKey));
    await load();
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = '';
  }
}

const onAcknowledge = (alert: AlertView): Promise<void> => act(alert.id, () => acknowledgeAlert(alert.id), 'admin.ops.acknowledged');
const onRunJobs = (): Promise<void> => act('jobs', () => runJobs(), 'admin.ops.jobsRan');
const onHealthCheck = (): Promise<void> => act('health', () => runHealthCheck(), 'admin.ops.healthChecked');
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('admin.ops.heading') }}</h1>
        <p class="page-lead">
          {{ t('admin.ops.intro') }}
        </p>
      </div>
      <div class="page-header-actions">
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="busy !== '' || forbidden"
          data-testid="run-health-check"
          @click="onHealthCheck"
        >
          {{ t('admin.ops.healthCheck') }}
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="busy !== '' || forbidden"
          data-testid="run-jobs"
          @click="onRunJobs"
        >
          {{ t('admin.ops.runJobs') }}
        </button>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="ops-forbidden"
    />
    <template v-else>
      <StateBlock
        v-if="loading && alerts.length === 0 && jobs.length === 0"
        variant="loading"
      />
      <StateBlock
        v-else-if="error"
        variant="error"
        :message="error"
      />
      <template v-else>
        <section
          v-if="metricRows.length > 0"
          class="block"
        >
          <h2>{{ t('admin.ops.metrics') }}</h2>
          <dl
            class="metrics"
            data-testid="metrics"
          >
            <div
              v-for="metric in metricRows"
              :key="metric.key"
              class="metric"
            >
              <dt>{{ metric.label }}</dt>
              <dd class="numeric">
                {{ metric.value }}
              </dd>
            </div>
          </dl>
        </section>

        <section class="block">
          <div class="section-head">
            <h2>{{ t('admin.ops.alerts') }}</h2>
            <div class="section-actions">
              <label
                class="filter-label"
                for="alert-status-filter"
              >{{ t('admin.ops.status') }}</label>
              <select
                id="alert-status-filter"
                v-model="alertStatus"
                data-testid="alert-status-filter"
                @change="load"
              >
                <option
                  v-for="s in ALERT_STATES"
                  :key="s"
                  :value="s"
                >
                  {{ s === '' ? t('content.hub.all') : t(`admin.ops.alertStatus.${s}`) }}
                </option>
              </select>
            </div>
          </div>

          <p
            v-if="openAlerts > 0"
            class="open-banner"
            role="status"
            data-testid="open-alerts"
          >
            {{ t('admin.ops.openAlerts', { count: formatNumber(openAlerts, activeLocale) }) }}
          </p>

          <StateBlock
            v-if="alerts.length === 0"
            variant="empty"
            :message="t('admin.ops.noAlerts')"
          />
          <ul
            v-else
            class="alerts"
            data-testid="alert-list"
          >
            <li
              v-for="alert in alerts"
              :key="alert.id"
              class="card alert"
              :data-testid="`alert-${alert.id}`"
            >
              <div class="alert-head">
                <span
                  class="status-pill"
                  :class="alert.severity === 'critical' ? 'status-pill-danger' : alert.status === 'open' ? 'status-pill-warning' : 'status-pill-neutral'"
                >{{ t(`admin.ops.severity.${alert.severity}`, alert.severity) }}</span>
                <span class="badge badge-neutral">{{ t(`admin.ops.category.${alert.category}`, alert.category) }}</span>
                <time
                  class="muted"
                  :datetime="alert.createdAt"
                  :title="formatDateTime(alert.createdAt, activeLocale, viewerTimeZone())"
                >{{ formatRelativeTime(alert.createdAt, activeLocale) }}</time>
              </div>
              <p class="alert-message">
                {{ alert.message }}
              </p>
              <button
                v-if="alert.status === 'open'"
                type="button"
                class="btn btn-secondary"
                :disabled="busy !== ''"
                :data-testid="`acknowledge-${alert.id}`"
                @click="onAcknowledge(alert)"
              >
                {{ t('admin.ops.acknowledge') }}
              </button>
            </li>
          </ul>
        </section>

        <section class="block">
          <h2>{{ t('admin.ops.jobs') }}</h2>
          <AppTable
            :caption="t('admin.ops.jobsCaption')"
            :columns="jobColumns"
            :rows="jobRows.map((r) => r.row)"
            :titles="jobRows.map((r) => r.title)"
            :empty-message="t('admin.ops.noJobs')"
            dense
          />
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-block-end: var(--space-3);
}
.section-head h2 {
  margin: 0;
}
.section-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

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

.metrics {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  margin: 0;
}
.metric {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-sunken);
}
.metric dt {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  color: var(--color-text-muted);
}
[lang='fa'] .metric dt {
  letter-spacing: normal;
  text-transform: none;
}
.metric dd {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: var(--weight-black);
}

.open-banner {
  margin-block-end: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-warning-text);
  border-radius: var(--radius-md);
  background-color: var(--color-warning-surface);
  color: var(--color-warning-text);
  inline-size: fit-content;
  max-inline-size: 100%;
}

.alerts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.alert {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
}

.alert-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.alert-message {
  margin: 0;
  color: var(--color-text-soft);
}

.muted {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
</style>
