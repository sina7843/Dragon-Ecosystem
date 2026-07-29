<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, formatNumber, viewerTimeZone } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import {
  adjustInventory,
  createProduct,
  createVariant,
  getStoreConfig,
  listInventoryMovements,
  listProducts,
  setProductStatus,
  type ProductCard,
  type ProductType,
  type StoreConfig
} from '../composables/useStoreApi.ts';

/**
 * Store administration (PAGE-056, ROLE-021).
 *
 * A shop operator moves goods, not money: there is no ledger, refund, or payout control
 * on this page, and the server holds no such permission for this role either. Every stock
 * change requires a reason and is written to an append-only history (COMMERCE-013).
 */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();
const { canManageStore, refresh: refreshCapabilities } = useAdmin();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const loading = ref(true);
const forbidden = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const config = ref<StoreConfig | null>(null);
const products = ref<ProductCard[]>([]);

const draft = ref({ type: 'digital' as ProductType, titleFa: '', titleEn: '', sku: '', dragonCoinAmount: 100, stockOnHand: 0 });
const creating = ref(false);

const inventoryVariantId = ref('');
const inventoryDelta = ref(1);
const inventoryReason = ref('');
const movements = ref<Array<{ id: string; quantityDelta: number; reason: string; resultingQuantity: number; createdAt: string }>>([]);

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = undefined;
  forbidden.value = false;
  try {
    /**
     * The permission is probed explicitly, because neither call below can reveal its
     * absence: `/store/config` and `/products` are the public storefront's own endpoints
     * and answer 200 for anybody. Deciding the gate from them meant this operator console
     * — the create form, the price and SKU fields, the inventory controls — rendered in
     * full for any signed-in user, who could then only watch the server reject everything.
     * The server was never the hole; the page simply never asked whether it should render.
     */
    await refreshCapabilities();
    if (!canManageStore.value) {
      forbidden.value = true;
      return;
    }
    config.value = await getStoreConfig();
    products.value = (await listProducts({ locale: activeLocale() })).items;
  } catch (error) {
    if ((error as { status?: number }).status === 403) forbidden.value = true;
    else errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** Creates a product with one priced variant and publishes it in a single operator step. */
async function create(): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  errorMessage.value = undefined;
  try {
    const product = await createProduct({
      type: draft.value.type,
      translations: {
        fa: { title: draft.value.titleFa },
        en: { title: draft.value.titleEn }
      }
    });
    await createVariant(product.id, {
      sku: draft.value.sku,
      translations: { fa: { name: draft.value.titleFa }, en: { name: draft.value.titleEn } },
      price: { dragonCoinAmount: draft.value.dragonCoinAmount },
      ...(draft.value.type === 'physical' ? { stockOnHand: draft.value.stockOnHand } : {})
    });
    await setProductStatus(product.id, 'published', 'Published from the store console.');
    draft.value.titleFa = '';
    draft.value.titleEn = '';
    draft.value.sku = '';
    await load();
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    creating.value = false;
  }
}

async function adjust(): Promise<void> {
  if (inventoryVariantId.value === '' || inventoryReason.value.trim() === '') return;
  errorMessage.value = undefined;
  try {
    await adjustInventory(inventoryVariantId.value, inventoryDelta.value, inventoryReason.value);
    movements.value = (await listInventoryMovements(inventoryVariantId.value)).items;
    inventoryReason.value = '';
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
    <h1>{{ t('admin.store.title') }}</h1>
    <p class="muted">
      {{ t('admin.store.intro') }}
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
        v-if="config && !config.physicalFulfillmentEnabled"
        class="notice"
        role="note"
        data-testid="admin-store-physical-gate"
      >
        {{ t('admin.store.physicalGate') }}
      </p>

      <p
        v-if="errorMessage"
        class="error"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <form
        class="stack card"
        novalidate
        @submit.prevent="create"
      >
        <h2>{{ t('admin.store.newProduct') }}</h2>

        <label for="product-type">{{ t('store.catalog.type') }}</label>
        <select
          id="product-type"
          v-model="draft.type"
          data-testid="admin-product-type"
        >
          <option value="digital">
            {{ t('store.type.digital') }}
          </option>
          <option value="physical">
            {{ t('store.type.physical') }}
          </option>
        </select>

        <label for="product-title-fa">{{ t('admin.store.titleFa') }}</label>
        <input
          id="product-title-fa"
          v-model="draft.titleFa"
          type="text"
          dir="auto"
          data-testid="admin-product-title-fa"
        >

        <label for="product-title-en">{{ t('admin.store.titleEn') }}</label>
        <input
          id="product-title-en"
          v-model="draft.titleEn"
          type="text"
          dir="auto"
          data-testid="admin-product-title-en"
        >

        <label for="product-sku">{{ t('admin.store.sku') }}</label>
        <input
          id="product-sku"
          v-model="draft.sku"
          type="text"
          data-testid="admin-product-sku"
        >

        <label for="product-price">{{ t('admin.store.price') }}</label>
        <input
          id="product-price"
          v-model.number="draft.dragonCoinAmount"
          type="number"
          min="1"
          data-testid="admin-product-price"
        >

        <template v-if="draft.type === 'physical'">
          <label for="product-stock">{{ t('admin.store.stock') }}</label>
          <input
            id="product-stock"
            v-model.number="draft.stockOnHand"
            type="number"
            min="0"
            data-testid="admin-product-stock"
          >
        </template>

        <button
          type="submit"
          data-testid="admin-product-create"
          :disabled="creating || draft.titleEn === '' || draft.titleFa === '' || draft.sku === ''"
        >
          {{ t('admin.store.publish') }}
        </button>
      </form>

      <h2>{{ t('admin.store.catalog') }}</h2>
      <StateBlock
        v-if="products.length === 0"
        variant="empty"
        :message="t('store.catalog.empty')"
        :heading-level="3"
      />
      <ul
        v-else
        class="list"
        data-testid="admin-store-products"
      >
        <li
          v-for="product in products"
          :key="product.id"
        >
          <span dir="auto">{{ product.title }}</span>
          <span class="muted"> · {{ t(`store.type.${product.type}`) }}</span>
        </li>
      </ul>

      <form
        class="stack card"
        novalidate
        @submit.prevent="adjust"
      >
        <h2>{{ t('admin.store.inventory') }}</h2>
        <label for="inventory-variant">{{ t('admin.store.variantId') }}</label>
        <input
          id="inventory-variant"
          v-model="inventoryVariantId"
          type="text"
          data-testid="admin-inventory-variant"
        >

        <label for="inventory-delta">{{ t('admin.store.delta') }}</label>
        <input
          id="inventory-delta"
          v-model.number="inventoryDelta"
          type="number"
          data-testid="admin-inventory-delta"
        >

        <label for="inventory-reason">{{ t('admin.store.reason') }}</label>
        <input
          id="inventory-reason"
          v-model="inventoryReason"
          type="text"
          maxlength="500"
          data-testid="admin-inventory-reason"
        >

        <button
          type="submit"
          data-testid="admin-inventory-submit"
          :disabled="inventoryVariantId === '' || inventoryReason.trim() === ''"
        >
          {{ t('admin.store.adjust') }}
        </button>
      </form>

      <ul
        v-if="movements.length > 0"
        class="list"
        data-testid="admin-inventory-history"
      >
        <li
          v-for="movement in movements"
          :key="movement.id"
        >
          {{ formatNumber(movement.quantityDelta, activeLocale()) }} →
          {{ formatNumber(movement.resultingQuantity, activeLocale()) }}
          <span class="muted">{{ movement.reason }} · {{ when(movement.createdAt) }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.card {
  border: 1px solid var(--color-border, #444);
  border-radius: 0.5rem;
  padding: 1rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.notice {
  border-inline-start: 4px solid var(--color-accent, #888);
  padding-inline-start: 0.75rem;
}
</style>
