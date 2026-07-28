<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSearch from '../components/AppSearch.vue';
import StateBlock from '../components/StateBlock.vue';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import {
  approveConfiguration,
  listConfiguration,
  listConfigurationHistory,
  proposeConfiguration,
  type ConfigEntry,
  type ConfigVersion
} from '../composables/useAdminConsolesApi.ts';
import { formatDateTime, formatNumber, formatRelativeTime, viewerTimeZone } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Versioned configuration with dual control (FEATURE-006, ADMIN-003/009).
 *
 * The propose/approve workflow was fully implemented and had no screen, which is why
 * the administration dashboard's Configuration card led nowhere (BUG-001) and had to be
 * hidden. This is that screen, so the card can come back.
 *
 * The server classifies a key as high-risk (finance/security/payout) and decides whether
 * a proposal activates immediately or waits for a *different* operator to approve it.
 * This form never predicts that outcome — it proposes and reports what happened.
 */
const { t, locale } = useI18n();
const { forbidden, has, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const canPropose = computed(() => has('config.propose'));
const canApprove = computed(() => has('config.approve'));

const loading = ref(true);
const error = ref<string | undefined>(undefined);
const entries = ref<ConfigEntry[]>([]);
const search = ref('');
const busy = ref('');
const history = ref<{ key: string; versions: ConfigVersion[] } | null>(null);

const form = reactive({ key: '', value: '', reason: '' });
const formError = ref<string | undefined>(undefined);
const proposing = ref(false);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return entries.value;
  return entries.value.filter((e) => e.key.toLowerCase().includes(q));
});
const pendingCount = computed(() => entries.value.filter((e) => e.pending !== null).length);

/** Values are arbitrary JSON, so they are shown as JSON rather than guessed at. */
function valueText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    entries.value = (await listConfiguration()).items;
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

/**
 * Proposals are typed as JSON when they parse as JSON, and as a plain string otherwise —
 * so `30` and `true` become a number and a boolean, while `strict` stays text.
 */
function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

async function onPropose(): Promise<void> {
  if (proposing.value) return;
  proposing.value = true;
  formError.value = undefined;
  try {
    const created = await proposeConfiguration({ key: form.key, value: parseValue(form.value), reason: form.reason });
    // The server decides which of these happened; the message reports it rather than
    // assuming the proposal took effect.
    push('success', created.state === 'active' ? t('admin.config.activated') : t('admin.config.awaitingApproval'));
    form.key = '';
    form.value = '';
    form.reason = '';
    await load();
  } catch (caught) {
    formError.value = messageFor(caught);
  } finally {
    proposing.value = false;
  }
}

async function onApprove(entry: ConfigEntry): Promise<void> {
  if (entry.pending === null || busy.value !== '') return;
  const reason = globalThis.prompt(t('admin.config.approveReasonPrompt')) ?? '';
  if (reason.trim() === '') return;
  busy.value = entry.key;
  try {
    await approveConfiguration(entry.pending.id, reason);
    push('success', t('admin.config.approved'));
    await load();
  } catch (caught) {
    // The commonest refusal is the proposer trying to approve their own change, which is
    // the dual-control rule doing its job.
    push('danger', messageFor(caught));
  } finally {
    busy.value = '';
  }
}

async function onShowHistory(key: string): Promise<void> {
  if (history.value?.key === key) {
    history.value = null;
    return;
  }
  try {
    history.value = { key, versions: await listConfigurationHistory(key) };
  } catch (caught) {
    push('danger', messageFor(caught));
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('admin.config.heading') }}</h1>
        <p class="page-lead">
          {{ t('admin.config.intro') }}
        </p>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="config-forbidden"
    />
    <template v-else>
      <!-- The propose form sits outside the list's own loading/error branch on purpose: a
           finance operator may propose without holding `config.read`, so the list below
           is denied for them while this form is exactly what their role is for. -->
      <form
        v-if="canPropose"
        class="card propose"
        data-testid="propose-form"
        novalidate
        @submit.prevent="onPropose"
      >
        <h2>{{ t('admin.config.proposeHeading') }}</h2>
        <p class="muted">
          {{ t('admin.config.highRiskNote') }}
        </p>
        <p
          v-if="formError"
          class="form-error"
          role="alert"
          data-testid="propose-error"
        >
          {{ formError }}
        </p>
        <div class="fields">
          <label for="config-key">
            <span>{{ t('admin.config.key') }}</span>
            <input
              id="config-key"
              v-model="form.key"
              type="text"
              required
              data-testid="config-key"
              placeholder="finance.max_refund"
            >
          </label>
          <label for="config-value">
            <span>{{ t('admin.config.value') }}</span>
            <input
              id="config-value"
              v-model="form.value"
              type="text"
              required
              data-testid="config-value"
              placeholder="30"
            >
          </label>
          <label for="config-reason">
            <span>{{ t('admin.config.reason') }}</span>
            <input
              id="config-reason"
              v-model="form.reason"
              type="text"
              required
              data-testid="config-reason"
            >
          </label>
        </div>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="proposing"
          data-testid="propose-submit"
        >
          {{ proposing ? t('admin.config.proposing') : t('admin.config.propose') }}
        </button>
      </form>

      <!-- The key list is a separate read, and a propose-only role is denied it. -->
      <StateBlock
        v-if="loading && entries.length === 0"
        variant="loading"
      />
      <StateBlock
        v-else-if="error"
        variant="error"
        :message="error"
      />
      <template v-else>
        <p
          v-if="pendingCount > 0"
          class="pending-banner"
          role="status"
          data-testid="pending-banner"
        >
          {{ t('admin.config.pendingCount', { count: formatNumber(pendingCount, activeLocale) }) }}
        </p>

        <AppSearch
          v-model="search"
          input-id="admin-config-search"
        />

        <StateBlock
          v-if="filtered.length === 0"
          variant="empty"
          :message="search.trim() === '' ? t('admin.config.empty') : t('search.noResults')"
        />
        <ul
          v-else
          class="keys"
          data-testid="config-list"
        >
          <li
            v-for="entry in filtered"
            :key="entry.key"
            class="card key-card"
            :data-testid="`config-${entry.key}`"
          >
            <div class="key-head">
              <bdi class="latin-value key-name">{{ entry.key }}</bdi>
              <span
                v-if="entry.active?.highRisk || entry.pending?.highRisk"
                class="badge badge-neutral"
                data-testid="high-risk"
              >{{ t('admin.config.highRisk') }}</span>
              <span
                v-if="entry.pending"
                class="status-pill status-pill-warning"
                :data-testid="`pending-${entry.key}`"
              >{{ t('admin.config.pending') }}</span>
            </div>

            <dl class="values">
              <div>
                <dt>{{ t('admin.config.active') }}</dt>
                <dd>
                  <bdi
                    v-if="entry.active"
                    class="latin-value"
                  >{{ valueText(entry.active.value) }}</bdi>
                  <span
                    v-else
                    class="muted"
                  >{{ t('admin.config.noActive') }}</span>
                </dd>
              </div>
              <div v-if="entry.pending">
                <dt>{{ t('admin.config.proposed') }}</dt>
                <dd>
                  <bdi class="latin-value">{{ valueText(entry.pending.value) }}</bdi>
                  <span class="muted"> — {{ entry.pending.reason }}</span>
                </dd>
              </div>
            </dl>

            <div class="actions">
              <button
                v-if="entry.pending && canApprove"
                type="button"
                class="btn btn-primary"
                :disabled="busy !== ''"
                :data-testid="`approve-${entry.key}`"
                @click="onApprove(entry)"
              >
                {{ t('admin.config.approve') }}
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                :data-testid="`history-${entry.key}`"
                @click="onShowHistory(entry.key)"
              >
                {{ history?.key === entry.key ? t('admin.config.hideHistory') : t('admin.config.showHistory') }}
              </button>
            </div>

            <ol
              v-if="history?.key === entry.key"
              class="history"
              :data-testid="`history-list-${entry.key}`"
            >
              <li
                v-for="version in history.versions"
                :key="version.id"
              >
                <span class="numeric">v{{ formatNumber(version.version, activeLocale) }}</span>
                <span class="muted">{{ t(`admin.config.state.${version.state}`) }}</span>
                <bdi class="latin-value">{{ valueText(version.value) }}</bdi>
                <time
                  class="muted"
                  :datetime="version.createdAt"
                  :title="formatDateTime(version.createdAt, activeLocale, viewerTimeZone())"
                >{{ formatRelativeTime(version.createdAt, activeLocale) }}</time>
              </li>
            </ol>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>

<style scoped>
input[type='text'] {
  inline-size: 100%;
  padding: var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.pending-banner {
  margin-block-end: var(--space-4);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-warning-text);
  border-radius: var(--radius-md);
  background-color: var(--color-warning-surface);
  color: var(--color-warning-text);
  inline-size: fit-content;
  max-inline-size: 100%;
}

.propose {
  margin-block-end: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.propose h2 {
  margin: 0;
}

.fields {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
}
.fields label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-sm);
}

.form-error {
  color: var(--color-danger);
}

.keys {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.key-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.key-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.key-name {
  font-weight: var(--weight-semibold);
}

.values {
  display: grid;
  gap: var(--space-2);
  margin: 0;
}
.values dt {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  color: var(--color-text-muted);
}
[lang='fa'] .values dt {
  letter-spacing: normal;
  text-transform: none;
}
.values dd {
  margin: 0;
}

.muted {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.history {
  margin: 0;
  padding-inline-start: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-sm);
}
.history li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: baseline;
}
</style>
