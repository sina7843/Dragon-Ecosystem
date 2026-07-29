<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatNumber, formatTomanValue } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { getCart, placeOrder, type CartView as Cart, type MoneyView, type ShippingAddress } from '../composables/useStoreApi.ts';

/**
 * Checkout (PAGE-040, FORM-020).
 *
 * Two things prevent a duplicate order: the idempotency key is generated once per visit
 * and reused on retry, so a double submit resolves to the same order; and the cart version
 * is sent with it, so a basket that changed underneath is rejected rather than charged.
 */

const { t, locale } = useI18n();
const router = useRouter();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);

const PROVINCES = [
  'alborz', 'ardabil', 'bushehr', 'chaharmahal_bakhtiari', 'east_azerbaijan', 'fars', 'gilan', 'golestan',
  'hamadan', 'hormozgan', 'ilam', 'isfahan', 'kerman', 'kermanshah', 'khuzestan', 'kohgiluyeh_boyerahmad',
  'kurdistan', 'lorestan', 'markazi', 'mazandaran', 'north_khorasan', 'qazvin', 'qom', 'razavi_khorasan',
  'semnan', 'sistan_baluchestan', 'south_khorasan', 'tehran', 'west_azerbaijan', 'yazd', 'zanjan'
] as const;

const loading = ref(true);
const cart = ref<Cart | null>(null);
const errorMessage = ref<string | undefined>(undefined);
const placing = ref(false);
const consent = ref(false);
const needsAddress = ref(false);

/** Generated once per visit: a retried submit must not create a second order. */
const idempotencyKey = ref(`checkout-${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`);

const address = ref<ShippingAddress>({ fullName: '', mobile: '', province: 'tehran', city: '', postalCode: '', line1: '' });

async function load(): Promise<void> {
  loading.value = true;
  try {
    const current = await getCart(activeLocale());
    cart.value = current;
    // Only a physical line needs a delivery address; a digital-only order needs none.
    needsAddress.value = current.requiresAddress;
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function submit(): Promise<void> {
  const current = cart.value;
  if (current === null || placing.value) return;
  placing.value = true;
  errorMessage.value = undefined;
  try {
    const order = await placeOrder({
      cartVersion: current.version,
      idempotencyKey: idempotencyKey.value,
      consent: consent.value,
      ...(needsAddress.value ? { address: address.value } : {})
    });
    await router.push(`${prefix.value}/account/orders?placed=${order.id}`);
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    placing.value = false;
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
    <h1>{{ t('store.checkout.title') }}</h1>

    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="cart === null || cart.items.length === 0"
      variant="empty"
      :message="t('store.cart.empty')"
    />

    <template v-else>
      <h2>{{ t('store.checkout.review') }}</h2>
      <ul data-testid="checkout-items">
        <li
          v-for="item in cart.items"
          :key="item.id"
          dir="auto"
        >
          {{ item.name }} × {{ formatNumber(item.quantity, activeLocale()) }} — {{ amountLabel(item.lineTotal) }}
        </li>
      </ul>
      <p data-testid="checkout-total">
        {{ t('store.cart.grandTotal') }}: {{ amountLabel(cart.totals.grandTotal) }}
      </p>
      <p class="muted">
        {{ t('store.checkout.paidWith') }}
      </p>

      <p
        v-if="cart.blocked"
        class="notice"
        role="note"
        data-testid="checkout-blocked"
      >
        {{ t('store.cart.blocked') }}
      </p>

      <form
        class="stack"
        novalidate
        @submit.prevent="submit"
      >
        <fieldset v-if="needsAddress">
          <legend>{{ t('store.checkout.delivery') }}</legend>
          <p class="muted">
            {{ t('store.product.domesticOnly') }}
          </p>

          <label for="checkout-name">{{ t('store.checkout.fullName') }}</label>
          <input
            id="checkout-name"
            v-model="address.fullName"
            type="text"
            data-testid="checkout-name"
          >

          <label for="checkout-mobile">{{ t('store.checkout.mobile') }}</label>
          <input
            id="checkout-mobile"
            v-model="address.mobile"
            type="tel"
            data-testid="checkout-mobile"
          >

          <label for="checkout-province">{{ t('store.checkout.province') }}</label>
          <select
            id="checkout-province"
            v-model="address.province"
            data-testid="checkout-province"
          >
            <option
              v-for="province in PROVINCES"
              :key="province"
              :value="province"
            >
              {{ t(`store.province.${province}`) }}
            </option>
          </select>

          <label for="checkout-city">{{ t('store.checkout.city') }}</label>
          <input
            id="checkout-city"
            v-model="address.city"
            type="text"
            data-testid="checkout-city"
          >

          <label for="checkout-postal">{{ t('store.checkout.postalCode') }}</label>
          <input
            id="checkout-postal"
            v-model="address.postalCode"
            type="text"
            inputmode="numeric"
            data-testid="checkout-postal"
          >

          <label for="checkout-line1">{{ t('store.checkout.line1') }}</label>
          <input
            id="checkout-line1"
            v-model="address.line1"
            type="text"
            data-testid="checkout-line1"
          >
        </fieldset>

        <label for="checkout-consent">
          <input
            id="checkout-consent"
            v-model="consent"
            type="checkbox"
            data-testid="checkout-consent"
          >
          {{ t('store.checkout.consent') }}
        </label>

        <p
          v-if="errorMessage"
          class="error"
          role="alert"
          data-testid="checkout-error"
        >
          {{ errorMessage }}
        </p>

        <button
          type="submit"
          data-testid="checkout-submit"
          :disabled="placing || !consent || cart.blocked !== null"
        >
          {{ placing ? t('store.checkout.placing') : t('store.checkout.placeOrder') }}
        </button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-inline-size: 46rem;
}
fieldset {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--color-border, #444);
  border-radius: 0.5rem;
  padding: 1rem;
}
.notice {
  border-inline-start: 4px solid var(--color-accent, #888);
  padding-inline-start: 0.75rem;
}
</style>
