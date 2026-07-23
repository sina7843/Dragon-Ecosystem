<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, formatNumber, formatTomanValue, viewerTimeZone } from '../i18n/format.ts';
import { getTournament, type MoneyView, type TournamentDetail } from '../composables/useTournamentsApi.ts';
import { applyHead } from '../head.ts';
import { myRegistration, newIdempotencyKey, registerForTournament, withdraw, type RegistrationStatus } from '../composables/useRegistrationsApi.ts';
import { fileReport } from '../composables/useModerationApi.ts';
import { getBracket, getStandings, type BracketMatchView, type StandingsView } from '../composables/useCompetitionsApi.ts';
import { startCheckout, confirmCheckout, mockPayCheckout, newCheckoutKey, type CheckoutView } from '../composables/useCheckoutApi.ts';
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

// Time-based status derived from the tournament's own dates — no invented backend state.
const heroStatus = computed<{ key: string; tone: string } | null>(() => {
  const card = tour.value;
  if (!card) return null;
  const now = Date.now();
  const start = card.startAt ? Date.parse(card.startAt) : null;
  const end = card.endAt ? Date.parse(card.endAt) : null;
  if (start === null) return { key: 'home.statusUnscheduled', tone: 'neutral' };
  if (end !== null && now > end) return { key: 'home.statusFinished', tone: 'neutral' };
  if (now >= start && (end === null || now <= end)) return { key: 'home.statusLive', tone: 'success' };
  return { key: 'home.statusUpcoming', tone: 'accent' };
});

const registration = ref<RegistrationStatus | null>(null);
const answers = ref<Record<string, string>>({});
const registering = ref(false);
const registerError = ref<string | undefined>(undefined);

const standings = ref<StandingsView | null>(null);
const bracketMatches = ref<BracketMatchView[]>([]);

// Group the whole bracket by round so a large field navigates as columns/sections
// rather than one long list (responsive large-bracket navigation, DRAGON-10).
const bracketRounds = computed(() => {
  const byRound = new Map<number, BracketMatchView[]>();
  for (const m of bracketMatches.value) {
    const list = byRound.get(m.round) ?? [];
    list.push(m);
    byRound.set(m.round, list);
  }
  return [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([round, matches]) => ({ round, matches }));
});

function printBracket(): void {
  globalThis.print();
}
async function shareBracket(): Promise<void> {
  try {
    await navigator.clipboard.writeText(globalThis.location.href);
    push('success', t('standings.shareCopied'));
  } catch {
    push('info', globalThis.location.href);
  }
}

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

function applySeo(detail: TournamentDetail): void {
  const path = `/${activeLocale()}/tournaments/${encodeURIComponent(detail.slug)}`;
  const origin = globalThis.location?.origin ?? '';
  applyHead({
    title: `${detail.name} — ${t('app.name')}`,
    locale: activeLocale(),
    path,
    indexable: true,
    description: detail.summary,
    ogType: 'website',
    // Structured data for the tournament as an Event (SEO-007). Dates are optional.
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: detail.name,
      description: detail.summary,
      inLanguage: activeLocale(),
      ...(detail.startAt ? { startDate: detail.startAt } : {}),
      ...(detail.endAt ? { endDate: detail.endAt } : {}),
      url: `${origin}${path}`
    }
  });
}

onMounted(async () => {
  try {
    tour.value = await getTournament(String(route.params['slug']), activeLocale());
    if (tour.value !== null) applySeo(tour.value);
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
      // Page through the whole bracket so large fields render completely (load-safe).
      const collected: BracketMatchView[] = [];
      let cursor: string | undefined;
      do {
        const page = await getBracket(tour.value.id, cursor);
        collected.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined && collected.length < 2000);
      bracketMatches.value = collected;
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

// --- Report this tournament (DRAGON-14) ---
const reportOpen = ref(false);
const reportReason = ref('');
const reportDetails = ref('');
const reportBusy = ref(false);
const reportSent = ref(false);
const reportError = ref<string | undefined>(undefined);

function openReport(): void {
  reportOpen.value = true;
  reportSent.value = false;
  reportError.value = undefined;
}

async function submitReport(): Promise<void> {
  if (tour.value === null || reportBusy.value || reportReason.value.trim() === '') return;
  reportBusy.value = true;
  reportError.value = undefined;
  try {
    await fileReport({
      subjectType: 'tournament',
      subjectId: tour.value.id,
      reason: reportReason.value.trim(),
      ...(reportDetails.value.trim() === '' ? {} : { details: reportDetails.value.trim() })
    });
    reportSent.value = true;
    reportOpen.value = false;
    reportReason.value = '';
    reportDetails.value = '';
    push('success', t('moderation.report.sent'));
  } catch (error) {
    reportError.value = messageFor(error);
  } finally {
    reportBusy.value = false;
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

// --- Paid registration checkout (DRAGON-12, OD-007 gated server-side) ---
const paid = computed(() => tour.value !== null && tour.value.fee.kind !== 'free');
const checkout = ref<CheckoutView | null>(null);
const checkoutBusy = ref(false);

async function startPaid(): Promise<void> {
  if (tour.value === null || checkoutBusy.value) return;
  checkoutBusy.value = true;
  try {
    checkout.value = await startCheckout(tour.value.id, newCheckoutKey());
    push('info', t('checkout.started'));
  } catch (error) {
    push('danger', messageFor(error));
  } finally {
    checkoutBusy.value = false;
  }
}

async function settlePaid(action: () => Promise<CheckoutView>): Promise<void> {
  if (checkout.value === null || checkoutBusy.value) return;
  checkoutBusy.value = true;
  try {
    checkout.value = await action();
    if (checkout.value.state === 'activated') {
      push('success', t('checkout.activated'));
      if (tour.value !== null) await loadStatus(tour.value.id);
    } else {
      push('info', t(`checkout.state.${checkout.value.state}`));
    }
  } catch (error) {
    push('danger', messageFor(error));
  } finally {
    checkoutBusy.value = false;
  }
}
function payPaid(outcome: 'success' | 'failed'): void {
  const id = checkout.value?.id;
  if (id !== undefined) void settlePaid(() => mockPayCheckout(id, outcome));
}
function confirmPaid(): void {
  const id = checkout.value?.id;
  if (id !== undefined) void settlePaid(() => confirmCheckout(id));
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
      <div class="hero">
        <div class="title-row">
          <div class="title-block">
            <div
              v-if="heroStatus"
              class="hero-meta"
            >
              <span
                class="status-pill"
                :class="`status-pill-${heroStatus.tone}`"
              >{{ t(heroStatus.key) }}</span>
              <span class="badge badge-accent">{{ t(`tournaments.feeKind.${tour.fee.kind}`) }}</span>
              <span class="badge badge-neutral">{{ t(`tournaments.participant.${tour.participantType}`) }}</span>
            </div>
            <h1 data-testid="tournament-title">
              {{ tour.name }}
            </h1>
          </div>
          <button
            v-if="authenticated && !reportOpen"
            type="button"
            class="btn btn-ghost"
            data-testid="report-tournament"
            @click="openReport"
          >
            {{ t('moderation.report.action') }}
          </button>
        </div>
        <p class="summary">
          {{ tour.summary }}
        </p>
      </div>

      <form
        v-if="reportOpen"
        class="report-form"
        data-testid="report-form"
        novalidate
        @submit.prevent="submitReport"
      >
        <p
          v-if="reportError"
          class="summary"
          role="alert"
          data-testid="report-error"
        >
          {{ reportError }}
        </p>
        <div class="field">
          <label for="report-reason">{{ t('moderation.report.reasonLabel') }}</label>
          <input
            id="report-reason"
            v-model="reportReason"
            required
          >
        </div>
        <div class="field">
          <label for="report-details">{{ t('moderation.report.detailsLabel') }}</label>
          <textarea
            id="report-details"
            v-model="reportDetails"
          />
        </div>
        <div class="row">
          <button
            type="submit"
            class="primary"
            data-testid="report-submit"
            :disabled="reportBusy || reportReason.trim() === ''"
          >
            {{ reportBusy ? t('moderation.report.sending') : t('moderation.report.submit') }}
          </button>
          <button
            type="button"
            class="secondary"
            data-testid="report-cancel"
            @click="reportOpen = false"
          >
            {{ t('moderation.report.cancel') }}
          </button>
        </div>
      </form>

      <p
        v-if="tour.description"
        class="description"
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

        <template v-else-if="paid && tour.participantType !== 'team'">
          <div
            v-if="checkout && checkout.state !== 'activated'"
            class="checkout"
            data-testid="checkout-panel"
            :data-state="checkout.state"
          >
            <p
              class="status"
              data-testid="checkout-state"
              :data-state="checkout.state"
            >
              {{ t(`checkout.state.${checkout.state}`) }}
            </p>
            <div
              v-if="checkout.state === 'awaiting_payment'"
              class="row"
            >
              <button
                type="button"
                class="primary"
                data-testid="checkout-pay"
                :disabled="checkoutBusy"
                @click="payPaid('success')"
              >
                {{ t('checkout.pay') }}
              </button>
              <button
                type="button"
                class="secondary"
                data-testid="checkout-fail"
                :disabled="checkoutBusy"
                @click="payPaid('failed')"
              >
                {{ t('checkout.simulateFailure') }}
              </button>
            </div>
            <button
              v-else-if="checkout.state === 'awaiting_confirmation'"
              type="button"
              class="primary"
              data-testid="checkout-confirm"
              :disabled="checkoutBusy"
              @click="confirmPaid"
            >
              {{ t('checkout.confirm') }}
            </button>
          </div>
          <button
            v-else
            type="button"
            class="primary"
            data-testid="start-checkout"
            :disabled="checkoutBusy"
            @click="startPaid"
          >
            {{ t('checkout.payAndRegister') }}
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

        <div class="bracket-head">
          <h2>{{ t('standings.bracket') }}</h2>
          <div
            class="bracket-tools"
            data-testid="bracket-tools"
          >
            <button
              type="button"
              class="secondary"
              data-testid="print-bracket"
              @click="printBracket"
            >
              {{ t('standings.print') }}
            </button>
            <button
              type="button"
              class="secondary"
              data-testid="share-bracket"
              @click="shareBracket"
            >
              {{ t('standings.share') }}
            </button>
          </div>
        </div>

        <!-- Round quick-navigation for large brackets. -->
        <nav
          v-if="bracketRounds.length > 1"
          class="round-nav"
          :aria-label="t('standings.bracket')"
        >
          <a
            v-for="group in bracketRounds"
            :key="group.round"
            :href="`#round-${group.round}`"
          >{{ t('standings.round', { n: group.round }) }}</a>
        </nav>

        <div
          class="bracket"
          data-testid="bracket"
        >
          <section
            v-for="group in bracketRounds"
            :id="`round-${group.round}`"
            :key="group.round"
            class="round"
          >
            <h3>{{ t('standings.round', { n: group.round }) }}</h3>
            <ul>
              <li
                v-for="m in group.matches"
                :key="m.key"
                :data-state="m.state"
              >
                {{ t('standings.matchup', { a: m.a ?? '—', b: m.b ?? '—' }) }}
                · {{ t(`standings.matchState.${m.state}`) }}
                <span v-if="m.winner !== null">· {{ t('standings.wonBy', { n: m.winner }) }}</span>
              </li>
            </ul>
          </section>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
/* ---- Hero ---- */
.hero {
  padding: var(--space-6);
  margin-block-end: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background-color: var(--color-surface);
  background-image: var(--gradient-hero);
}

.title-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: flex-start;
  justify-content: space-between;
}

.title-block h1 {
  margin: 0;
  font-size: var(--text-3xl);
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-block-end: var(--space-3);
}

.summary {
  margin-block: var(--space-3) 0;
  color: var(--color-text-muted);
  font-size: var(--text-lg);
  max-inline-size: 70ch;
}

.description {
  margin-block: var(--space-4);
  max-inline-size: 70ch;
}

/* Validation summaries are the only red-boxed .summary; keyed off role so the
   hero lead paragraph is never mistaken for an error (fixes prior collision). */
[role='alert'].summary {
  padding: var(--space-3);
  border: 1px solid var(--color-danger-text);
  border-radius: var(--radius-md);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
  max-inline-size: none;
}

/* ---- Facts (premium data grid) ---- */
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
  gap: var(--space-4);
  margin: var(--space-4) 0 var(--space-6);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface-raised);
}

.facts > div {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.facts dt {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.facts dd {
  margin: 0;
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
}

/* ---- Content blocks & panels ---- */
.block {
  margin-block: var(--space-6);
}

.block > h2 {
  margin-block-end: var(--space-3);
}

.rules {
  white-space: pre-wrap;
  max-inline-size: 70ch;
}

.register {
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface-raised);
  box-shadow: var(--shadow-sm);
}

.report-form {
  margin-block: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface-raised);
}

.report-form .row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.report-form textarea {
  inline-size: 100%;
  max-inline-size: 28rem;
  min-block-size: 4rem;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.checkout {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.checkout .row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* Registration / standings status rendered as a status pill (non-colour label). */
.status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding-block: 0.25em;
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  background-color: var(--color-surface-sunken);
  font-weight: var(--weight-semibold);
}
.status::before {
  content: '';
  inline-size: 0.5em;
  block-size: 0.5em;
  border-radius: var(--radius-full);
  background-color: currentColor;
}
.status[data-state='approved'] {
  background-color: var(--color-success-surface);
  color: var(--color-success-text);
  border-color: currentColor;
}
.status[data-state='waitlisted'] {
  background-color: var(--color-warning-surface);
  color: var(--color-warning-text);
  border-color: currentColor;
}

.field {
  margin-block-end: var(--space-3);
}

.field label {
  display: block;
  margin-block-end: var(--space-1);
  font-weight: var(--weight-semibold);
}

.field input,
.field select {
  inline-size: 100%;
  max-inline-size: 28rem;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

/* ---- Buttons (kept class names, restyled to the button system) ---- */
.primary,
.secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
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
  border-color: var(--color-primary);
}

/* ---- Standings table (premium data panel) ---- */
.standings .status {
  margin-block-end: var(--space-3);
}

.scroll {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.standings table {
  inline-size: 100%;
  border-collapse: collapse;
}

.standings th,
.standings td {
  padding: var(--space-3) var(--space-4);
  border-block-start: 1px solid var(--color-border);
  text-align: start;
  font-variant-numeric: tabular-nums;
}

.standings th {
  position: sticky;
  inset-block-start: 0;
  background-color: var(--color-surface-sunken);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}
[lang='fa'] .standings th {
  letter-spacing: normal;
  text-transform: none;
}

.standings tbody tr:hover {
  background-color: var(--color-surface-raised);
}

/* Champion row gets restrained premium emphasis, plus weight (not colour alone). */
.standings tr[data-placement='champion'] {
  font-weight: var(--weight-bold);
  background-color: var(--color-secondary-surface);
}
.standings tr[data-placement='champion'] td:first-child {
  box-shadow: inset 0.2rem 0 0 var(--color-primary);
}

/* ---- Bracket ---- */
.bracket-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
  margin-block-start: var(--space-6);
}

.bracket-tools {
  display: flex;
  gap: var(--space-2);
}

.round-nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block: var(--space-3);
}

.round-nav a {
  padding-block: var(--space-1);
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  text-decoration: none;
  color: var(--color-text);
}
.round-nav a:hover {
  background-color: var(--color-surface-raised);
}

/* Columns so a large bracket scrolls horizontally instead of stacking one long list.
   The region is focusable and labelled in the template for keyboard access (22.2). */
.bracket {
  display: flex;
  gap: var(--space-5);
  overflow-x: auto;
  padding-block: var(--space-2);
}

.round {
  min-inline-size: 15rem;
  flex: 0 0 auto;
}

.round h3 {
  margin-block-end: var(--space-2);
  font-size: var(--text-xs);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--color-text-muted);
}
[lang='fa'] .round h3 {
  letter-spacing: normal;
  text-transform: none;
}

.round ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Match card — participants and state read as text; border reinforces winner. */
.round li {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-inline-start: 3px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  font-size: var(--text-sm);
  box-shadow: var(--shadow-sm);
}

.round li[data-state='completed'] {
  border-inline-start-color: var(--color-primary);
}
.round li[data-state='live'] {
  border-inline-start-color: var(--color-success-text);
}

@media print {
  .register,
  .bracket-tools,
  .round-nav {
    display: none;
  }

  .bracket {
    flex-wrap: wrap;
    overflow: visible;
  }
}

.sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
