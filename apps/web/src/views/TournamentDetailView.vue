<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, formatNumber, formatTomanValue, viewerTimeZone } from '../i18n/format.ts';
import { getTournament, type MoneyView, type TournamentDetail } from '../composables/useTournamentsApi.ts';
import { myRegistration, newIdempotencyKey, registerForTournament, withdraw, type RegistrationStatus } from '../composables/useRegistrationsApi.ts';
import { getBracket, getStandings, type BracketView, type StandingsView } from '../composables/useCompetitionsApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useAuth } from '../composables/useAuth.ts';
import { useToasts } from '../composables/useToasts.ts';

/** Public tournament detail. A draft, cancelled, or archived tournament is a real 404. */

const { t, locale } = useI18n();
const { messageFor, fieldMessage } = useApiErrors();
const { authenticated, loaded, refresh } = useAuth();
const { push } = useToasts();
const route = useRoute();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const loading = ref(true);
const notFound = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const tour = ref<TournamentDetail | null>(null);

const registration = ref<RegistrationStatus | null>(null);
const answers = ref<Record<string, string>>({});
const registering = ref(false);
const registerError = ref<string | undefined>(undefined);

const standings = ref<StandingsView | null>(null);
const bracket = ref<BracketView | null>(null);

function moneyLabel(m: MoneyView): string {
  return m.assetCode === 'IRR'
    ? `${formatTomanValue(m.amountInteger, activeLocale())} ${t('money.tomanUnit')}`
    : `${formatNumber(m.amountInteger, activeLocale())} ${t('money.dragonCoinUnit')}`;
}

async function loadStatus(id: string): Promise<void> {
  try {
    registration.value = await myRegistration(id);
  } catch {
    registration.value = null; // 404 = not registered yet.
  }
}

onMounted(async () => {
  try {
    tour.value = await getTournament(String(route.params['slug']), activeLocale());
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound.value = true;
    else errorMessage.value = messageFor(error);
    return;
  } finally {
    loading.value = false;
  }
  if (!loaded.value) await refresh();
  if (authenticated.value && tour.value !== null) await loadStatus(tour.value.id);
  if (tour.value !== null) {
    try {
      standings.value = await getStandings(tour.value.id);
      bracket.value = await getBracket(tour.value.id);
    } catch {
      standings.value = null; // 404 = competition not generated yet.
    }
  }
});

async function onRegister(): Promise<void> {
  if (tour.value === null || registering.value) return;
  registering.value = true;
  registerError.value = undefined;
  try {
    const payload = tour.value.questions.map((q) => ({ key: q.key, value: answers.value[q.key] ?? '' }));
    registration.value = await registerForTournament(tour.value.id, { idempotencyKey: newIdempotencyKey(), answers: payload });
    push('success', t('registration.registered'));
  } catch (error) {
    registerError.value = fieldMessage(error, 'participantType') ?? fieldMessage(error, 'age') ?? fieldMessage(error, 'fee') ?? messageFor(error);
  } finally {
    registering.value = false;
  }
}

async function onWithdraw(): Promise<void> {
  if (tour.value === null) return;
  try {
    registration.value = await withdraw(tour.value.id);
    push('info', t('registration.withdrawn'));
  } catch (error) {
    push('danger', messageFor(error));
  }
}
</script>

<template>
  <section>
    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="notFound"
      variant="notFound"
      data-testid="tournament-not-found"
      :message="t('tournaments.detail.notFound')"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />

    <template v-else-if="tour">
      <h1 data-testid="tournament-title">
        {{ tour.name }}
      </h1>
      <p class="summary">
        {{ tour.summary }}
      </p>
      <p
        v-if="tour.description"
        data-testid="tournament-description"
      >
        {{ tour.description }}
      </p>

      <dl class="facts">
        <div>
          <dt>{{ t('tournaments.field.participantType') }}</dt>
          <dd>{{ t(`tournaments.participant.${tour.participantType}`) }}</dd>
        </div>
        <div>
          <dt>{{ t('tournaments.field.format') }}</dt>
          <dd>{{ t(`tournaments.format.${tour.format}`) }}</dd>
        </div>
        <div>
          <dt>{{ t('tournaments.field.capacity') }}</dt>
          <dd>{{ formatNumber(tour.capacity, activeLocale()) }}</dd>
        </div>
        <div v-if="tour.registration.opensAt">
          <dt>{{ t('tournaments.field.registrationOpens') }}</dt>
          <dd>{{ formatDateTime(tour.registration.opensAt, activeLocale(), viewerTimeZone()) }}</dd>
        </div>
        <div v-if="tour.registration.closesAt">
          <dt>{{ t('tournaments.field.registrationCloses') }}</dt>
          <dd>{{ formatDateTime(tour.registration.closesAt, activeLocale(), viewerTimeZone()) }}</dd>
        </div>
        <div v-if="tour.startAt">
          <dt>{{ t('tournaments.field.startAt') }}</dt>
          <dd>{{ formatDateTime(tour.startAt, activeLocale(), viewerTimeZone()) }}</dd>
        </div>
        <div v-if="tour.endAt">
          <dt>{{ t('tournaments.field.endAt') }}</dt>
          <dd>{{ formatDateTime(tour.endAt, activeLocale(), viewerTimeZone()) }}</dd>
        </div>
      </dl>

      <section class="block">
        <h2>{{ t('tournaments.field.fee') }}</h2>
        <p
          v-if="tour.fee.kind === 'free'"
          data-testid="fee"
        >
          {{ t('tournaments.feeKind.free') }}
        </p>
        <ul
          v-else
          data-testid="fee"
        >
          <li
            v-for="(component, i) in tour.fee.components"
            :key="i"
          >
            {{ moneyLabel(component) }}
          </li>
        </ul>
      </section>

      <section
        v-if="tour.prizes.placements.length > 0"
        class="block"
      >
        <h2>{{ t('tournaments.field.prizes') }}</h2>
        <ul data-testid="prizes">
          <li
            v-for="placement in tour.prizes.placements"
            :key="placement.rank"
          >
            {{ t('tournaments.detail.rank', { rank: formatNumber(placement.rank, activeLocale()) }) }}:
            {{ placement.rewards.map(moneyLabel).join(' + ') }}
          </li>
        </ul>
      </section>

      <section
        v-if="tour.rules"
        class="block"
      >
        <h2>{{ t('tournaments.field.rules') }}</h2>
        <p class="rules">
          {{ tour.rules }}
        </p>
      </section>

      <section
        class="block register"
        data-testid="registration-panel"
      >
        <h2>{{ t('registration.heading') }}</h2>

        <template v-if="!authenticated">
          <p>{{ t('registration.signInPrompt') }}</p>
        </template>

        <template v-else-if="registration && ['pending', 'approved', 'waitlisted'].includes(registration.state)">
          <p
            class="status"
            :data-testid="`registration-status`"
            :data-state="registration.state"
          >
            {{ t(`registration.state.${registration.state}`) }}
            <span v-if="registration.state === 'waitlisted' && registration.waitlistSeq !== null">
              (#{{ registration.waitlistSeq }})
            </span>
          </p>
          <button
            type="button"
            class="secondary"
            data-testid="withdraw"
            @click="onWithdraw"
          >
            {{ t('registration.withdraw') }}
          </button>
        </template>

        <template v-else-if="tour.participantType === 'team'">
          <p>{{ t('registration.teamOnly') }}</p>
        </template>

        <form
          v-else
          novalidate
          data-testid="register-form"
          @submit.prevent="onRegister"
        >
          <p
            v-if="registerError"
            class="summary"
            role="alert"
            data-testid="register-error"
          >
            {{ registerError }}
          </p>
          <div
            v-for="question in tour.questions"
            :key="question.key"
            class="field"
          >
            <label :for="`q-${question.key}`">{{ question.prompt }}</label>
            <select
              v-if="question.type === 'single_choice'"
              :id="`q-${question.key}`"
              v-model="answers[question.key]"
            >
              <option
                v-for="(option, index) in question.options"
                :key="index"
                :value="String(index)"
              >
                {{ option }}
              </option>
            </select>
            <input
              v-else
              :id="`q-${question.key}`"
              v-model="answers[question.key]"
            >
          </div>
          <button
            type="submit"
            class="primary"
            data-testid="register"
            :disabled="registering"
          >
            {{ registering ? t('registration.registering') : t('registration.register') }}
          </button>
        </form>
      </section>

      <section
        v-if="standings"
        class="block standings"
        data-testid="standings"
      >
        <h2>{{ t('standings.heading') }}</h2>
        <p
          class="status"
          data-testid="standings-status"
          :data-status="standings.status"
          :data-locked="standings.lockState"
        >
          {{ t(`standings.status.${standings.status}`) }}
          <span v-if="standings.lockState === 'locked'"> · {{ t('standings.locked') }}</span>
        </p>
        <div class="scroll">
          <table>
            <caption class="sr-only">
              {{ t('standings.heading') }}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  {{ t('standings.rank') }}
                </th>
                <th scope="col">
                  {{ t('standings.participant') }}
                </th>
                <th scope="col">
                  {{ t('standings.played') }}
                </th>
                <th scope="col">
                  {{ t('standings.wins') }}
                </th>
                <th scope="col">
                  {{ t('standings.losses') }}
                </th>
                <th scope="col">
                  {{ t('standings.points') }}
                </th>
                <th scope="col">
                  {{ t('standings.placement') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in standings.rows"
                :key="i"
                :data-placement="row.placement"
              >
                <td>{{ row.rank }}<span v-if="row.shared"> ({{ t('standings.tied') }})</span></td>
                <td>{{ t('standings.seed', { n: row.seed ?? '—' }) }}</td>
                <td>{{ row.played }}</td>
                <td>{{ row.wins }}</td>
                <td>{{ row.losses }}</td>
                <td>{{ row.points }}</td>
                <td>{{ t(`standings.placementLabel.${row.placement}`) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>{{ t('standings.bracket') }}</h2>
        <ul
          v-if="bracket"
          class="bracket"
          data-testid="bracket"
        >
          <li
            v-for="m in bracket.items"
            :key="m.key"
          >
            {{ t('standings.matchup', { a: m.a ?? '—', b: m.b ?? '—' }) }}
            · {{ t(`standings.matchState.${m.state}`) }}
            <span v-if="m.winner !== null">· {{ t('standings.wonBy', { n: m.winner }) }}</span>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.summary {
  color: var(--color-text-muted);
  font-size: var(--text-lg);
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: var(--space-4) 0;
}

.facts dt {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.facts dd {
  margin: 0;
  font-weight: 600;
}

.block {
  margin-block: var(--space-5);
}

.rules {
  white-space: pre-wrap;
}

.register {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.status {
  font-weight: 700;
}

.field {
  margin-block-end: var(--space-3);
}

.field label {
  display: block;
  margin-block-end: var(--space-1);
  font-weight: 600;
}

.field input,
.field select {
  inline-size: 100%;
  max-inline-size: 28rem;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.summary {
  padding: var(--space-3);
  border: 1px solid var(--color-danger-text);
  border-radius: var(--radius-md);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-weight: 600;
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

.secondary {
  padding-inline: var(--space-4);
  padding-block: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.standings .status {
  font-weight: 700;
}

.scroll {
  overflow-x: auto;
}

.standings table {
  inline-size: 100%;
  border-collapse: collapse;
}

.standings th,
.standings td {
  padding: var(--space-2) var(--space-3);
  border-block-end: 1px solid var(--color-border);
  text-align: start;
}

.standings tr[data-placement='champion'] {
  font-weight: 700;
}

.bracket {
  list-style: none;
  padding: 0;
}

.bracket li {
  padding-block: var(--space-1);
  border-block-end: 1px solid var(--color-border);
  font-size: var(--text-sm);
}

.sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
