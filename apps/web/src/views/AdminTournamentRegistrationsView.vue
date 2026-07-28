<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AppSearch from '../components/AppSearch.vue';
import StateBlock from '../components/StateBlock.vue';
import { isLocale } from '../i18n/locale.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { decideRegistration, listRegistrations, type AdminRegistration } from '../composables/useRegistrationsApi.ts';
import { getAdminTournament, setParticipantsVisibility } from '../composables/useTournamentsApi.ts';

/** Registration queue for one tournament (TOURN-006/014). Gated on tournament.manage scoped to the tournament. */

const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();
const route = useRoute();

// Public-visibility toggle for the participant list. The optimistic write needs the
// tournament's current version, read from the admin tournament record.
const participantsPublic = ref(false);
const visibilityVersion = ref(0);
const visibilityBusy = ref(false);
const visibilityKnown = ref(false);

const prefix = computed(() => `/${isLocale(locale.value) ? locale.value : 'fa'}`);
const tournamentId = computed(() => String(route.params['id']));

const loading = ref(true);
const listError = ref<string | undefined>(undefined);
const rows = ref<AdminRegistration[]>([]);
const seats = ref<{ mainCount: number; waitlistCount: number }>({ mainCount: 0, waitlistCount: 0 });
const stateFilter = ref('');
const search = ref('');
const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return rows.value;
  return rows.value.filter((r) =>
    `${r.participantName ?? ''} ${r.username ?? ''} ${r.accountId} ${r.teamId ?? ''} ${t(`registration.state.${r.state}`)}`
      .toLowerCase()
      .includes(q)
  );
});

/**
 * Lifecycle state of the tournament, so an empty queue can say *why* it is empty.
 * A draft accepts no entries at all, which otherwise looks identical to a published
 * tournament nobody has entered yet.
 */
const tournamentState = ref<string | null>(null);

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

async function loadVisibility(): Promise<void> {
  try {
    const record = await getAdminTournament(tournamentId.value);
    participantsPublic.value = record.participantsPublic;
    visibilityVersion.value = record.version;
    visibilityKnown.value = true;
    tournamentState.value = record.state;
  } catch {
    visibilityKnown.value = false; // toggle stays hidden if the record can't be read
  }
}

async function toggleVisibility(): Promise<void> {
  if (visibilityBusy.value) return;
  visibilityBusy.value = true;
  try {
    const next = !participantsPublic.value;
    const updated = await setParticipantsVisibility(tournamentId.value, next, visibilityVersion.value);
    participantsPublic.value = updated.participantsPublic;
    visibilityVersion.value = updated.version;
    push('success', t(next ? 'adminRegistrations.visibility.nowPublic' : 'adminRegistrations.visibility.nowPrivate'));
  } catch (caught) {
    push('danger', messageFor(caught));
    await loadVisibility(); // resync the version after a stale-write conflict
  } finally {
    visibilityBusy.value = false;
  }
}

onMounted(async () => {
  await refreshCaps();
  await Promise.all([load(), loadVisibility()]);
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
      <div class="summary-row">
        <div
          class="stat-card seats"
          data-testid="seat-summary"
        >
          <span class="stat-value">{{ seats.mainCount }} / {{ seats.waitlistCount }}</span>
          <span class="stat-label">{{ t('adminRegistrations.seats', { main: seats.mainCount, waitlist: seats.waitlistCount }) }}</span>
        </div>

        <div
          v-if="visibilityKnown"
          class="stat-card visibility"
          data-testid="visibility-card"
        >
          <span class="stat-label">{{ t('adminRegistrations.visibility.label') }}</span>
          <label class="switch">
            <input
              type="checkbox"
              data-testid="visibility-toggle"
              :checked="participantsPublic"
              :disabled="visibilityBusy"
              @change="toggleVisibility"
            >
            <span>{{ participantsPublic ? t('adminRegistrations.visibility.public') : t('adminRegistrations.visibility.private') }}</span>
          </label>
          <span class="visibility-hint">{{ t('adminRegistrations.visibility.hint') }}</span>
        </div>
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

      <AppSearch
        v-model="search"
        input-id="admin-registrations-search"
      />

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
        v-else-if="filteredRows.length === 0"
        variant="empty"
        :message="
          search.trim() !== ''
            ? t('search.noResults')
            : tournamentState !== null && tournamentState !== 'published'
              ? t('adminRegistrations.notPublished')
              : t('adminRegistrations.empty')
        "
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
              v-for="reg in filteredRows"
              :key="reg.id"
              :data-testid="`registration-${reg.id}`"
            >
              <td>
                <span
                  v-if="reg.participantName"
                  class="participant-name"
                >{{ reg.participantName }}</span>
                <span
                  v-else
                  class="participant-unknown"
                >{{ t('adminRegistrations.unknownParticipant') }}</span>
                <bdi
                  v-if="reg.participantType === 'individual' && reg.username"
                  class="latin-value participant-handle"
                >@{{ reg.username }}</bdi>
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

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-block-end: var(--space-4);
}
.seats {
  inline-size: fit-content;
}
.visibility {
  gap: var(--space-2);
}
.switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: var(--weight-semibold);
  cursor: pointer;
}
.switch input {
  inline-size: 1.15rem;
  block-size: 1.15rem;
  accent-color: var(--color-primary);
  cursor: pointer;
}
.visibility-hint {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.participant-name {
  font-weight: var(--weight-semibold);
}
.participant-unknown {
  color: var(--color-text-muted);
}
.participant-handle {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
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
