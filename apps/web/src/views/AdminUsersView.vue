<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSearch from '../components/AppSearch.vue';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { formatDateTime } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Administration user list (PAGE, ADMIN-006). Masked data, cursor pagination,
 * suspend/reactivate with a required reason. The server enforces the permission.
 */
interface AccountSummary {
  accountId: string;
  state: string;
  locale: string;
  createdAt: string;
  username: string | null;
  mobileMasked: string;
}
interface AccountPage {
  items: AccountSummary[];
  nextCursor: string | null;
}

const { t, locale } = useI18n();
const { forbidden, has, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const loading = ref(true);
const error = ref<string | undefined>(undefined);
const accounts = ref<AccountSummary[]>([]);
const nextCursor = ref<string | null>(null);

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const canSuspend = computed(() => has('users.suspend'));

// Presentation-only mapping to a status-pill tone; the text label always carries the state.
function accountTone(state: string): string {
  if (state === 'suspended') return 'danger';
  if (state === 'active') return 'success';
  return 'neutral';
}

const search = ref('');
const rows = computed(() =>
  accounts.value.map((account) => ({
    accountId: account.accountId,
    username: account.username ?? '—',
    mobileMasked: account.mobileMasked,
    stateLabel: t(`admin.users.stateValue.${account.state}`),
    state: account.state,
    created: formatDateTime(account.createdAt, activeLocale.value, 'Asia/Tehran')
  }))
);
// Client-side filter over the loaded rows (username / mobile / state).
const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return rows.value;
  return rows.value.filter((r) => `${r.username} ${r.mobileMasked} ${r.stateLabel}`.toLowerCase().includes(q));
});

async function load(cursor?: string): Promise<void> {
  loading.value = true;
  try {
    const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
    const page = await apiFetch<AccountPage>(`/admin/users${query}`);
    accounts.value = cursor === undefined ? page.items : [...accounts.value, ...page.items];
    nextCursor.value = page.nextCursor;
    error.value = undefined;
  } catch (caught) {
    error.value = messageFor(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await refreshCaps();
  await load();
});

async function setState(accountId: string, action: 'suspend' | 'reactivate'): Promise<void> {
  const reason = globalThis.prompt(t('admin.users.reasonPrompt')) ?? '';
  if (reason.trim() === '') return;
  try {
    await apiFetch<void>(`/admin/users/${accountId}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    push('success', t('admin.users.updated'));
    await load();
  } catch (caught) {
    push('danger', messageFor(caught));
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('admin.users.heading') }}</h1>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="users-forbidden"
    />
    <StateBlock
      v-else-if="loading && accounts.length === 0"
      variant="loading"
    />
    <StateBlock
      v-else-if="error"
      variant="error"
      :message="error"
    />

    <template v-else>
      <AppSearch
        v-model="search"
        input-id="admin-users-search"
      />
      <div
        class="scroll"
        role="region"
        :aria-label="t('admin.users.caption')"
        tabindex="0"
      >
        <table>
          <caption>{{ t('admin.users.caption') }}</caption>
          <thead>
            <tr>
              <th scope="col">
                {{ t('admin.users.username') }}
              </th>
              <th scope="col">
                {{ t('admin.users.mobile') }}
              </th>
              <th scope="col">
                {{ t('admin.users.state') }}
              </th>
              <th scope="col">
                {{ t('admin.users.created') }}
              </th>
              <th
                v-if="canSuspend"
                scope="col"
              >
                {{ t('admin.users.actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredRows"
              :key="row.accountId"
              :data-state="row.state"
            >
              <td>{{ row.username }}</td>
              <td><bdi class="latin-value">{{ row.mobileMasked }}</bdi></td>
              <td>
                <span
                  class="status-pill"
                  :class="`status-pill-${accountTone(row.state)}`"
                >{{ row.stateLabel }}</span>
              </td>
              <td class="numeric">
                {{ row.created }}
              </td>
              <td v-if="canSuspend">
                <button
                  v-if="row.state === 'active'"
                  type="button"
                  class="btn btn-danger"
                  :data-testid="`suspend-${row.accountId}`"
                  @click="setState(row.accountId, 'suspend')"
                >
                  {{ t('admin.users.suspend') }}
                </button>
                <button
                  v-else-if="row.state === 'suspended'"
                  type="button"
                  class="btn btn-secondary"
                  :data-testid="`reactivate-${row.accountId}`"
                  @click="setState(row.accountId, 'reactivate')"
                >
                  {{ t('admin.users.reactivate') }}
                </button>
                <span v-else>—</span>
              </td>
            </tr>
            <tr v-if="filteredRows.length === 0">
              <td
                :colspan="canSuspend ? 5 : 4"
                class="empty"
              >
                {{ search.trim() === '' ? t('admin.users.empty') : t('search.noResults') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <button
        v-if="nextCursor"
        type="button"
        class="btn btn-neutral more"
        data-testid="load-more"
        @click="load(nextCursor ?? undefined)"
      >
        {{ t('admin.users.loadMore') }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.scroll {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

table {
  inline-size: 100%;
  border-collapse: collapse;
}

caption {
  padding: var(--space-3) var(--space-4);
  text-align: start;
  font-weight: var(--weight-semibold);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

th,
td {
  padding: var(--space-2) var(--space-3);
  text-align: start;
  border-block-start: 1px solid var(--color-border);
  font-size: var(--text-sm);
}

th {
  position: sticky;
  inset-block-start: 0;
  background-color: var(--color-surface-sunken);
  color: var(--color-text-muted);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}

/* Letter-spacing breaks Persian connected script — reset it there (17.5). */
[lang='fa'] th {
  letter-spacing: normal;
  text-transform: none;
}

tbody tr {
  transition: background-color var(--motion-fast) var(--motion-ease);
}
tbody tr:hover {
  background-color: var(--color-surface-raised);
}

.empty {
  color: var(--color-text-muted);
  text-align: center;
}

.more {
  margin-block-start: var(--space-4);
}
</style>
