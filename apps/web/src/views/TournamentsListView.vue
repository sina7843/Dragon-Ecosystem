<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { listTournaments, type TournamentCard } from '../composables/useTournamentsApi.ts';
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
      ...(activeParticipant.value === '' ? {} : { participantType: activeParticipant.value })
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
watch([activeQuery, activeParticipant], () => load());
watch(activeLocale, () => {
  void loadGameNames();
  void load();
});

function pushQuery(overrides: { q?: string; participantType?: string }): void {
  const q = overrides.q ?? activeQuery.value;
  const participantType = overrides.participantType ?? activeParticipant.value;
  const query: Record<string, string> = {};
  if (q !== '') query.q = q;
  if (participantType !== '') query.participantType = participantType;
  void router.push({ path: `${prefix.value}/tournaments`, query });
}
function submitSearch(): void {
  pushQuery({ q: searchInput.value.trim() });
}
function selectParticipant(participantType: string): void {
  pushQuery({ participantType });
}
</script>

<template>
  <section>
    <h1>{{ t('tournaments.hub.heading') }}</h1>
    <p>{{ t('tournaments.hub.intro') }}</p>
    <p>
      <RouterLink :to="`${prefix}/tournaments-calendar`">
        {{ t('tournaments.hub.calendarLink') }}
      </RouterLink>
    </p>

    <form
      class="search"
      role="search"
      @submit.prevent="submitSearch"
    >
      <label for="tournaments-search">{{ t('search.label') }}</label>
      <input
        id="tournaments-search"
        v-model="searchInput"
        type="search"
        data-testid="search-input"
        :placeholder="t('search.placeholder')"
      >
      <button
        type="submit"
        data-testid="search-submit"
      >
        {{ t('search.submit') }}
      </button>
    </form>

    <nav
      class="filters"
      :aria-label="t('tournaments.field.participantType')"
    >
      <button
        type="button"
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
      class="cards"
    >
      <li
        v-for="tour in tournaments"
        :key="tour.id"
        :data-testid="`tournament-card-${tour.id}`"
      >
        <RouterLink :to="`${prefix}/tournaments/${tour.slug}`">
          <h2>{{ tour.name }}</h2>
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
            <dt>{{ t('tournaments.field.fee') }}</dt>
            <dd>{{ t(`tournaments.feeKind.${tour.feeKind}`) }}</dd>
          </div>
        </dl>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-4);
}

.cards li {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.cards h2 {
  margin: 0 0 var(--space-2);
}

.summary {
  color: var(--color-text-muted);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: var(--space-3) 0 0;
}

.meta dt {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.meta dd {
  margin: 0;
  font-weight: 600;
}
</style>
