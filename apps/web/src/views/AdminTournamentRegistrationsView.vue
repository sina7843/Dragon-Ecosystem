<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { isLocale } from '../i18n/locale.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { decideRegistration, listRegistrations, type AdminRegistration } from '../composables/useRegistrationsApi.ts';

/** Registration queue for one tournament (TOURN-006/014). Gated on tournament.manage scoped to the tournament. */

const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();
const route = useRoute();

const prefix = computed(() => `/${isLocale(locale.value) ? locale.value : 'fa'}`);
const tournamentId = computed(() => String(route.params['id']));

const loading = ref(true);
const listError = ref<string | undefined>(undefined);
const rows = ref<AdminRegistration[]>([]);
const seats = ref<{ mainCount: number; waitlistCount: number }>({ mainCount: 0, waitlistCount: 0 });
const stateFilter = ref('');

async function load(): Promise<void> {
  loading.value = true;
  try {
    const queue = await listRegistrations(tournamentId.value, stateFilter.value === '' ? {} : { state: stateFilter.value });
    rows.value = queue.items;
    seats.value = queue.seats;
    listError.value = undefined;
  } catch (caught) {
    listError.value = messageFor(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await refreshCaps();
  await load();
});

// Registration state pill tone — text label always carries the meaning (section 23.2).
const STATE_TONE: Record<string, string> = {
  pending: 'warning',
  approved: 'success',
  waitlisted: 'info',
  rejected: 'danger',
  cancelled: 'neutral'
};
function tone(state: string): string {
  return STATE_TONE[state] ?? 'neutral';
}

async function decide(reg: AdminRegistration, verb: 'approve' | 'reject' | 'waitlist' | 'promote' | 'cancel'): Promise<void> {
  let reason: string | undefined;
  if (verb === 'reject' || verb === 'cancel') {
    const entered = globalThis.prompt(t('adminRegistrations.reasonPrompt'));
    if (entered === null || entered.trim() === '') return;
    reason = entered;
  }
  try {
    await decideRegistration(tournamentId.value, reg.id, verb, reason);
    push('success', t('adminRegistrations.updated'));
    await load();
  } catch (caught) {
    push('danger', messageFor(caught));
  }
}
</script>

<template>
  <section>
    <p>
      <RouterLink
        class="btn btn-ghost back-link"
        :to="`${prefix}/admin/tournaments`"
      >
        {{ t('adminRegistrations.back') }}
      </RouterLink>
    </p>
    <div class="page-header">
      <div>
        <h1>{{ t('adminRegistrations.heading') }}</h1>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="registrations-forbidden"
    />

    <template v-else>
      <div
        class="stat-card seats"
        data-testid="seat-summary"
      >
        <span class="stat-value">{{ seats.mainCount }} / {{ seats.waitlistCount }}</span>
        <span class="stat-label">{{ t('adminRegistrations.seats', { main: seats.mainCount, waitlist: seats.waitlistCount }) }}</span>
      </div>

      <div class="toolbar">
        <label
          class="filter-label"
          for="registrations-state-filter"
        >{{ t('adminRegistrations.filter') }}</label>
        <select
          id="registrations-state-filter"
          v-model="stateFilter"
          data-testid="state-filter"
          @change="load"
        >
          <option value="">
            {{ t('adminRegistrations.allStates') }}
          </option>
          <option
            v-for="s in ['pending', 'approved', 'waitlisted', 'rejected', 'cancelled']"
            :key="s"
            :value="s"
          >
            {{ t(`registration.state.${s}`) }}
          </option>
        </select>
      </div>

      <StateBlock
        v-if="loading"
        variant="loading"
      />
      <StateBlock
        v-else-if="listError"
        variant="error"
        :message="listError"
      />
      <StateBlock
        v-else-if="rows.length === 0"
        variant="empty"
        :message="t('adminRegistrations.empty')"
      />

      <div
        v-else
        class="scroll"
        role="region"
        tabindex="0"
        :aria-label="t('adminRegistrations.heading')"
      >
        <table
          class="dense"
          data-testid="registration-queue"
        >
          <caption class="sr-only">
            {{ t('adminRegistrations.heading') }}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                {{ t('adminRegistrations.participant') }}
              </th>
              <th scope="col">
                {{ t('adminRegistrations.state') }}
              </th>
              <th scope="col">
                {{ t('adminRegistrations.actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="reg in rows"
              :key="reg.id"
              :data-testid="`registration-${reg.id}`"
            >
              <td>
                <bdi class="latin-value">{{ reg.participantType === 'team' ? reg.teamId : reg.accountId }}</bdi>
              </td>
              <td :data-state="reg.state">
                <span
                  class="status-pill"
                  :class="`status-pill-${tone(reg.state)}`"
                >
                  {{ t(`registration.state.${reg.state}`) }}
                  <span v-if="reg.waitlistSeq !== null">(#{{ reg.waitlistSeq }})</span>
                </span>
              </td>
              <td class="actions">
                <button
                  v-if="reg.state === 'pending'"
                  type="button"
                  class="btn btn-primary"
                  data-testid="approve"
                  @click="decide(reg, 'approve')"
                >
                  {{ t('adminRegistrations.approve') }}
                </button>
                <button
                  v-if="reg.state === 'pending'"
                  type="button"
                  class="btn btn-neutral"
                  data-testid="waitlist"
                  @click="decide(reg, 'waitlist')"
                >
                  {{ t('adminRegistrations.waitlist') }}
                </button>
                <button
                  v-if="reg.state === 'waitlisted'"
                  type="button"
                  class="btn btn-secondary"
                  data-testid="promote"
                  @click="decide(reg, 'promote')"
                >
                  {{ t('adminRegistrations.promote') }}
                </button>
                <button
                  v-if="reg.state === 'pending' || reg.state === 'waitlisted'"
                  type="button"
                  class="btn btn-danger"
                  data-testid="reject"
                  @click="decide(reg, 'reject')"
                >
                  {{ t('adminRegistrations.reject') }}
                </button>
                <button
                  v-if="reg.state === 'approved'"
                  type="button"
                  class="btn btn-danger"
                  data-testid="cancel"
                  @click="decide(reg, 'cancel')"
                >
                  {{ t('adminRegistrations.cancel') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.back-link {
  padding-inline: 0;
}

.seats {
  inline-size: fit-content;
  margin-block-end: var(--space-4);
}

.filter-label {
  font-weight: var(--weight-semibold);
  font-size: var(--text-sm);
}

select {
  padding: var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

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

th,
td {
  padding: var(--space-3) var(--space-4);
  border-block-start: 1px solid var(--color-border);
  text-align: start;
}

th {
  position: sticky;
  inset-block-start: 0;
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

table.dense th,
table.dense td {
  padding-block: var(--space-2);
  font-size: var(--text-sm);
}

tbody tr:hover {
  background-color: var(--color-surface-raised);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
