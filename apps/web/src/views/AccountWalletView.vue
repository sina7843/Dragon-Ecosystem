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
  listPackages,
  listPurchases,
  mockPay,
  newPurchaseKey,
  type PackageView,
  type PurchaseView
} from '../composables/usePaymentsApi.ts';
import { getWalletSummary, listHolds, type HoldView, type WalletSummary } from '../composables/useHoldsApi.ts';
import { listEntitlements, type EntitlementView } from '../composables/useCheckoutApi.ts';

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
const summary = ref<WalletSummary>({ ledgerBalance: 0, heldAmount: 0, availableBalance: 0 });
const holds = ref<HoldView[]>([]);
const entitlements = ref<EntitlementView[]>([]);
const history = ref<PurchaseView[]>([]);
const active = ref<PurchaseView | null>(null);
const busy = ref(false);

const pendingActive = computed(() => active.value !== null && active.value.state === 'payment_pending');

// Maps a domain state string to a status-pill tone. Colour reinforces the always-present
// text label; it is never the sole signal (section 23.2).
function toneFor(state: string): string {
  if (/succeed|active|credited|paid|released|granted/i.test(state)) return 'success';
  if (/pending|processing|await|hold|reserved/i.test(state)) return 'warning';
  if (/fail|cancel|expire|refund|correct|void|declin/i.test(state)) return 'danger';
  return 'neutral';
}

async function refresh(): Promise<void> {
  summary.value = await getWalletSummary();
  holds.value = (await listHolds()).items;
  entitlements.value = (await listEntitlements()).items;
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
      <dl
        class="balances"
        data-testid="wallet-balances"
      >
        <div class="balance">
          <dt>{{ t('wallet.total') }}</dt>
          <dd data-testid="balance-total">
            <span class="amount numeric">{{ formatNumber(summary.ledgerBalance, activeLocale()) }}</span>
            <span class="unit">{{ t('wallet.coinUnit') }}</span>
          </dd>
        </div>
        <div class="balance">
          <dt>{{ t('wallet.held') }}</dt>
          <dd data-testid="balance-held">
            <span class="amount numeric">{{ formatNumber(summary.heldAmount, activeLocale()) }}</span>
            <span class="unit">{{ t('wallet.coinUnit') }}</span>
          </dd>
        </div>
        <div class="balance balance-available">
          <dt>{{ t('wallet.available') }}</dt>
          <dd data-testid="balance-available">
            <span class="amount numeric">{{ formatNumber(summary.availableBalance, activeLocale()) }}</span>
            <span class="unit">{{ t('wallet.coinUnit') }}</span>
          </dd>
        </div>
      </dl>

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
          class="status-pill"
          :class="`status-pill-${toneFor(active.state)}`"
          data-testid="active-state"
          :data-state="active.state"
        >
          {{ t(`wallet.state.${active.state}`) }}
        </p>
        <template v-if="pendingActive">
          <p class="mock-note">
            <span class="badge badge-warning">{{ t('wallet.mockLabel') }}</span>
            {{ t('wallet.simulateHint') }}
          </p>
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

      <h2>{{ t('wallet.holds') }}</h2>
      <StateBlock
        v-if="holds.length === 0"
        variant="empty"
        data-testid="no-holds"
        :message="t('wallet.noHolds')"
      />
      <div
        v-else
        class="scroll"
      >
        <table data-testid="hold-list">
          <caption class="sr-only">
            {{ t('wallet.holds') }}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                {{ t('wallet.holdPurpose') }}
              </th>
              <th scope="col">
                {{ t('wallet.held') }}
              </th>
              <th scope="col">
                {{ t('wallet.status') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="hold in holds"
              :key="hold.id"
              :data-testid="`hold-${hold.id}`"
              :data-state="hold.state"
            >
              <td>{{ t(`wallet.holdPurposeLabel.${hold.purpose}`) }}</td>
              <td class="numeric">
                {{ formatNumber(hold.remainingAmount, activeLocale()) }}
              </td>
              <td>
                <span
                  class="status-pill"
                  :class="`status-pill-${toneFor(hold.state)}`"
                >{{ t(`wallet.holdState.${hold.state}`) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>{{ t('wallet.prizes') }}</h2>
      <StateBlock
        v-if="entitlements.length === 0"
        variant="empty"
        data-testid="no-entitlements"
        :message="t('wallet.noPrizes')"
      />
      <div
        v-else
        class="scroll"
      >
        <table data-testid="entitlement-list">
          <caption class="sr-only">
            {{ t('wallet.prizes') }}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                {{ t('wallet.prizeRank') }}
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
              v-for="entitlement in entitlements"
              :key="entitlement.id"
              :data-testid="`entitlement-${entitlement.id}`"
              :data-state="entitlement.state"
            >
              <td class="numeric">
                {{ formatNumber(entitlement.rank, activeLocale()) }}
              </td>
              <td class="numeric">
                {{ formatNumber(entitlement.tomanAmount, activeLocale()) }} {{ t('wallet.tomanUnit') }}
              </td>
              <td>
                <span
                  class="status-pill"
                  :class="`status-pill-${toneFor(entitlement.state)}`"
                >{{ t(`wallet.entitlementState.${entitlement.state}`) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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
              <td><span class="latin-value">{{ purchase.packageCode }}</span></td>
              <td class="numeric">
                {{ formatNumber(purchase.dragonCoin, activeLocale()) }}
              </td>
              <td class="numeric">
                {{ formatNumber(purchase.tomanAmount, activeLocale()) }} {{ t('wallet.tomanUnit') }}
              </td>
              <td>
                <span
                  class="status-pill"
                  :class="`status-pill-${toneFor(purchase.state)}`"
                >{{ t(`wallet.state.${purchase.state}`) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* Total / held / available as distinct stat cards so they cannot be confused (23.2). */
.balances {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
  gap: var(--space-4);
  margin-block: var(--space-3) var(--space-6);
}

.balance {
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--gradient-surface);
}

/* Available is the number the user acts on — restrained accent emphasis. */
.balance-available {
  border-color: var(--color-primary);
  box-shadow: var(--glow-primary);
}

.balances dt {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.balances dd {
  margin: var(--space-1) 0 0;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.amount {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--weight-bold);
  line-height: 1.1;
}
.balance-available .amount {
  color: var(--color-accent);
}
.unit {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
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
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.pkg-info {
  display: flex;
  flex-direction: column;
}

.coins {
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
}

.price {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.active-purchase {
  margin-block: var(--space-5);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface-raised);
}

.mock-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.scroll {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-sm);
  margin-block-end: var(--space-5);
}

table {
  inline-size: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: var(--space-3) var(--space-4);
  border-block-start: 1px solid var(--color-border);
  text-align: start;
}

th {
  background-color: var(--color-surface-sunken);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}
[lang='fa'] th {
  letter-spacing: normal;
  text-transform: none;
}

tbody tr:hover {
  background-color: var(--color-surface-raised);
}

.primary,
.secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-inline: var(--space-5);
  padding-block: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-weight: var(--weight-semibold);
  cursor: pointer;
  transition:
    background-color var(--motion-fast) var(--motion-ease),
    transform var(--motion-fast) var(--motion-ease);
}
.primary:active,
.secondary:active {
  transform: translateY(1px);
}
.primary {
  background-color: var(--color-primary);
  color: var(--color-primary-text);
  box-shadow: var(--glow-primary);
}
.primary:hover:not(:disabled) {
  background-color: var(--color-primary-strong);
}
.primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}
.secondary {
  background-color: var(--color-surface);
  color: var(--color-text);
  border-color: var(--color-border-strong);
}
.secondary:hover {
  background-color: var(--color-surface-raised);
}

.sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
