<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AppThumb from '../components/AppThumb.vue';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, formatNumber, formatTomanValue, viewerTimeZone } from '../i18n/format.ts';
import { getTournament, getTournamentParticipants, type MoneyView, type PublicParticipant, type TournamentDetail } from '../composables/useTournamentsApi.ts';
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
const participants = ref<PublicParticipant[]>([]);

// A participant links to its public page: a team to its team page, an individual to
// their public player profile. Returns null when there is no public destination.
function participantLink(p: PublicParticipant): string | null {
  const base = `/${activeLocale()}`;
  if (p.participantType === 'team' && p.teamSlug) return `${base}/teams/${encodeURIComponent(p.teamSlug)}`;
  if (p.participantType === 'individual' && p.username) return `${base}/players/${encodeURIComponent(p.username)}`;
  return null;
}

// Group the whole bracket by round so a large field navigates as columns/sections
// rather than one long list (responsive large-bracket navigation, DRAGON-10).
// Elimination formats get the left-to-right bracket graphic; Swiss and round-robin
// lead with the standings table and show their matches as a round grid (no tree).
const ELIM_FORMATS = ['single_elimination', 'double_elimination'];
const isElim = computed(() => ELIM_FORMATS.includes(tour.value?.format ?? ''));

// Stable display order for the bracket groups a double-elimination emits.
const BAND_ORDER = ['winners', 'main', 'losers', 'grand_final', 'swiss', 'round_robin', 'manual'];
const BAND_LABELLED = new Set(['winners', 'losers', 'grand_final']);

interface RoundColumn {
  round: number;
  matches: BracketMatchView[];
}
interface MatchBand {
  key: string;
  /** Only shown when a format emits more than one band (double elimination). */
  labelKey: string | null;
  rounds: RoundColumn[];
}

// Group matches into bands (by bracket) then rounds, so single/double elimination and
// the round formats all render from one structure.
const matchBands = computed<MatchBand[]>(() => {
  const byBand = new Map<string, BracketMatchView[]>();
  for (const m of bracketMatches.value) {
    const list = byBand.get(m.bracket) ?? [];
    list.push(m);
    byBand.set(m.bracket, list);
  }
  const rank = (k: string): number => {
    const i = BAND_ORDER.indexOf(k);
    return i === -1 ? BAND_ORDER.length : i;
  };
  const keys = [...byBand.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const multi = keys.length > 1;
  return keys.map((key) => {
    const byRound = new Map<number, BracketMatchView[]>();
    for (const m of byBand.get(key) ?? []) {
      const list = byRound.get(m.round) ?? [];
      list.push(m);
      byRound.set(m.round, list);
    }
    const rounds = [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([round, matches]) => ({ round, matches }));
    return { key, labelKey: multi && BAND_LABELLED.has(key) ? `standings.bracketName.${key}` : null, rounds };
  });
});

const hasMatches = computed(() => bracketMatches.value.length > 0);

// Seeds are the competition's participant identity (names are separate polish); a null
// slot is a not-yet-decided position.
function seedLabel(seed: number | null): string {
  return seed === null ? t('standings.tbd') : t('standings.seed', { n: seed });
}

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
  // Public participant list, only when the organizer has made it public.
  if (tour.value !== null && tour.value.participantsPublic) {
    try {
      participants.value = (await getTournamentParticipants(tour.value.id)).items;
    } catch {
      participants.value = []; // 404 if visibility flipped off between reads
    }
  }
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
      <!-- Image-forward hero: banner with status/fee/type over a scrim. -->
      <div class="hero">
        <AppThumb
          class="hero-thumb"
          :src="tour.coverImageUrl"
          :label="tour.name"
          :ratio="21 / 9"
        />
        <div class="hero-scrim">
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
              class="btn btn-neutral report-btn"
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
        v-if="tour.participantsPublic"
        class="block"
        data-testid="participants-panel"
      >
        <h2>{{ t('participants.heading') }}</h2>
        <p
          v-if="participants.length === 0"
          class="muted"
        >
          {{ t('participants.empty') }}
        </p>
        <ul
          v-else
          class="participants"
        >
          <li
            v-for="p in participants"
            :key="p.registrationId"
          >
            <component
              :is="participantLink(p) ? 'RouterLink' : 'div'"
              :to="participantLink(p) ?? undefined"
              class="participant"
              :class="{ 'participant-link': participantLink(p) }"
            >
              <span
                class="participant-badge"
                aria-hidden="true"
              >{{ (p.name ?? '?').trim().charAt(0).toUpperCase() }}</span>
              <span class="participant-body">
                <span class="participant-name">{{ p.name ?? t('participants.unknown') }}</span>
                <bdi
                  v-if="p.participantType === 'individual' && p.username"
                  class="latin-value participant-handle"
                >@{{ p.username }}</bdi>
                <span
                  v-else-if="p.participantType === 'team'"
                  class="participant-kind"
                >{{ t('participants.team') }}</span>
              </span>
            </component>
          </li>
        </ul>
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

        <template v-if="hasMatches">
          <div class="bracket-head">
            <h2>{{ isElim ? t('standings.bracket') : t('standings.matches') }}</h2>
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

          <!-- Elimination: left-to-right round columns (bracket). Swiss / round-robin:
               a round grid, since the ranking already lives in the table above. -->
          <div
            class="bracket"
            :class="{ 'as-grid': !isElim }"
            data-testid="bracket"
          >
            <div
              v-for="band in matchBands"
              :key="band.key"
              class="band"
            >
              <h3
                v-if="band.labelKey"
                class="band-title"
              >
                {{ t(band.labelKey) }}
              </h3>
              <div class="rounds">
                <section
                  v-for="col in band.rounds"
                  :key="col.round"
                  class="round-col"
                >
                  <span class="round-label">{{ t('standings.round', { n: col.round }) }}</span>
                  <div class="match-list">
                    <div
                      v-for="m in col.matches"
                      :key="m.key"
                      class="match"
                    >
                      <article
                        class="match-card"
                        :data-state="m.state"
                      >
                        <div
                          class="slot"
                          :class="{ win: m.winner !== null && m.winner === m.a }"
                        >
                          <span class="seed">{{ seedLabel(m.a) }}</span>
                          <svg
                            v-if="m.winner !== null && m.winner === m.a"
                            class="win-ic"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M5 12l4 4 10-10" />
                          </svg>
                        </div>
                        <div
                          class="slot"
                          :class="{ win: m.winner !== null && m.winner === m.b }"
                        >
                          <span class="seed">{{ seedLabel(m.b) }}</span>
                          <svg
                            v-if="m.winner !== null && m.winner === m.b"
                            class="win-ic"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M5 12l4 4 10-10" />
                          </svg>
                        </div>
                        <span class="mstate">{{ t(`standings.matchState.${m.state}`) }}</span>
                      </article>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
/* ---- Hero ---- */
.hero {
  position: relative;
  overflow: hidden;
  margin-block-end: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
}
.hero-thumb {
  border-radius: 0;
}
.hero-scrim {
  position: absolute;
  inset-block-end: 0;
  inset-inline: 0;
  padding: clamp(var(--space-4), 4vw, var(--space-6));
  background: var(--gradient-hero);
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
  color: #ffffff;
}
[lang='fa'] .title-block h1 {
  line-height: 1.4;
}

/* Neutral report button reads clearly over the dark scrim. */
.report-btn {
  flex: none;
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
  color: rgb(255 255 255 / 85%);
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

.muted {
  color: var(--color-text-muted);
}

.participants {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
}
.participant {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: inherit;
  text-decoration: none;
}
/* Only linked participants signal clickability. */
.participant-link {
  transition:
    border-color var(--motion-fast) var(--motion-ease),
    transform var(--motion-fast) var(--motion-ease);
}
.participant-link:hover {
  border-color: var(--color-border-strong);
  transform: translateY(-2px);
}
.participant-link:hover .participant-name {
  color: var(--color-accent);
}
.participant-badge {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 2.25rem;
  block-size: 2.25rem;
  border-radius: var(--radius-md);
  background-color: var(--color-primary-soft);
  color: var(--color-accent);
  font-weight: var(--weight-black);
}
.participant-body {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}
.participant-name {
  font-weight: var(--weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.participant-handle,
.participant-kind {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
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

/* ---- Graphic match display ---- */
.bracket {
  --bkt-line: var(--color-border-strong);
  /* Width of the connector gutter between two rounds. */
  --bkt-gap: 2.75rem;
  --bkt-col: 14rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  margin-block-start: var(--space-4);
}

.band-title {
  margin-block: 0 var(--space-2);
  font-size: var(--text-md);
  color: var(--color-text-soft);
}

/* Rounds sit side by side; the field scrolls horizontally when large. Region is
   focusable + labelled in the template for keyboard access (22.2). */
.rounds {
  display: flex;
  overflow-x: auto;
  padding-block: var(--space-1);
}

.round-col {
  flex: 0 0 auto;
  inline-size: var(--bkt-col);
  display: flex;
  flex-direction: column;
}
/* Connector gutter to the next round (elimination tree only). */
.bracket:not(.as-grid) .round-col:not(:last-child) {
  margin-inline-end: var(--bkt-gap);
}

.round-label {
  align-self: start;
  margin-block-end: var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--color-text-muted);
}
[lang='fa'] .round-label {
  letter-spacing: normal;
  text-transform: none;
}

/* Elimination tree: matches spread evenly so each later-round match centres between
   its two feeders; connectors are drawn on the slot wrappers below. */
.bracket:not(.as-grid) .match-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
}
.bracket:not(.as-grid) .match {
  position: relative;
  flex: 1 0 auto;
  display: flex;
  align-items: center;
}

/* Outgoing connector: a horizontal line at each card's midline reaching to a vertical
   riser that joins the pair. Odd cards drop down to the pair midpoint, even cards rise. */
.bracket:not(.as-grid) .round-col:not(:last-child) .match::after {
  content: '';
  position: absolute;
  inset-inline-end: calc(-1 * var(--bkt-gap));
  inline-size: var(--bkt-gap);
  block-size: 50%;
  border-inline-end: 2px solid var(--bkt-line);
}
.bracket:not(.as-grid) .round-col:not(:last-child) .match:nth-child(odd)::after {
  inset-block-start: 50%;
  border-block-start: 2px solid var(--bkt-line);
}
.bracket:not(.as-grid) .round-col:not(:last-child) .match:nth-child(even)::after {
  inset-block-end: 50%;
  border-block-end: 2px solid var(--bkt-line);
}
/* Each pair is two feeder lines meeting one vertical riser; the next-round card butts
   directly against that riser, so no separate incoming stub is drawn (a clean "]"). */
.bracket:not(.as-grid) .match-card {
  inline-size: 100%;
}

/* Round-robin / Swiss: the table above is the ranking, so matches read as a plain
   grid, not a left-to-right tree. */
.bracket.as-grid .rounds {
  display: block;
  overflow: visible;
}
.bracket.as-grid .round-col {
  inline-size: auto;
  margin-block-end: var(--space-4);
}
.bracket.as-grid .match-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr));
  gap: var(--space-3);
}

/* Match card: two seed slots, the winner lit; a small state caption underneath. */
.match-card {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-sm);
}
.slot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-text-soft);
}
.slot + .slot {
  border-block-start: 1px solid var(--color-border);
}
.slot.win {
  background-color: var(--color-primary-soft);
  color: var(--color-accent);
  font-weight: var(--weight-black);
}
.slot .seed {
  font-variant-numeric: tabular-nums;
}
.win-ic {
  flex: none;
  inline-size: 1rem;
  block-size: 1rem;
}
.mstate {
  display: block;
  padding: var(--space-1) var(--space-3);
  border-block-start: 1px solid var(--color-border);
  background-color: var(--color-surface-sunken);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.match-card[data-state='completed'] {
  border-color: var(--color-border-strong);
}

@media print {
  .register,
  .bracket-tools {
    display: none;
  }
  .rounds {
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
