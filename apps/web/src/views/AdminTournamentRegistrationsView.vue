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
      <RouterLink :to="`${prefix}/admin/tournaments`">
        {{ t('adminRegistrations.back') }}
      </RouterLink>
    </p>
    <h1>{{ t('adminRegistrations.heading') }}</h1>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="registrations-forbidden"
    />

    <template v-else>
      <p
        class="seats"
        data-testid="seat-summary"
      >
        {{ t('adminRegistrations.seats', { main: seats.mainCount, waitlist: seats.waitlistCount }) }}
      </p>

      <label class="filter">
        {{ t('adminRegistrations.filter') }}
        <select
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
      </label>

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

      <table
        v-else
        data-testid="registration-queue"
      >
        <caption class="sr-only">
          {{ t('adminRegistrations.heading') }}
        </caption>
        <thead>
          <tr>
            <th>{{ t('adminRegistrations.participant') }}</th>
            <th>{{ t('adminRegistrations.state') }}</th>
            <th>{{ t('adminRegistrations.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="reg in rows"
            :key="reg.id"
            :data-testid="`registration-${reg.id}`"
          >
            <td>{{ reg.participantType === 'team' ? reg.teamId : reg.accountId }}</td>
            <td :data-state="reg.state">
              {{ t(`registration.state.${reg.state}`) }}
              <span v-if="reg.waitlistSeq !== null">(#{{ reg.waitlistSeq }})</span>
            </td>
            <td class="actions">
              <button
                v-if="reg.state === 'pending'"
                type="button"
                data-testid="approve"
                @click="decide(reg, 'approve')"
              >
                {{ t('adminRegistrations.approve') }}
              </button>
              <button
                v-if="reg.state === 'pending'"
                type="button"
                data-testid="waitlist"
                @click="decide(reg, 'waitlist')"
              >
                {{ t('adminRegistrations.waitlist') }}
              </button>
              <button
                v-if="reg.state === 'waitlisted'"
                type="button"
                data-testid="promote"
                @click="decide(reg, 'promote')"
              >
                {{ t('adminRegistrations.promote') }}
              </button>
              <button
                v-if="reg.state === 'pending' || reg.state === 'waitlisted'"
                type="button"
                data-testid="reject"
                @click="decide(reg, 'reject')"
              >
                {{ t('adminRegistrations.reject') }}
              </button>
              <button
                v-if="reg.state === 'approved'"
                type="button"
                data-testid="cancel"
                @click="decide(reg, 'cancel')"
              >
                {{ t('adminRegistrations.cancel') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.seats {
  font-weight: 600;
}

.filter {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  margin-block: var(--space-3);
}

.filter select {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
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

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.actions button {
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
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
