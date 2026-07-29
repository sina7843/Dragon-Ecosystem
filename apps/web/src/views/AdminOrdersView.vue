<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, formatNumber, viewerTimeZone } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import {
  getReconciliation,
  listOperatorOrders,
  listOrderFulfillments,
  setFulfillmentState,
  type FulfillmentState,
  type OrderView
} from '../composables/useStoreApi.ts';

/**
 * Order operations (PAGE-057, COMMERCE-008).
 *
 * Fulfillment states here are internal operational records, not carrier events — OD-019
 * has selected no carrier, so nothing on this page books or tracks a shipment. No ledger
 * change can be made from this console.
 */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const loading = ref(true);
const forbidden = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const orders = ref<OrderView[]>([]);
const reconciliation = ref<{ paidOrders: number; itemSum: number; orderSum: number; differences: unknown[] } | null>(null);

const openOrderId = ref('');
const fulfillments = ref<Array<{ id: string; type: string; state: FulfillmentState }>>([]);
const reasons = ref<Record<string, string>>({});

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = undefined;
  forbidden.value = false;
  try {
    orders.value = (await listOperatorOrders()).items;
    reconciliation.value = await getReconciliation();
  } catch (error) {
    if ((error as { status?: number }).status === 403) forbidden.value = true;
    else errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function open(orderId: string): Promise<void> {
  openOrderId.value = orderId;
  try {
    fulfillments.value = (await listOrderFulfillments(orderId)).items;
  } catch (error) {
    errorMessage.value = messageFor(error);
  }
}

async function advance(id: string, state: FulfillmentState): Promise<void> {
  const reason = (reasons.value[id] ?? '').trim();
  if (reason === '') return;
  errorMessage.value = undefined;
  try {
    await setFulfillmentState(id, state, reason);
    reasons.value[id] = '';
    await open(openOrderId.value);
  } catch (error) {
    errorMessage.value = messageFor(error);
  }
}

function when(value: string): string {
  return formatDateTime(value, activeLocale(), viewerTimeZone());
}
</script>

<template>
  <section class="stack">
    <h1>{{ t('admin.orders.title') }}</h1>
    <p class="muted">
      {{ t('admin.orders.intro') }}
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
      >
        {{ errorMessage }}
      </p>

      <section
        v-if="reconciliation"
        class="card"
        data-testid="admin-reconciliation"
      >
        <h2>{{ t('admin.orders.reconciliation') }}</h2>
        <p>
          {{ t('admin.orders.paidOrders', { count: formatNumber(reconciliation.paidOrders, activeLocale()) }) }}
        </p>
        <p data-testid="admin-reconciliation-result">
          {{
            reconciliation.differences.length === 0
              ? t('admin.orders.reconciled')
              : t('admin.orders.differences', { count: formatNumber(reconciliation.differences.length, activeLocale()) })
          }}
        </p>
      </section>

      <StateBlock
        v-if="orders.length === 0"
        variant="empty"
        :message="t('admin.orders.empty')"
        :heading-level="2"
      />
      <ul
        v-else
        class="list"
        data-testid="admin-orders"
      >
        <li
          v-for="order in orders"
          :key="order.id"
          class="card"
        >
          <p>
            <span>{{ order.reference }}</span>
            <span> · </span>
            <span data-testid="admin-order-state">{{ t(`store.orderState.${order.state}`) }}</span>
            <span class="muted"> · {{ when(order.createdAt) }}</span>
          </p>
          <button
            type="button"
            data-testid="admin-order-open"
            @click="open(order.id)"
          >
            {{ t('admin.orders.viewFulfillment') }}
          </button>

          <ul
            v-if="openOrderId === order.id"
            class="list"
            data-testid="admin-fulfillments"
          >
            <li
              v-for="fulfillment in fulfillments"
              :key="fulfillment.id"
            >
              <span>{{ t(`store.type.${fulfillment.type}`) }} — {{ t(`store.fulfillmentState.${fulfillment.state}`) }}</span>
              <form
                class="row"
                novalidate
                @submit.prevent="advance(fulfillment.id, 'packed')"
              >
                <label :for="`reason-${fulfillment.id}`">{{ t('admin.orders.reason') }}</label>
                <input
                  :id="`reason-${fulfillment.id}`"
                  v-model="reasons[fulfillment.id]"
                  type="text"
                  maxlength="500"
                  data-testid="admin-fulfillment-reason"
                >
                <button
                  type="submit"
                  data-testid="admin-fulfillment-pack"
                  :disabled="fulfillment.state !== 'pending' || (reasons[fulfillment.id] ?? '').trim() === ''"
                >
                  {{ t('admin.orders.markPacked') }}
                </button>
              </form>
            </li>
          </ul>
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
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
</style>
