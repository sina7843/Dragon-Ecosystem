<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import AppThumb from '../components/AppThumb.vue';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { listTournaments, type PublicTournamentState, type TournamentCard } from '../composables/useTournamentsApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';

/** Public tournament discovery list (upcoming first). Only published tournaments appear.
 * Search and the participant-type filter synchronise with the URL for direct refresh. */

interface GameCard { id: string; name: string }
const PARTICIPANT_TYPES = ['individual', 'team'] as const;

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);
const activeQuery = computed(() => (route.query.q as string | undefined) ?? '');
const activeParticipant = computed(() => (route.query.participantType as string | undefined) ?? '');
// Set when arriving from a game page ("view all tournaments for this game").
const activeGame = computed(() => (route.query.game as string | undefined) ?? '');
/**
 * Which shelf of the directory is showing. The default lists what is open or running;
 * `completed` is the results archive and `cancelled` the called-off events, so a finished
 * tournament stays reachable without displacing a live one in the default view.
 */
const ARCHIVE_STATES: readonly PublicTournamentState[] = ['published', 'completed', 'cancelled'];
const activeState = computed<PublicTournamentState>(() => {
  const requested = route.query.state as string | undefined;
  return ARCHIVE_STATES.find((s) => s === requested) ?? 'published';
});
const searchInput = ref(activeQuery.value);
watch(activeQuery, (value) => {
  searchInput.value = value;
});

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const tournaments = ref<TournamentCard[]>([]);
const gameName = ref<Map<string, string>>(new Map());

// Monotonic token: a slower earlier fetch must never overwrite a newer one (stale-response guard).
let requestToken = 0;

// The game-name map is localized but does not change per search/filter, so it is fetched
// once and only refreshed when the locale changes — not on every query/participant change.
async function loadGameNames(): Promise<void> {
  // Guard against an out-of-order resolve on rapid locale toggling: only apply the map if
  // the locale it was fetched for is still the active one.
  const forLocale = activeLocale();
  const games = await apiFetch<{ items: GameCard[] }>(`/games?locale=${forLocale}&limit=100`);
  if (forLocale !== activeLocale()) return;
  gameName.value = new Map(games.items.map((g) => [g.id, g.name]));
}

async function load(): Promise<void> {
  const token = ++requestToken;
  loading.value = true;
  try {
    const list = await listTournaments({
      locale: activeLocale(),
      ...(activeQuery.value === '' ? {} : { q: activeQuery.value }),
      ...(activeParticipant.value === '' ? {} : { participantType: activeParticipant.value }),
      ...(activeGame.value === '' ? {} : { game: activeGame.value }),
      state: activeState.value
    });
    if (token !== requestToken) return; // a newer load started; drop this stale result
    tournaments.value = list.items;
    errorMessage.value = undefined;
  } catch (error) {
    if (token === requestToken) errorMessage.value = messageFor(error);
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadGameNames(), load()]);
});
// Search/participant changes refetch only tournaments; a locale change refreshes both,
// since game and tournament names are localized.
watch([activeQuery, activeParticipant, activeGame, activeState], () => load());
watch(activeLocale, () => {
  void loadGameNames();
  void load();
});

function pushQuery(overrides: { q?: string; participantType?: string; game?: string; state?: PublicTournamentState }): void {
  const q = overrides.q ?? activeQuery.value;
  const participantType = overrides.participantType ?? activeParticipant.value;
  // A game filter survives search/participant changes until it is explicitly cleared.
  const game = overrides.game ?? activeGame.value;
  const state = overrides.state ?? activeState.value;
  const query: Record<string, string> = {};
  if (q !== '') query.q = q;
  if (participantType !== '') query.participantType = participantType;
  if (game !== '') query.game = game;
  // The live directory is the default, so it stays out of the URL.
  if (state !== 'published') query.state = state;
  void router.push({ path: `${prefix.value}/tournaments`, query });
}
function selectState(state: PublicTournamentState): void {
  pushQuery({ state });
}
const activeGameName = computed(() => (activeGame.value === '' ? null : gameName.value.get(activeGame.value) ?? null));

/**
 * Every filter currently narrowing the list, each with its own clear control.
 *
 * The chip row is the only place a visitor can see the whole filter state at once —
 * a game arriving from a link, a search term, and a participant type can all be active
 * together, and the toggle rows below show only their own dimension.
 */
const activeFilters = computed(() => {
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (activeGame.value !== '') {
    chips.push({
      key: 'game',
      label: t('tournaments.filteredByGame', { game: activeGameName.value ?? activeGame.value }),
      clear: () => pushQuery({ game: '' })
    });
  }
  if (activeQuery.value !== '') {
    chips.push({ key: 'q', label: t('search.filteredByTerm', { q: activeQuery.value }), clear: () => pushQuery({ q: '' }) });
  }
  if (activeParticipant.value !== '') {
    chips.push({
      key: 'participantType',
      label: t('tournaments.filteredByParticipant', { type: t(`tournaments.participant.${activeParticipant.value}`) }),
      clear: () => pushQuery({ participantType: '' })
    });
  }
  return chips;
});
function submitSearch(): void {
  pushQuery({ q: searchInput.value.trim() });
}
function selectParticipant(participantType: string): void {
  pushQuery({ participantType });
}

// Time-based status derived from the card's own dates — no invented backend state.
// The lifecycle state wins where it contradicts the schedule: a cancelled event is not
// "upcoming" merely because its start date has not passed.
function timeStatus(card: TournamentCard): { key: string; tone: string } {
  if (card.state === 'cancelled') return { key: 'tournaments.state.cancelled', tone: 'danger' };
  if (card.state === 'completed') return { key: 'tournaments.state.completed', tone: 'neutral' };
  const now = Date.now();
  const start = card.startAt ? Date.parse(card.startAt) : null;
  const end = card.endAt ? Date.parse(card.endAt) : null;
  if (start === null) return { key: 'home.statusUnscheduled', tone: 'neutral' };
  if (end !== null && now > end) return { key: 'home.statusFinished', tone: 'neutral' };
  if (now >= start && (end === null || now <= end)) return { key: 'home.statusLive', tone: 'success' };
  return { key: 'home.statusUpcoming', tone: 'accent' };
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('tournaments.hub.heading') }}</h1>
        <p class="page-lead">
          {{ t('tournaments.hub.intro') }}
        </p>
      </div>
      <div class="page-header-actions">
        <RouterLink
          class="btn btn-ghost"
          :to="`${prefix}/tournaments-calendar`"
        >
          {{ t('tournaments.hub.calendarLink') }}
        </RouterLink>
      </div>
    </div>

    <form
      class="search toolbar"
      role="search"
      @submit.prevent="submitSearch"
    >
      <label
        class="search-field"
        for="tournaments-search"
      >
        <span class="visually-hidden">{{ t('search.label') }}</span>
        <input
          id="tournaments-search"
          v-model="searchInput"
          type="search"
          data-testid="search-input"
          :placeholder="t('search.placeholder')"
        >
      </label>
      <button
        type="submit"
        class="btn btn-primary"
        data-testid="search-submit"
      >
        {{ t('search.submit') }}
      </button>
    </form>

    <!-- Every active filter is visible and individually removable, never silent. -->
    <div
      v-if="activeFilters.length > 0"
      class="active-filter"
      role="group"
      :aria-label="t('search.activeFilters')"
      data-testid="active-filters"
    >
      <span
        v-for="chip in activeFilters"
        :key="chip.key"
        class="filter-chip"
        :data-testid="`active-filter-${chip.key}`"
      >
        <span>{{ chip.label }}</span>
        <button
          type="button"
          class="chip-clear"
          :aria-label="t('search.clearFilter', { filter: chip.label })"
          :data-testid="`clear-${chip.key}-filter`"
          @click="chip.clear()"
        >
          ×
        </button>
      </span>
    </div>

    <!-- Live directory vs the results archive. Finished and cancelled events stay
         reachable here instead of disappearing when they end. -->
    <nav
      class="filters"
      :aria-label="t('tournaments.shelf.label')"
    >
      <button
        v-for="s in ARCHIVE_STATES"
        :key="s"
        type="button"
        class="chip"
        :aria-current="activeState === s ? 'true' : undefined"
        :data-testid="`shelf-${s}`"
        @click="selectState(s)"
      >
        {{ t(`tournaments.shelf.${s}`) }}
      </button>
    </nav>

    <nav
      class="filters"
      :aria-label="t('tournaments.field.participantType')"
    >
      <button
        type="button"
        class="chip"
        :aria-current="activeParticipant === '' ? 'true' : undefined"
        data-testid="participant-all"
        @click="selectParticipant('')"
      >
        {{ t('content.hub.all') }}
      </button>
      <button
        v-for="p in PARTICIPANT_TYPES"
        :key="p"
        type="button"
        class="chip"
        :aria-current="activeParticipant === p ? 'true' : undefined"
        :data-testid="`participant-${p}`"
        @click="selectParticipant(p)"
      >
        {{ t(`tournaments.participant.${p}`) }}
      </button>
    </nav>

    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />
    <StateBlock
      v-else-if="tournaments.length === 0"
      variant="empty"
      :message="t('tournaments.hub.empty')"
    />

    <ul
      v-else
      class="card-grid cards"
    >
      <li
        v-for="tour in tournaments"
        :key="tour.id"
        class="card card-interactive t-card"
        :data-testid="`tournament-card-${tour.id}`"
      >
        <!-- Matches the tournament hero's 21/9 so the poster is cropped the same way
             here as on the page it links to. -->
        <AppThumb
          class="card-thumb"
          :src="tour.coverImageUrl"
          :label="tour.name"
          :ratio="21 / 9"
        />
        <div class="t-top">
          <span
            class="status-pill"
            :class="`status-pill-${timeStatus(tour).tone}`"
          >{{ t(timeStatus(tour).key) }}</span>
          <span class="badge badge-accent">{{ t(`tournaments.feeKind.${tour.feeKind}`) }}</span>
        </div>
        <RouterLink
          class="t-link"
          :to="`${prefix}/tournaments/${tour.slug}`"
        >
          <h2 class="card-title">
            {{ tour.name }}
          </h2>
        </RouterLink>
        <p class="summary">
          {{ tour.summary }}
        </p>
        <dl class="meta">
          <div>
            <dt>{{ t('tournaments.field.game') }}</dt>
            <dd>{{ gameName.get(tour.gameId) ?? '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('tournaments.field.participantType') }}</dt>
            <dd>{{ t(`tournaments.participant.${tour.participantType}`) }}</dd>
          </div>
          <div v-if="tour.startAt">
            <dt>{{ t('tournaments.field.startAt') }}</dt>
            <dd>{{ formatDateTime(tour.startAt, activeLocale(), viewerTimeZone()) }}</dd>
          </div>
          <div>
            <dt>{{ t('tournaments.field.capacity') }}</dt>
            <dd class="numeric">
              {{ tour.capacity }}
            </dd>
          </div>
        </dl>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.search-field {
  flex: 1;
  min-inline-size: 12rem;
}
.search-field input {
  inline-size: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.active-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-block: 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-primary-soft);
  color: var(--color-accent);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  inline-size: fit-content;
  max-inline-size: 100%;
}

/* One pill per active filter, each carrying its own dismiss control so a visitor removes
   exactly the constraint they mean to and can see the rest still applied. */
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.filter-chip + .filter-chip {
  padding-inline-start: var(--space-2);
  border-inline-start: 1px solid var(--color-border-strong);
}
.chip-clear {
  display: inline-grid;
  place-items: center;
  min-inline-size: var(--target-min);
  min-block-size: var(--target-min);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font-size: var(--text-lg);
  line-height: 1;
  cursor: pointer;
}
.chip-clear:hover {
  color: var(--color-text);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block-end: var(--space-5);
}
.chip {
  padding-inline: var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}
.chip:hover {
  background-color: var(--color-surface-raised);
}
/* Selected filter carries fill, border, and weight — not colour alone (23.2). */
.chip[aria-current='true'] {
  background-color: var(--color-primary);
  color: var(--color-primary-text);
  border-color: var(--color-primary);
  font-weight: var(--weight-semibold);
}

.cards {
  list-style: none;
  margin: 0;
  padding: 0;
}

.t-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
/* Matches the content hub and games catalogue, so every discovery card leads with art. */
.card-thumb {
  margin-block-end: var(--space-1);
}
.t-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.t-link {
  color: inherit;
  text-decoration: none;
}
.t-link:hover .card-title {
  color: var(--color-accent);
}

.summary {
  color: var(--color-text-muted);
  margin: 0;
}

.meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3) var(--space-4);
  margin: var(--space-2) 0 0;
  padding-block-start: var(--space-3);
  border-block-start: 1px solid var(--color-border);
}

.meta dt {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.meta dd {
  margin: 0;
  font-weight: var(--weight-semibold);
}
</style>
