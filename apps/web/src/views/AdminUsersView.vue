<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
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
    <h1>{{ t('admin.users.heading') }}</h1>

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
              v-for="row in rows"
              :key="row.accountId"
            >
              <td>{{ row.username }}</td>
              <td><bdi class="latin-value">{{ row.mobileMasked }}</bdi></td>
              <td>{{ row.stateLabel }}</td>
              <td>{{ row.created }}</td>
              <td v-if="canSuspend">
                <button
                  v-if="row.state === 'active'"
                  type="button"
                  :data-testid="`suspend-${row.accountId}`"
                  @click="setState(row.accountId, 'suspend')"
                >
                  {{ t('admin.users.suspend') }}
                </button>
                <button
                  v-else-if="row.state === 'suspended'"
                  type="button"
                  :data-testid="`reactivate-${row.accountId}`"
                  @click="setState(row.accountId, 'reactivate')"
                >
                  {{ t('admin.users.reactivate') }}
                </button>
                <span v-else>—</span>
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td
                :colspan="canSuspend ? 5 : 4"
                class="empty"
              >
                {{ t('admin.users.empty') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <button
        v-if="nextCursor"
        type="button"
        class="more"
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
  border-radius: var(--radius-md);
}

table {
  inline-size: 100%;
  border-collapse: collapse;
}

caption {
  padding: var(--space-3);
  text-align: start;
  font-weight: 600;
}

th,
td {
  padding: var(--space-2) var(--space-3);
  text-align: start;
  border-block-start: 1px solid var(--color-border);
  font-size: var(--text-sm);
}

th {
  background-color: var(--color-surface-raised);
}

.empty {
  color: var(--color-text-muted);
  text-align: center;
}

button {
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}

.more {
  margin-block-start: var(--space-4);
}
</style>
