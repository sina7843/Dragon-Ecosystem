<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatNumber } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import {
  createPurchase,
  getDragonCoinBalance,
  listPackages,
  listPurchases,
  mockPay,
  newPurchaseKey,
  type PackageView,
  type PurchaseView
} from '../composables/usePaymentsApi.ts';

/**
 * Dragon Coin wallet (DRAGON-11b). Shows packages, the current balance, and
 * purchase history. A purchase is only shown as successful once the server reports
 * the verified, credited state — never on initiation. No raw provider or ledger
 * detail is displayed. Bilingual (fa RTL / en LTR).
 */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const loading = ref(true);
const loadError = ref<string | undefined>(undefined);
const packages = ref<PackageView[]>([]);
const balance = ref(0);
const history = ref<PurchaseView[]>([]);
const active = ref<PurchaseView | null>(null);
const busy = ref(false);

const pendingActive = computed(() => active.value !== null && active.value.state === 'payment_pending');

async function refresh(): Promise<void> {
  balance.value = (await getDragonCoinBalance()).balance;
  history.value = (await listPurchases()).items;
}

onMounted(async () => {
  try {
    packages.value = (await listPackages()).packages;
    await refresh();
    loadError.value = undefined;
  } catch (caught) {
    loadError.value = messageFor(caught);
  } finally {
    loading.value = false;
  }
});

async function buy(pkg: PackageView): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    active.value = await createPurchase(pkg.code, newPurchaseKey());
    await refresh();
    push('info', t('wallet.pendingNotice'));
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = false;
  }
}

async function simulate(outcome: 'success' | 'failed' | 'cancelled'): Promise<void> {
  if (active.value === null || busy.value) return;
  busy.value = true;
  try {
    active.value = await mockPay(active.value.id, outcome);
    if (active.value.state === 'succeeded') push('success', t('wallet.succeeded'));
    else push('info', t(`wallet.state.${active.value.state}`));
    await refresh();
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section>
    <h1>{{ t('wallet.heading') }}</h1>

    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="loadError"
      variant="error"
      :message="loadError"
    />

    <template v-else>
      <p
        class="balance"
        data-testid="dragon-coin-balance"
      >
        {{ t('wallet.balance') }}: <strong>{{ formatNumber(balance, activeLocale()) }}</strong> {{ t('wallet.coinUnit') }}
      </p>

      <h2>{{ t('wallet.packages') }}</h2>
      <ul
        class="packages"
        data-testid="packages"
      >
        <li
          v-for="pkg in packages"
          :key="pkg.code"
          :data-testid="`package-${pkg.code}`"
        >
          <div class="pkg-info">
            <span class="coins">{{ formatNumber(pkg.dragonCoin, activeLocale()) }} {{ t('wallet.coinUnit') }}</span>
            <span class="price">{{ formatNumber(pkg.tomanAmount, activeLocale()) }} {{ t('wallet.tomanUnit') }}</span>
          </div>
          <button
            type="button"
            class="primary"
            :data-testid="`buy-${pkg.code}`"
            :disabled="busy"
            @click="buy(pkg)"
          >
            {{ t('wallet.buy') }}
          </button>
        </li>
      </ul>

      <section
        v-if="active"
        class="active-purchase"
        data-testid="active-purchase"
        :data-state="active.state"
      >
        <h2>{{ t('wallet.currentPurchase') }}</h2>
        <p
          class="status"
          data-testid="active-state"
          :data-state="active.state"
        >
          {{ t(`wallet.state.${active.state}`) }}
        </p>
        <template v-if="pendingActive">
          <p>{{ t('wallet.simulateHint') }}</p>
          <div class="row">
            <button
              type="button"
              class="primary"
              data-testid="simulate-success"
              :disabled="busy"
              @click="simulate('success')"
            >
              {{ t('wallet.simulateSuccess') }}
            </button>
            <button
              type="button"
              class="secondary"
              data-testid="simulate-failure"
              :disabled="busy"
              @click="simulate('failed')"
            >
              {{ t('wallet.simulateFailure') }}
            </button>
          </div>
        </template>
      </section>

      <h2>{{ t('wallet.history') }}</h2>
      <StateBlock
        v-if="history.length === 0"
        variant="empty"
        :message="t('wallet.noHistory')"
      />
      <div
        v-else
        class="scroll"
      >
        <table data-testid="purchase-history">
          <caption class="sr-only">
            {{ t('wallet.history') }}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                {{ t('wallet.package') }}
              </th>
              <th scope="col">
                {{ t('wallet.coins') }}
              </th>
              <th scope="col">
                {{ t('wallet.price') }}
              </th>
              <th scope="col">
                {{ t('wallet.status') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="purchase in history"
              :key="purchase.id"
              :data-testid="`purchase-${purchase.id}`"
              :data-state="purchase.state"
            >
              <td>{{ purchase.packageCode }}</td>
              <td>{{ formatNumber(purchase.dragonCoin, activeLocale()) }}</td>
              <td>{{ formatNumber(purchase.tomanAmount, activeLocale()) }} {{ t('wallet.tomanUnit') }}</td>
              <td>{{ t(`wallet.state.${purchase.state}`) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.balance {
  font-size: var(--text-lg);
}

.packages {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
}

.packages li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.pkg-info {
  display: flex;
  flex-direction: column;
}

.coins {
  font-weight: 700;
}

.price {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.active-purchase {
  margin-block: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.status {
  font-weight: 700;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.scroll {
  overflow-x: auto;
}

table {
  inline-size: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: var(--space-2) var(--space-3);
  border-block-end: 1px solid var(--color-border);
  text-align: start;
}

.primary {
  padding-inline: var(--space-4);
  padding-block: var(--space-2);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary {
  padding-inline: var(--space-4);
  padding-block: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
