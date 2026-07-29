<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatNumber, formatTomanValue } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { getCart, setCartDiscount, setCartItem, type CartView as Cart, type MoneyView } from '../composables/useStoreApi.ts';

/**
 * Cart (PAGE-039).
 *
 * Every figure shown is the server's. The page never adds anything up itself, so what the
 * customer reads here is what checkout will charge (COMMERCE-004).
 */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const cart = ref<Cart | null>(null);
const codeInput = ref('');

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = undefined;
  try {
    cart.value = await getCart(activeLocale());
    codeInput.value = cart.value.discountCode ?? '';
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function change(variantId: string, quantity: number): Promise<void> {
  try {
    cart.value = await setCartItem(activeLocale(), variantId, Math.max(0, quantity));
  } catch (error) {
    errorMessage.value = messageFor(error);
  }
}

async function applyCode(): Promise<void> {
  try {
    cart.value = await setCartDiscount(activeLocale(), codeInput.value === '' ? null : codeInput.value);
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
</script>

<template>
  <section class="stack">
    <h1>{{ t('store.cart.title') }}</h1>

    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="errorMessage && cart === null"
      variant="error"
      :message="errorMessage"
    />
    <StateBlock
      v-else-if="cart === null || cart.items.length === 0"
      variant="empty"
      :message="t('store.cart.empty')"
    />

    <template v-else>
      <p
        v-if="errorMessage"
        class="error"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <table data-testid="cart-items">
        <caption>{{ t('store.cart.caption') }}</caption>
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
            <th scope="col">
              {{ t('store.cart.actions') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in cart.items"
            :key="item.id"
            data-testid="cart-row"
          >
            <td dir="auto">
              {{ item.name }} <span class="muted">{{ item.sku }}</span>
            </td>
            <td>
              <input
                type="number"
                min="0"
                max="99"
                class="quantity"
                :aria-label="t('store.cart.quantityFor', { item: item.name })"
                :value="item.quantity"
                data-testid="cart-quantity"
                @change="change(item.variantId, Number(($event.target as HTMLInputElement).value))"
              >
            </td>
            <td data-testid="cart-line-total">
              {{ amountLabel(item.lineTotal) }}
            </td>
            <td>
              <button
                type="button"
                data-testid="cart-remove"
                @click="change(item.variantId, 0)"
              >
                {{ t('store.cart.remove') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <form
        class="row"
        novalidate
        @submit.prevent="applyCode"
      >
        <label for="cart-discount">{{ t('store.cart.discountCode') }}</label>
        <input
          id="cart-discount"
          v-model="codeInput"
          type="text"
          maxlength="24"
          data-testid="cart-discount"
        >
        <button
          type="submit"
          data-testid="cart-apply-discount"
        >
          {{ t('store.cart.apply') }}
        </button>
      </form>
      <p
        v-if="cart.discountProblem"
        class="error"
        role="status"
        data-testid="cart-discount-problem"
      >
        {{ t(`store.discountProblem.${cart.discountProblem}`) }}
      </p>

      <dl class="totals">
        <div>
          <dt>{{ t('store.cart.subtotal') }}</dt>
          <dd data-testid="cart-subtotal">
            {{ amountLabel(cart.totals.itemSubtotal) }}
          </dd>
        </div>
        <div>
          <dt>{{ t('store.cart.discount') }}</dt>
          <dd data-testid="cart-discount-total">
            {{ amountLabel(cart.totals.discountTotal) }}
          </dd>
        </div>
        <div>
          <!-- Shown as zero rather than hidden, so the total has no unexplained gap. -->
          <dt>{{ t('store.cart.shipping') }}</dt>
          <dd data-testid="cart-shipping">
            {{ amountLabel(cart.totals.shippingTotal) }}
          </dd>
        </div>
        <div>
          <dt>{{ t('store.cart.grandTotal') }}</dt>
          <dd data-testid="cart-grand-total">
            {{ amountLabel(cart.totals.grandTotal) }}
          </dd>
        </div>
      </dl>

      <p
        v-if="cart.blocked"
        class="notice"
        role="note"
        data-testid="cart-blocked"
      >
        {{ t('store.cart.blocked') }}
      </p>

      <RouterLink
        v-else
        :to="`${prefix}/checkout`"
        data-testid="cart-checkout"
      >
        {{ t('store.cart.checkout') }}
      </RouterLink>
    </template>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
.quantity {
  inline-size: 4rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.totals {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.totals div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.notice {
  border-inline-start: 4px solid var(--color-accent, #888);
  padding-inline-start: 0.75rem;
}
</style>
