<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppTable, { type TableColumn } from '../components/AppTable.vue';
import StateBlock from '../components/StateBlock.vue';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import {
  approveEntitlement,
  captureHold,
  expireHolds,
  failEntitlement,
  listEntitlements,
  listHolds,
  payEntitlement,
  releaseHold,
  type EntitlementView,
  type HoldView
} from '../composables/useOpsConsolesApi.ts';
import { formatDateTime, formatNumber, formatRelativeTime, formatTomanValue, viewerTimeZone } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Finance console (FEATURE-010): Dragon Coin holds and cash prize entitlements.
 *
 * These are the only money-moving operations in the product, and they had no reviewable
 * surface at all. Two rules are load-bearing and belong to the server, not to this screen:
 *
 * - **Dual control on the irreversible steps.** Approving an entitlement and capturing a
 *   hold need `finance.manage`; marking an entitlement *paid* and force-*releasing* a hold
 *   need `finance.approve`. Those two controls are therefore shown only to a holder of the
 *   second permission — the server refuses either way, this just avoids offering an
 *   operator a button that can only fail.
 * - **Every mutation is reasoned and idempotent.** Capture, release, and each entitlement
 *   decision require a reason, and the client attaches a fresh idempotency key so a retry
 *   after a timeout cannot move money twice.
 *
 * Nothing here can create a hold or invent an entitlement; it acts on what already exists.
 */
const { t, locale } = useI18n();
const { forbidden, has, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const HOLD_STATES = ['', 'active', 'partially_captured', 'captured', 'released', 'expired', 'cancelled'] as const;

/**
 * A hold is still actionable while it holds funds. `partially_captured` is not terminal —
 * capturing part of a hold leaves the remainder reserved — so it belongs here alongside
 * `active`; the terminal states do not.
 */
const ACTIONABLE_HOLD_STATES: readonly string[] = ['active', 'partially_captured'];
const ENTITLEMENT_STATES = ['', 'pending', 'approved', 'paid', 'failed', 'superseded'] as const;

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const canApprovePayout = computed(() => has('finance.approve'));

const loading = ref(true);
const error = ref<string | undefined>(undefined);
const holds = ref<HoldView[]>([]);
const entitlements = ref<EntitlementView[]>([]);
// Defaults to every state: the server filter takes one state at a time, and defaulting to
// `active` alone hid a partially-captured hold that still had funds reserved.
const holdState = ref<(typeof HOLD_STATES)[number]>('');
const entitlementState = ref<(typeof ENTITLEMENT_STATES)[number]>('pending');
const busy = ref('');

const holdColumns: TableColumn[] = [
  { key: 'createdAt', label: t('admin.finance.when') },
  { key: 'purpose', label: t('admin.finance.purpose') },
  { key: 'owner', label: t('admin.finance.owner'), latin: true },
  { key: 'remaining', label: t('admin.finance.remaining'), numeric: true },
  { key: 'state', label: t('admin.finance.state') }
];

function shortId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
}

const holdRows = computed(() =>
  holds.value.map((h) => ({
    row: {
      createdAt: formatRelativeTime(h.createdAt, activeLocale.value),
      purpose: t(`admin.finance.purposeValue.${h.purpose}`, h.purpose),
      owner: shortId(h.ownerId),
      remaining: `${formatNumber(h.remainingAmount, activeLocale.value)} / ${formatNumber(h.originalAmount, activeLocale.value)}`,
      state: t(`admin.finance.holdState.${h.state}`, h.state)
    },
    title: { createdAt: formatDateTime(h.createdAt, activeLocale.value, viewerTimeZone()), owner: h.ownerId }
  }))
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [holdPage, entitlementPage] = await Promise.all([
      listHolds(holdState.value === '' ? {} : { state: holdState.value }),
      listEntitlements(entitlementState.value === '' ? {} : { state: entitlementState.value })
    ]);
    holds.value = holdPage.items;
    entitlements.value = entitlementPage.items;
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

/** Every money-moving control asks for a reason first; an empty one aborts. */
function askReason(promptKey: string): string | null {
  const reason = globalThis.prompt(t(promptKey)) ?? '';
  return reason.trim() === '' ? null : reason;
}

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

async function onCapture(hold: HoldView): Promise<void> {
  const raw = globalThis.prompt(t('admin.finance.captureAmountPrompt'), String(hold.remainingAmount)) ?? '';
  const amount = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(amount) || amount <= 0) return;
  const reason = askReason('admin.finance.captureReasonPrompt');
  if (reason === null) return;
  await act(hold.id, () => captureHold(hold.id, amount, reason), 'admin.finance.captured');
}

async function onRelease(hold: HoldView): Promise<void> {
  const reason = askReason('admin.finance.releaseReasonPrompt');
  if (reason === null) return;
  await act(hold.id, () => releaseHold(hold.id, reason), 'admin.finance.released');
}

async function onExpire(): Promise<void> {
  await act('expire', () => expireHolds(), 'admin.finance.expired');
}

async function onApprove(entitlement: EntitlementView): Promise<void> {
  const reason = askReason('admin.finance.approveReasonPrompt');
  if (reason === null) return;
  await act(entitlement.id, () => approveEntitlement(entitlement.id, entitlement.version, reason), 'admin.finance.approved');
}

async function onPay(entitlement: EntitlementView): Promise<void> {
  const evidence = globalThis.prompt(t('admin.finance.evidencePrompt')) ?? '';
  if (evidence.trim() === '') return;
  const reason = askReason('admin.finance.payReasonPrompt');
  if (reason === null) return;
  await act(entitlement.id, () => payEntitlement(entitlement.id, entitlement.version, reason, evidence), 'admin.finance.paid');
}

async function onFail(entitlement: EntitlementView): Promise<void> {
  const reason = askReason('admin.finance.failReasonPrompt');
  if (reason === null) return;
  await act(entitlement.id, () => failEntitlement(entitlement.id, entitlement.version, reason), 'admin.finance.failed');
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('admin.finance.heading') }}</h1>
        <p class="page-lead">
          {{ t('admin.finance.intro') }}
        </p>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="finance-forbidden"
    />
    <template v-else>
      <!-- Stated once, at the top: which of this screen's actions the operator cannot
           take, so a missing button is explained rather than merely absent. -->
      <p
        v-if="!canApprovePayout"
        class="muted dual-note"
        data-testid="dual-control-note"
      >
        {{ t('admin.finance.dualControlNote') }}
      </p>

      <StateBlock
        v-if="loading && holds.length === 0 && entitlements.length === 0"
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
            <h2>{{ t('admin.finance.holds') }}</h2>
            <div class="section-actions">
              <label
                class="filter-label"
                for="hold-state-filter"
              >{{ t('admin.finance.state') }}</label>
              <select
                id="hold-state-filter"
                v-model="holdState"
                data-testid="hold-state-filter"
                @change="load"
              >
                <option
                  v-for="s in HOLD_STATES"
                  :key="s"
                  :value="s"
                >
                  {{ s === '' ? t('content.hub.all') : t(`admin.finance.holdState.${s}`) }}
                </option>
              </select>
              <button
                type="button"
                class="btn btn-secondary"
                :disabled="busy !== ''"
                data-testid="expire-holds"
                @click="onExpire"
              >
                {{ t('admin.finance.expireDue') }}
              </button>
            </div>
          </div>

          <AppTable
            :caption="t('admin.finance.holdsCaption')"
            :columns="holdColumns"
            :rows="holdRows.map((r) => r.row)"
            :titles="holdRows.map((r) => r.title)"
            :empty-message="t('admin.finance.noHolds')"
            dense
          />

          <!-- Capture and release are per-hold and destructive to a reservation, so they
               live beside each row rather than as a bulk control. -->
          <ul
            v-if="holds.length > 0"
            class="row-actions"
            data-testid="hold-actions"
          >
            <li
              v-for="hold in holds.filter((h) => ACTIONABLE_HOLD_STATES.includes(h.state))"
              :key="hold.id"
            >
              <bdi class="latin-value">{{ shortId(hold.id) }}</bdi>
              <span class="muted">{{ formatNumber(hold.remainingAmount, activeLocale) }} {{ t('wallet.coinUnit') }}</span>
              <button
                type="button"
                class="btn btn-primary"
                :disabled="busy !== ''"
                :data-testid="`capture-${hold.id}`"
                @click="onCapture(hold)"
              >
                {{ t('admin.finance.capture') }}
              </button>
              <!-- A force-release overrides a reservation, so it sits behind the same
                   permission as a payout rather than beside capture. -->
              <button
                v-if="canApprovePayout"
                type="button"
                class="btn btn-ghost"
                :disabled="busy !== ''"
                :data-testid="`release-${hold.id}`"
                @click="onRelease(hold)"
              >
                {{ t('admin.finance.release') }}
              </button>
            </li>
          </ul>
        </section>

        <section class="block">
          <div class="section-head">
            <h2>{{ t('admin.finance.entitlements') }}</h2>
            <div class="section-actions">
              <label
                class="filter-label"
                for="entitlement-state-filter"
              >{{ t('admin.finance.state') }}</label>
              <select
                id="entitlement-state-filter"
                v-model="entitlementState"
                data-testid="entitlement-state-filter"
                @change="load"
              >
                <option
                  v-for="s in ENTITLEMENT_STATES"
                  :key="s"
                  :value="s"
                >
                  {{ s === '' ? t('content.hub.all') : t(`wallet.entitlementState.${s}`, s) }}
                </option>
              </select>
            </div>
          </div>

          <StateBlock
            v-if="entitlements.length === 0"
            variant="empty"
            :message="t('admin.finance.noEntitlements')"
          />
          <ul
            v-else
            class="entitlements"
            data-testid="entitlement-list"
          >
            <li
              v-for="entitlement in entitlements"
              :key="entitlement.id"
              class="card entitlement"
              :data-testid="`entitlement-${entitlement.id}`"
            >
              <div class="entitlement-head">
                <span class="amount">{{ formatTomanValue(entitlement.amount, activeLocale) }} {{ t('money.tomanUnit') }}</span>
                <span class="badge badge-neutral">{{ t('admin.finance.rank', { rank: formatNumber(entitlement.rank, activeLocale) }) }}</span>
                <span
                  class="status-pill"
                  :class="entitlement.state === 'paid' ? 'status-pill-success' : entitlement.state === 'failed' ? 'status-pill-danger' : 'status-pill-neutral'"
                  :data-testid="`entitlement-state-${entitlement.id}`"
                >{{ t(`wallet.entitlementState.${entitlement.state}`, entitlement.state) }}</span>
                <time
                  class="muted"
                  :datetime="entitlement.createdAt"
                  :title="formatDateTime(entitlement.createdAt, activeLocale, viewerTimeZone())"
                >{{ formatRelativeTime(entitlement.createdAt, activeLocale) }}</time>
              </div>
              <p
                v-if="entitlement.settlementEvidence"
                class="muted"
              >
                {{ t('admin.finance.evidence') }}: {{ entitlement.settlementEvidence }}
              </p>
              <div class="actions">
                <button
                  v-if="entitlement.state === 'pending'"
                  type="button"
                  class="btn btn-primary"
                  :disabled="busy !== ''"
                  :data-testid="`approve-${entitlement.id}`"
                  @click="onApprove(entitlement)"
                >
                  {{ t('admin.finance.approve') }}
                </button>
                <!-- Payout is the dual-control step: a different permission from approving. -->
                <button
                  v-if="entitlement.state === 'approved' && canApprovePayout"
                  type="button"
                  class="btn btn-primary"
                  :disabled="busy !== ''"
                  :data-testid="`pay-${entitlement.id}`"
                  @click="onPay(entitlement)"
                >
                  {{ t('admin.finance.pay') }}
                </button>
                <button
                  v-if="entitlement.state === 'pending' || entitlement.state === 'approved'"
                  type="button"
                  class="btn btn-ghost danger"
                  :disabled="busy !== ''"
                  :data-testid="`fail-${entitlement.id}`"
                  @click="onFail(entitlement)"
                >
                  {{ t('admin.finance.markFailed') }}
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

.row-actions,
.entitlements {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.row-actions li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.entitlement {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.entitlement-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.amount {
  font-weight: var(--weight-black);
  font-size: var(--text-lg);
}

.muted {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.dual-note {
  margin-block-end: var(--space-3);
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
