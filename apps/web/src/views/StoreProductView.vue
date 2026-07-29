<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatNumber, formatTomanValue } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { getProduct, setCartItem, type MoneyView, type ProductDetail } from '../composables/useStoreApi.ts';

/**
 * Product detail (PAGE-038).
 *
 * An unavailable variant cannot be added, and the domestic-shipping limitation is stated
 * up front rather than discovered at checkout. Both facts come from the server payload, so
 * the page cannot offer an action the API will refuse.
 */

const { t, locale } = useI18n();
const route = useRoute();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);

const loading = ref(true);
const notFound = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const product = ref<ProductDetail | null>(null);
const selectedVariantId = ref('');
const quantity = ref(1);
const adding = ref(false);
const added = ref(false);

const selected = computed(() => product.value?.variants.find((v) => v.id === selectedVariantId.value) ?? null);

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  try {
    const detail = await getProduct(String(route.params.slug), activeLocale());
    product.value = detail;
    selectedVariantId.value = detail.variants.find((v) => v.available)?.id ?? detail.variants[0]?.id ?? '';
  } catch (error) {
    product.value = null;
    if ((error as { status?: number }).status === 404) notFound.value = true;
    else errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function addToCart(): Promise<void> {
  const variant = selected.value;
  if (variant === null || adding.value) return;
  adding.value = true;
  errorMessage.value = undefined;
  try {
    await setCartItem(activeLocale(), variant.id, quantity.value);
    added.value = true;
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    adding.value = false;
  }
}

function priceLabel(price: MoneyView[]): string {
  const coin = price.find((m) => m.assetCode === 'DRC');
  const rial = price.find((m) => m.assetCode === 'IRR');
  if (coin === undefined) return t('store.priceUnavailable');
  const coinLabel = `${formatNumber(coin.amountInteger, activeLocale())} ${t('money.dragonCoinUnit')}`;
  return rial === undefined ? coinLabel : `${coinLabel} · ${formatTomanValue(rial.amountInteger, activeLocale())}`;
}
</script>

<template>
  <section class="stack">
    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="notFound || product === null"
      variant="notFound"
      :heading-level="1"
    />

    <template v-else>
      <h1 dir="auto">
        {{ product.title }}
      </h1>
      <p
        class="muted"
        dir="auto"
      >
        {{ product.summary }}
      </p>
      <p
        dir="auto"
        data-testid="store-product-description"
      >
        {{ product.description }}
      </p>

      <p data-testid="store-product-type">
        {{ t(`store.type.${product.type}`) }}
      </p>
      <!-- Stated before the customer commits: physical delivery is domestic only, and
           while OD-019 is unresolved a physical item cannot be bought at all. -->
      <p
        v-if="product.type === 'physical'"
        class="notice"
        role="note"
        data-testid="store-domestic-notice"
      >
        {{ t('store.product.domesticOnly') }}
      </p>
      <p
        v-if="!product.purchasable"
        class="notice"
        role="note"
        data-testid="store-not-purchasable"
      >
        {{ t('store.product.physicalGated') }}
      </p>

      <label for="store-variant">{{ t('store.product.variant') }}</label>
      <select
        id="store-variant"
        v-model="selectedVariantId"
        data-testid="store-variant"
      >
        <option
          v-for="variant in product.variants"
          :key="variant.id"
          :value="variant.id"
          :disabled="!variant.available"
        >
          {{ variant.name }} — {{ priceLabel(variant.price) }}{{ variant.available ? '' : ` (${t('store.soldOut')})` }}
        </option>
      </select>

      <p
        v-if="selected && selected.stockOnHand !== null"
        class="muted"
        data-testid="store-variant-stock"
      >
        {{ t('store.product.stock', { count: formatNumber(selected.stockOnHand, activeLocale()) }) }}
      </p>

      <label for="store-quantity">{{ t('store.product.quantity') }}</label>
      <input
        id="store-quantity"
        v-model.number="quantity"
        type="number"
        min="1"
        max="99"
        data-testid="store-quantity"
      >

      <p
        v-if="errorMessage"
        class="error"
        role="alert"
      >
        {{ errorMessage }}
      </p>
      <p
        v-if="added"
        role="status"
        data-testid="store-added"
      >
        {{ t('store.product.added') }}
        <RouterLink :to="`${prefix}/cart`">
          {{ t('store.product.goToCart') }}
        </RouterLink>
      </p>

      <button
        type="button"
        data-testid="store-add-to-cart"
        :disabled="adding || selected === null || !selected.available || !product.purchasable"
        @click="addToCart"
      >
        {{ t('store.product.addToCart') }}
      </button>
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
.notice {
  border-inline-start: 4px solid var(--color-accent, #888);
  padding-inline-start: 0.75rem;
}
</style>
