<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSearch from '../components/AppSearch.vue';
import StateBlock from '../components/StateBlock.vue';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import {
  listRecoveryRequests,
  listSupportCases,
  reviewRecovery,
  transitionSupportCase,
  type RecoveryRequestView,
  type SupportCaseView
} from '../composables/useOpsConsolesApi.ts';
import { formatDateTime, formatRelativeTime, viewerTimeZone } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Support console (FEATURE-011): the case queue and account-recovery triage.
 *
 * Both endpoints existed with no screen, so a filed support case was invisible to the
 * operators meant to work it.
 *
 * Recovery is deliberately **triage only** — the server has no approval path, and this
 * screen offers none: an operator records that a request was reviewed or rejected and
 * never restores access from here. That is the fail-closed design, not a missing feature.
 */
const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const CASE_STATES = ['', 'open', 'assigned', 'resolved', 'closed'] as const;

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const loading = ref(true);
const error = ref<string | undefined>(undefined);
const cases = ref<SupportCaseView[]>([]);
const recoveries = ref<RecoveryRequestView[]>([]);
const caseState = ref<(typeof CASE_STATES)[number]>('open');
const search = ref('');
const busy = ref('');

const filteredCases = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return cases.value;
  return cases.value.filter((c) => `${c.subject} ${c.body} ${c.category}`.toLowerCase().includes(q));
});

function shortId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [casePage, recoveryPage] = await Promise.all([
      listSupportCases(caseState.value === '' ? {} : { state: caseState.value }),
      listRecoveryRequests()
    ]);
    cases.value = casePage.items;
    recoveries.value = recoveryPage.items;
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

/** Assigning with no explicit assignee takes the case for the acting operator. */
async function onAssign(supportCase: SupportCaseView): Promise<void> {
  await act(supportCase.id, () => transitionSupportCase(supportCase.id, 'assigned', { expectedVersion: supportCase.version }), 'admin.support.assigned');
}

async function onResolve(supportCase: SupportCaseView): Promise<void> {
  const note = globalThis.prompt(t('admin.support.resolveNotePrompt')) ?? '';
  if (note.trim() === '') return;
  await act(supportCase.id, () => transitionSupportCase(supportCase.id, 'resolved', { expectedVersion: supportCase.version, note }), 'admin.support.resolved');
}

async function onClose(supportCase: SupportCaseView): Promise<void> {
  await act(supportCase.id, () => transitionSupportCase(supportCase.id, 'closed', { expectedVersion: supportCase.version }), 'admin.support.closed');
}

async function onReview(request: RecoveryRequestView, decision: 'reviewed' | 'rejected'): Promise<void> {
  const note = globalThis.prompt(t('admin.support.recoveryNotePrompt')) ?? '';
  if (note.trim() === '') return;
  await act(request._id, () => reviewRecovery(request._id, { expectedVersion: request.version, decision, note }), 'admin.support.recoveryReviewed');
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('admin.support.heading') }}</h1>
        <p class="page-lead">
          {{ t('admin.support.intro') }}
        </p>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="support-forbidden"
    />
    <template v-else>
      <StateBlock
        v-if="loading && cases.length === 0 && recoveries.length === 0"
        variant="loading"
      />
      <StateBlock
        v-else-if="error"
        variant="error"
        :message="error"
      />
      <template v-else>
        <section class="block">
          <div class="section-head">
            <h2>{{ t('admin.support.cases') }}</h2>
            <div class="section-actions">
              <label
                class="filter-label"
                for="case-state-filter"
              >{{ t('admin.support.state') }}</label>
              <select
                id="case-state-filter"
                v-model="caseState"
                data-testid="case-state-filter"
                @change="load"
              >
                <option
                  v-for="s in CASE_STATES"
                  :key="s"
                  :value="s"
                >
                  {{ s === '' ? t('content.hub.all') : t(`admin.support.stateValue.${s}`) }}
                </option>
              </select>
            </div>
          </div>

          <AppSearch
            v-model="search"
            input-id="admin-support-search"
          />

          <StateBlock
            v-if="filteredCases.length === 0"
            variant="empty"
            :message="search.trim() === '' ? t('admin.support.noCases') : t('search.noResults')"
          />
          <ul
            v-else
            class="cases"
            data-testid="case-list"
          >
            <li
              v-for="supportCase in filteredCases"
              :key="supportCase.id"
              class="card case"
              :data-testid="`case-${supportCase.id}`"
            >
              <div class="case-head">
                <strong>{{ supportCase.subject }}</strong>
                <span class="badge badge-neutral">{{ t(`admin.support.category.${supportCase.category}`, supportCase.category) }}</span>
                <span
                  class="status-pill status-pill-neutral"
                  :data-testid="`case-state-${supportCase.id}`"
                >{{ t(`admin.support.stateValue.${supportCase.state}`) }}</span>
                <time
                  class="muted"
                  :datetime="supportCase.createdAt"
                  :title="formatDateTime(supportCase.createdAt, activeLocale, viewerTimeZone())"
                >{{ formatRelativeTime(supportCase.createdAt, activeLocale) }}</time>
              </div>
              <p class="case-body">
                {{ supportCase.body }}
              </p>
              <p
                v-if="supportCase.resolutionNote"
                class="muted"
              >
                {{ t('admin.support.resolution') }}: {{ supportCase.resolutionNote }}
              </p>
              <div class="actions">
                <button
                  v-if="supportCase.state === 'open'"
                  type="button"
                  class="btn btn-primary"
                  :disabled="busy !== ''"
                  :data-testid="`assign-${supportCase.id}`"
                  @click="onAssign(supportCase)"
                >
                  {{ t('admin.support.assign') }}
                </button>
                <button
                  v-if="supportCase.state === 'open' || supportCase.state === 'assigned'"
                  type="button"
                  class="btn btn-secondary"
                  :disabled="busy !== ''"
                  :data-testid="`resolve-${supportCase.id}`"
                  @click="onResolve(supportCase)"
                >
                  {{ t('admin.support.resolve') }}
                </button>
                <button
                  v-if="supportCase.state !== 'closed'"
                  type="button"
                  class="btn btn-ghost"
                  :disabled="busy !== ''"
                  :data-testid="`close-${supportCase.id}`"
                  @click="onClose(supportCase)"
                >
                  {{ t('admin.support.close') }}
                </button>
              </div>
            </li>
          </ul>
        </section>

        <section class="block">
          <h2>{{ t('admin.support.recovery') }}</h2>
          <p class="muted">
            {{ t('admin.support.recoveryNote') }}
          </p>
          <StateBlock
            v-if="recoveries.length === 0"
            variant="empty"
            :message="t('admin.support.noRecovery')"
          />
          <ul
            v-else
            class="cases"
            data-testid="recovery-list"
          >
            <li
              v-for="request in recoveries"
              :key="request._id"
              class="card case"
              :data-testid="`recovery-${request._id}`"
            >
              <div class="case-head">
                <bdi class="latin-value">{{ request.accountIdMasked ?? shortId(request.accountId ?? request._id) }}</bdi>
                <span class="status-pill status-pill-neutral">{{ t(`admin.support.recoveryState.${request.state}`, request.state) }}</span>
                <time
                  class="muted"
                  :datetime="request.createdAt"
                  :title="formatDateTime(request.createdAt, activeLocale, viewerTimeZone())"
                >{{ formatRelativeTime(request.createdAt, activeLocale) }}</time>
              </div>
              <p class="case-body">
                {{ request.reason }}
              </p>
              <div
                v-if="request.state === 'pending'"
                class="actions"
              >
                <button
                  type="button"
                  class="btn btn-secondary"
                  :disabled="busy !== ''"
                  :data-testid="`review-${request._id}`"
                  @click="onReview(request, 'reviewed')"
                >
                  {{ t('admin.support.markReviewed') }}
                </button>
                <button
                  type="button"
                  class="btn btn-ghost danger"
                  :disabled="busy !== ''"
                  :data-testid="`reject-${request._id}`"
                  @click="onReview(request, 'rejected')"
                >
                  {{ t('admin.support.reject') }}
                </button>
              </div>
            </li>
          </ul>
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

.cases {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.case {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.case-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.case-body {
  margin: 0;
  color: var(--color-text-soft);
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

.danger {
  color: var(--color-danger);
}
</style>
