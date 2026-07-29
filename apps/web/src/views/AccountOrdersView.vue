<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, formatNumber, formatTomanValue, viewerTimeZone } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { getMyOrder, listMyOrders, type MoneyView, type OrderDetail, type OrderView } from '../composables/useStoreApi.ts';

/**
 * Own orders and receipts (PAGE-041, COMMERCE-009).
 *
 * The receipt shows the server's reconciliation result rather than adding the lines up
 * here. If the stored total ever disagreed with its own line items the page says so,
 * instead of rendering a figure that looks right because the client recomputed it.
 */

const { t, locale } = useI18n();
const route = useRoute();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const orders = ref<OrderView[]>([]);
const detail = ref<OrderDetail | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = undefined;
  try {
    orders.value = (await listMyOrders()).items;
    const placed = route.query.placed as string | undefined;
    if (placed !== undefined) await open(placed);
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function open(id: string): Promise<void> {
  try {
    detail.value = await getMyOrder(id);
  } catch (error) {
    errorMessage.value = messageFor(error);
  }
}

function amountLabel(amounts: MoneyView[]): string {
  const coin = amounts.find((m) => m.assetCode === 'DRC');
  const rial = amounts.find((m) => m.assetCode === 'IRR');
  const coinLabel = `${formatNumber(coin?.amountInteger ?? 0, activeLocale())} ${t('money.dragonCoinUnit')}`;
  return rial === undefined ? coinLabel : `${coinLabel} · ${formatTomanValue(rial.amountInteger, activeLocale())}`;
}

function when(value: string): string {
  return formatDateTime(value, activeLocale(), viewerTimeZone());
}
</script>

<template>
  <section class="stack">
    <h1>{{ t('store.orders.title') }}</h1>

    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />
    <StateBlock
      v-else-if="orders.length === 0"
      variant="empty"
      :message="t('store.orders.empty')"
    />

    <ul
      v-else
      class="orders"
      data-testid="account-orders"
    >
      <li
        v-for="order in orders"
        :key="order.id"
        class="order"
        data-testid="account-order"
      >
        <p>
          <span data-testid="order-reference">{{ order.reference }}</span>
          <span> · </span>
          <span data-testid="order-state">{{ t(`store.orderState.${order.state}`) }}</span>
          <span> · </span>
          <span data-testid="order-total">{{ amountLabel(order.grandTotal) }}</span>
        </p>
        <p class="muted">
          <time :datetime="order.createdAt">{{ when(order.createdAt) }}</time>
        </p>
        <button
          type="button"
          data-testid="order-open"
          @click="open(order.id)"
        >
          {{ t('store.orders.viewReceipt') }}
        </button>
      </li>
    </ul>

    <section
      v-if="detail"
      class="receipt"
      data-testid="order-receipt"
    >
      <h2>{{ t('store.orders.receipt', { reference: detail.order.reference }) }}</h2>
      <table>
        <caption>{{ t('store.orders.receiptCaption') }}</caption>
        <thead>
          <tr>
            <th scope="col">
              {{ t('store.cart.item') }}
            </th>
            <th scope="col">
              {{ t('store.cart.quantity') }}
            </th>
            <th scope="col">
              {{ t('store.cart.lineTotal') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in detail.items"
            :key="item.id"
          >
            <td dir="auto">
              {{ item.titleSnapshot[activeLocale()] }} <span class="muted">{{ item.skuSnapshot }}</span>
            </td>
            <td>{{ formatNumber(item.quantity, activeLocale()) }}</td>
            <td>{{ amountLabel(item.lineTotal) }}</td>
          </tr>
        </tbody>
      </table>

      <dl class="totals">
        <div>
          <dt>{{ t('store.cart.subtotal') }}</dt>
          <dd>{{ amountLabel(detail.order.itemSubtotal) }}</dd>
        </div>
        <div>
          <dt>{{ t('store.cart.discount') }}</dt>
          <dd>{{ amountLabel(detail.order.discountTotal) }}</dd>
        </div>
        <div>
          <dt>{{ t('store.cart.shipping') }}</dt>
          <dd>{{ amountLabel(detail.order.shippingTotal) }}</dd>
        </div>
        <div>
          <dt>{{ t('store.cart.grandTotal') }}</dt>
          <dd data-testid="receipt-total">
            {{ amountLabel(detail.order.grandTotal) }}
          </dd>
        </div>
      </dl>

      <p
        v-if="detail.receipt.reconciles"
        class="muted"
        data-testid="receipt-reconciles"
      >
        {{ t('store.orders.reconciles') }}
      </p>
      <p
        v-else
        class="error"
        role="alert"
        data-testid="receipt-mismatch"
      >
        {{ t('store.orders.mismatch') }}
      </p>

      <p
        v-if="detail.entitlements.length > 0"
        data-testid="receipt-entitlements"
      >
        {{ t('store.orders.entitlements', { count: formatNumber(detail.entitlements.length, activeLocale()) }) }}
      </p>

      <ul
        v-if="detail.fulfillments.length > 0"
        data-testid="receipt-fulfillments"
      >
        <li
          v-for="fulfillment in detail.fulfillments"
          :key="fulfillment.id"
        >
          {{ t(`store.type.${fulfillment.type}`) }} — {{ t(`store.fulfillmentState.${fulfillment.state}`) }}
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.orders {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.order,
.receipt {
  border: 1px solid var(--color-border, #444);
  border-radius: 0.5rem;
  padding: 1rem;
}
table {
  inline-size: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: start;
  padding: 0.5rem;
  border-block-end: 1px solid var(--color-border, #444);
}
.totals div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
</style>
