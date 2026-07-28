<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import AppThumb from '../components/AppThumb.vue';
import { apiFetch } from '../api.ts';
import { listPublicTeams, type TeamCard } from '../composables/useDirectoryApi.ts';
import type { GameCard } from '../composables/useContentApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Public team directory (UX-002). The search endpoint behind it already existed but had
 * no page: a team could only be reached by typing its URL. Search and the game filter
 * both live in the URL so a filtered directory is linkable and survives a refresh.
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { messageFor } = useApiErrors();

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);
const activeQuery = computed(() => (route.query.q as string | undefined) ?? '');
const activeGame = computed(() => (route.query.game as string | undefined) ?? '');
const searchInput = ref(activeQuery.value);
watch(activeQuery, (value) => {
  searchInput.value = value;
});

const loading = ref(true);
const error = ref<string | undefined>(undefined);
const teams = ref<TeamCard[]>([]);
const nextCursor = ref<string | null>(null);
const gameName = ref<Map<string, string>>(new Map());

// Monotonic token: a slower earlier fetch must never overwrite a newer one.
let requestToken = 0;

async function loadGameNames(): Promise<void> {
  const forLocale = activeLocale.value;
  const games = await apiFetch<{ items: GameCard[] }>(`/games?locale=${forLocale}&limit=100`);
  if (forLocale !== activeLocale.value) return;
  gameName.value = new Map(games.items.map((g) => [g.id, g.name]));
}

async function load(cursor?: string): Promise<void> {
  const token = ++requestToken;
  loading.value = true;
  try {
    const page = await listPublicTeams({
      ...(activeQuery.value === '' ? {} : { q: activeQuery.value }),
      ...(activeGame.value === '' ? {} : { game: activeGame.value }),
      ...(cursor === undefined ? {} : { cursor })
    });
    if (token !== requestToken) return;
    teams.value = cursor === undefined ? page.items : [...teams.value, ...page.items];
    nextCursor.value = page.nextCursor;
    error.value = undefined;
  } catch (caught) {
    if (token === requestToken) error.value = messageFor(caught);
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadGameNames(), load()]);
});
watch([activeQuery, activeGame], () => load());
watch(activeLocale, () => {
  void loadGameNames();
});

function pushQuery(overrides: { q?: string; game?: string }): void {
  const q = overrides.q ?? activeQuery.value;
  const game = overrides.game ?? activeGame.value;
  const next: Record<string, string> = {};
  if (q !== '') next.q = q;
  if (game !== '') next.game = game;
  void router.push({ path: `${prefix.value}/teams`, query: next });
}
function submitSearch(): void {
  pushQuery({ q: searchInput.value.trim() });
}
/** The active game filter, shown as a removable chip so it is never silently applied. */
const activeGameName = computed(() => (activeGame.value === '' ? null : gameName.value.get(activeGame.value) ?? null));
function clearGame(): void {
  pushQuery({ game: '' });
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('teams.directory.heading') }}</h1>
        <p class="page-lead">
          {{ t('teams.directory.intro') }}
        </p>
      </div>
    </div>

    <form
      class="search toolbar"
      role="search"
      @submit.prevent="submitSearch"
    >
      <label
        class="search-field"
        for="teams-search"
      >
        <span class="visually-hidden">{{ t('search.label') }}</span>
        <input
          id="teams-search"
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

    <p
      v-if="activeGame !== ''"
      class="active-filter"
      data-testid="game-filter"
    >
      <span>{{ t('teams.directory.filteredByGame', { game: activeGameName ?? activeGame }) }}</span>
      <button
        type="button"
        class="btn btn-ghost"
        data-testid="clear-game-filter"
        @click="clearGame"
      >
        {{ t('search.clear') }}
      </button>
    </p>

    <StateBlock
      v-if="loading && teams.length === 0"
      variant="loading"
    />
    <StateBlock
      v-else-if="error"
      variant="error"
      :message="error"
    />
    <StateBlock
      v-else-if="teams.length === 0"
      variant="empty"
      :message="t('teams.directory.empty')"
    />

    <ul
      v-else
      class="card-grid cards"
    >
      <li
        v-for="team in teams"
        :key="team.slug"
        class="card card-interactive"
      >
        <RouterLink
          class="card-link team-link"
          :to="`${prefix}/teams/${encodeURIComponent(team.slug)}`"
          :data-testid="`team-card-${team.slug}`"
        >
          <AppThumb
            class="team-logo"
            :src="team.avatarUrl"
            :label="team.name"
            :ratio="1"
          />
          <span class="team-body">
            <span class="card-title">{{ team.name }}</span>
            <span class="card-meta">{{ gameName.get(team.gameId) ?? '—' }}</span>
          </span>
        </RouterLink>
      </li>
    </ul>

    <div
      v-if="nextCursor"
      class="more-row"
    >
      <button
        type="button"
        class="btn btn-neutral"
        data-testid="load-more"
        @click="load(nextCursor ?? undefined)"
      >
        {{ t('games.catalog.loadMore') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.cards {
  list-style: none;
  margin: 0;
  padding: 0;
}

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
  margin-block-end: var(--space-4);
  color: var(--color-text-soft);
}

/* Logo beside the name rather than above it: a team card is an identity, not an article. */
.team-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  block-size: 100%;
  color: inherit;
  text-decoration: none;
}
.team-logo {
  flex: none;
  inline-size: 3.5rem;
}
.team-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-inline-size: 0;
}
.team-link:hover .card-title {
  color: var(--color-accent);
}

.more-row {
  display: flex;
  justify-content: center;
  margin-block-start: var(--space-6);
}
</style>
