<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatNumber } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import {
  approveEntitlement,
  failEntitlement,
  getFinanceReconciliation,
  listAdminEntitlements,
  payEntitlement,
  retryEntitlement,
  reverseEntitlement,
  verifyRecipient,
  type EntitlementView
} from '../composables/useEconomyApi.ts';

/**
 * Prize settlement console (PAGE-060, PAYOUT-006..012).
 *
 * Settlement is manual and off-platform — no payout provider is called from here. The
 * page cannot bypass the server's controls: the settle action is refused unless the
 * recipient was verified and the approving actor was somebody else, and the reconciliation
 * panel reports those violations rather than the page trying to prevent them cosmetically.
 */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const loading = ref(true);
const forbidden = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const entitlements = ref<EntitlementView[]>([]);
const reconciliation = ref<Awaited<ReturnType<typeof getFinanceReconciliation>> | null>(null);
const reasons = ref<Record<string, string>>({});
const evidence = ref<Record<string, string>>({});

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = undefined;
  forbidden.value = false;
  try {
    entitlements.value = (await listAdminEntitlements()).items;
    reconciliation.value = await getFinanceReconciliation();
  } catch (error) {
    if ((error as { status?: number }).status === 403) forbidden.value = true;
    else errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function act(entitlement: EntitlementView, action: 'verify' | 'approve' | 'pay' | 'fail' | 'retry' | 'reverse'): Promise<void> {
  const reason = (reasons.value[entitlement.id] ?? '').trim();
  if (reason === '') return;
  errorMessage.value = undefined;
  try {
    if (action === 'verify') await verifyRecipient(entitlement.id, entitlement.version, reason);
    else if (action === 'approve') await approveEntitlement(entitlement.id, entitlement.version, reason);
    else if (action === 'pay') await payEntitlement(entitlement.id, entitlement.version, reason, (evidence.value[entitlement.id] ?? '').trim());
    else if (action === 'fail') await failEntitlement(entitlement.id, entitlement.version, reason);
    else if (action === 'retry') await retryEntitlement(entitlement.id, entitlement.version, reason);
    else await reverseEntitlement(entitlement.id, entitlement.version, reason);
    reasons.value[entitlement.id] = '';
    evidence.value[entitlement.id] = '';
    await load();
  } catch (error) {
    errorMessage.value = messageFor(error);
  }
}
</script>

<template>
  <section class="stack">
    <h1>{{ t('admin.prizes.title') }}</h1>
    <p class="muted">
      {{ t('admin.prizes.intro') }}
    </p>
    <p
      class="notice"
      role="note"
      data-testid="admin-prizes-dual-control"
    >
      {{ t('admin.prizes.dualControl') }}
    </p>

    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="forbidden"
      variant="forbidden"
    />

    <template v-else>
      <p
        v-if="errorMessage"
        class="error"
        role="alert"
        data-testid="admin-prizes-error"
      >
        {{ errorMessage }}
      </p>

      <section
        v-if="reconciliation"
        class="card"
        data-testid="admin-prizes-reconciliation"
      >
        <h2>{{ t('admin.prizes.reconciliation') }}</h2>
        <p>{{ t('admin.prizes.outstanding', { amount: formatNumber(Math.trunc(reconciliation.cash.outstandingAmount / 10), activeLocale()) }) }}</p>
        <p>{{ t('admin.prizes.settled', { amount: formatNumber(Math.trunc(reconciliation.cash.settledAmount / 10), activeLocale()) }) }}</p>
        <p data-testid="admin-prizes-reconciliation-result">
          {{
            reconciliation.differences.length === 0
              ? t('admin.prizes.reconciled')
              : t('admin.prizes.differences', { count: formatNumber(reconciliation.differences.length, activeLocale()) })
          }}
        </p>
      </section>

      <StateBlock
        v-if="entitlements.length === 0"
        variant="empty"
        :message="t('admin.prizes.empty')"
        :heading-level="2"
      />
      <ul
        v-else
        class="list"
        data-testid="admin-entitlements"
      >
        <li
          v-for="entitlement in entitlements"
          :key="entitlement.id"
          class="card"
        >
          <p>
            <span>{{ t('admin.prizes.amount') }}: {{ formatNumber(entitlement.tomanAmount, activeLocale()) }}</span>
            <span> · </span>
            <span data-testid="entitlement-state">{{ t(`admin.entitlementState.${entitlement.state}`) }}</span>
            <span
              v-if="entitlement.recipientVerifiedBy"
              class="muted"
              data-testid="entitlement-verified"
            > · ✓</span>
          </p>

          <label :for="`reason-${entitlement.id}`">{{ t('admin.prizes.reason') }}</label>
          <input
            :id="`reason-${entitlement.id}`"
            v-model="reasons[entitlement.id]"
            type="text"
            maxlength="500"
            data-testid="entitlement-reason"
          >

          <label :for="`evidence-${entitlement.id}`">{{ t('admin.prizes.evidence') }}</label>
          <input
            :id="`evidence-${entitlement.id}`"
            v-model="evidence[entitlement.id]"
            type="text"
            maxlength="1000"
            data-testid="entitlement-evidence"
          >

          <div class="row">
            <button
              type="button"
              data-testid="entitlement-verify"
              :disabled="(reasons[entitlement.id] ?? '').trim() === '' || entitlement.recipientVerifiedBy !== null"
              @click="act(entitlement, 'verify')"
            >
              {{ t('admin.prizes.verify') }}
            </button>
            <button
              type="button"
              data-testid="entitlement-approve"
              :disabled="(reasons[entitlement.id] ?? '').trim() === '' || entitlement.state !== 'pending'"
              @click="act(entitlement, 'approve')"
            >
              {{ t('admin.prizes.approve') }}
            </button>
            <button
              type="button"
              data-testid="entitlement-pay"
              :disabled="(reasons[entitlement.id] ?? '').trim() === '' || (evidence[entitlement.id] ?? '').trim() === '' || entitlement.state !== 'approved'"
              @click="act(entitlement, 'pay')"
            >
              {{ t('admin.prizes.pay') }}
            </button>
            <button
              type="button"
              data-testid="entitlement-fail"
              :disabled="(reasons[entitlement.id] ?? '').trim() === '' || entitlement.state !== 'approved'"
              @click="act(entitlement, 'fail')"
            >
              {{ t('admin.prizes.fail') }}
            </button>
            <button
              type="button"
              data-testid="entitlement-retry"
              :disabled="(reasons[entitlement.id] ?? '').trim() === '' || entitlement.state !== 'failed'"
              @click="act(entitlement, 'retry')"
            >
              {{ t('admin.prizes.retry') }}
            </button>
            <button
              type="button"
              data-testid="entitlement-reverse"
              :disabled="(reasons[entitlement.id] ?? '').trim() === '' || entitlement.state !== 'paid'"
              @click="act(entitlement, 'reverse')"
            >
              {{ t('admin.prizes.reverse') }}
            </button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.card {
  border: 1px solid var(--color-border, #444);
  border-radius: 0.5rem;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.notice {
  border-inline-start: 4px solid var(--color-accent, #888);
  padding-inline-start: 0.75rem;
}
</style>
