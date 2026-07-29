<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatNumber, formatTomanValue } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { listProducts, type MoneyView, type ProductCard, type ProductType } from '../composables/useStoreApi.ts';

/**
 * Storefront (PAGE-037, COMMERCE-014).
 *
 * The type and availability filters synchronise with the URL, so a shared link reproduces
 * the shelf. Availability is a server-reported property of the card rather than something
 * inferred here — a filter that disagreed with what the card says would be worse than none.
 */

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);
const activeQuery = computed(() => (route.query.q as string | undefined) ?? '');
const activeType = computed<ProductType | ''>(() => {
  const requested = route.query.type as string | undefined;
  return requested === 'physical' || requested === 'digital' ? requested : '';
});
const availableOnly = computed(() => route.query.available === 'true');

const searchInput = ref(activeQuery.value);
watch(activeQuery, (value) => {
  searchInput.value = value;
});

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const products = ref<ProductCard[]>([]);

let requestToken = 0;

async function load(): Promise<void> {
  const token = ++requestToken;
  loading.value = true;
  errorMessage.value = undefined;
  try {
    const page = await listProducts({
      locale: activeLocale(),
      ...(activeType.value === '' ? {} : { type: activeType.value }),
      ...(activeQuery.value === '' ? {} : { q: activeQuery.value }),
      ...(availableOnly.value ? { available: true } : {})
    });
    if (token !== requestToken) return;
    products.value = page.items;
  } catch (error) {
    if (token === requestToken) errorMessage.value = messageFor(error);
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

onMounted(load);
watch([activeQuery, activeType, availableOnly, locale], () => void load());

function navigate(patch: Record<string, string | undefined>): void {
  void router.replace({ query: { ...route.query, ...patch } });
}

function priceLabel(price: MoneyView[]): string {
  const coin = price.find((m) => m.assetCode === 'DRC');
  const rial = price.find((m) => m.assetCode === 'IRR');
  if (coin === undefined) return t('store.priceUnavailable');
  const coinLabel = `${formatNumber(coin.amountInteger, activeLocale())} ${t('money.dragonCoinUnit')}`;
  // Both are shown when a list price exists: the Dragon Coin figure is what is charged.
  return rial === undefined ? coinLabel : `${coinLabel} · ${formatTomanValue(rial.amountInteger, activeLocale())}`;
}
</script>

<template>
  <section class="stack">
    <h1>{{ t('store.catalog.title') }}</h1>
    <p class="muted">
      {{ t('store.catalog.intro') }}
    </p>

    <form
      class="filters"
      role="search"
      @submit.prevent="navigate({ q: searchInput === '' ? undefined : searchInput })"
    >
      <label for="store-search">{{ t('store.catalog.search') }}</label>
      <input
        id="store-search"
        v-model="searchInput"
        type="search"
        data-testid="store-search"
      >
      <button
        type="submit"
        data-testid="store-search-submit"
      >
        {{ t('store.catalog.searchAction') }}
      </button>

      <label for="store-type">{{ t('store.catalog.type') }}</label>
      <select
        id="store-type"
        data-testid="store-type"
        :value="activeType"
        @change="navigate({ type: ($event.target as HTMLSelectElement).value || undefined })"
      >
        <option value="">
          {{ t('store.catalog.allTypes') }}
        </option>
        <option value="digital">
          {{ t('store.type.digital') }}
        </option>
        <option value="physical">
          {{ t('store.type.physical') }}
        </option>
      </select>

      <label for="store-available">
        <input
          id="store-available"
          type="checkbox"
          data-testid="store-available"
          :checked="availableOnly"
          @change="navigate({ available: ($event.target as HTMLInputElement).checked ? 'true' : undefined })"
        >
        {{ t('store.catalog.availableOnly') }}
      </label>
    </form>

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
      v-else-if="products.length === 0"
      variant="empty"
      :message="t('store.catalog.empty')"
    />

    <ul
      v-else
      class="grid"
      data-testid="store-products"
    >
      <li
        v-for="product in products"
        :key="product.id"
        class="card"
        data-testid="store-product-card"
      >
        <RouterLink :to="`${prefix}/store/products/${product.slug}`">
          {{ product.title }}
        </RouterLink>
        <p
          class="muted"
          dir="auto"
        >
          {{ product.summary }}
        </p>
        <p data-testid="store-card-price">
          {{ priceLabel(product.fromPrice) }}
        </p>
        <p class="muted">
          <span data-testid="store-card-type">{{ t(`store.type.${product.type}`) }}</span>
          <span> · </span>
          <span data-testid="store-card-availability">{{ product.available ? t('store.available') : t('store.soldOut') }}</span>
        </p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
}
.card {
  border: 1px solid var(--color-border, #444);
  border-radius: 0.5rem;
  padding: 1rem;
}
</style>
