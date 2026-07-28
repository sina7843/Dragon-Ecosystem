<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import AppThumb from '../components/AppThumb.vue';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { listStreams, type PublicStreamState, type StreamCard } from '../composables/useStreamsApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';

/**
 * Public stream discovery (PAGE-027). The shelf, search term, and relationship filters
 * synchronise with the URL so a direct refresh or a shared link reproduces the view.
 *
 * A stream whose provider is unavailable is shown with that state rather than hidden —
 * the requirement is that the visitor learns delivery is degraded (STREAM-008), not that
 * the stream disappears.
 */

/** Live and upcoming lead; the archive and called-off events are asked for explicitly. */
const SHELVES: readonly PublicStreamState[] = ['live', 'scheduled', 'ended', 'archived', 'cancelled'];

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);
const activeQuery = computed(() => (route.query.q as string | undefined) ?? '');
// Set when arriving from a game or tournament page ("watch this event").
const activeGame = computed(() => (route.query.game as string | undefined) ?? '');
const activeTournament = computed(() => (route.query.tournament as string | undefined) ?? '');
const activeShelf = computed<PublicStreamState | ''>(() => {
  const requested = route.query.state as string | undefined;
  return SHELVES.find((s) => s === requested) ?? '';
});
const searchInput = ref(activeQuery.value);
watch(activeQuery, (value) => {
  searchInput.value = value;
});

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const streams = ref<StreamCard[]>([]);

// Monotonic token: a slower earlier fetch must never overwrite a newer one.
let requestToken = 0;

async function load(): Promise<void> {
  const token = ++requestToken;
  loading.value = true;
  try {
    const page = await listStreams({
      locale: activeLocale(),
      ...(activeShelf.value === '' ? {} : { state: activeShelf.value }),
      ...(activeQuery.value === '' ? {} : { q: activeQuery.value }),
      ...(activeGame.value === '' ? {} : { game: activeGame.value }),
      ...(activeTournament.value === '' ? {} : { tournament: activeTournament.value })
    });
    if (token !== requestToken) return; // a newer load started; drop this stale result
    streams.value = page.items;
    errorMessage.value = undefined;
  } catch (error) {
    if (token === requestToken) errorMessage.value = messageFor(error);
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

onMounted(load);
watch([activeQuery, activeGame, activeTournament, activeShelf, activeLocale], () => load());

function pushQuery(overrides: { q?: string; game?: string; tournament?: string; state?: PublicStreamState | '' }): void {
  const q = overrides.q ?? activeQuery.value;
  const game = overrides.game ?? activeGame.value;
  const tournament = overrides.tournament ?? activeTournament.value;
  const state = overrides.state ?? activeShelf.value;
  const query: Record<string, string> = {};
  if (q !== '') query.q = q;
  if (game !== '') query.game = game;
  if (tournament !== '') query.tournament = tournament;
  // The live + upcoming default stays out of the URL.
  if (state !== '') query.state = state;
  void router.push({ path: `${prefix.value}/streams`, query });
}

function selectShelf(state: PublicStreamState | ''): void {
  pushQuery({ state });
}
function submitSearch(): void {
  pushQuery({ q: searchInput.value.trim() });
}

/**
 * Every filter currently narrowing the list, each with its own clear control — the one
 * place the combined filter state is visible at once.
 */
const activeFilters = computed(() => {
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (activeTournament.value !== '') {
    chips.push({ key: 'tournament', label: t('streams.filteredByTournament'), clear: () => pushQuery({ tournament: '' }) });
  }
  if (activeGame.value !== '') {
    chips.push({ key: 'game', label: t('streams.filteredByGame'), clear: () => pushQuery({ game: '' }) });
  }
  if (activeQuery.value !== '') {
    chips.push({ key: 'q', label: t('search.filteredByTerm', { q: activeQuery.value }), clear: () => pushQuery({ q: '' }) });
  }
  return chips;
});

/** Tone per lifecycle state, so the state reads from text and position, not colour alone. */
const TONES: Readonly<Record<PublicStreamState, string>> = {
  live: 'success',
  scheduled: 'accent',
  ended: 'neutral',
  archived: 'neutral',
  cancelled: 'danger',
  failed: 'warning'
};
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('streams.hub.heading') }}</h1>
        <p class="page-lead">
          {{ t('streams.hub.intro') }}
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
        for="streams-search"
      >
        <span class="visually-hidden">{{ t('search.label') }}</span>
        <input
          id="streams-search"
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

    <nav
      class="filters"
      :aria-label="t('streams.shelf.label')"
    >
      <button
        type="button"
        class="chip"
        :aria-current="activeShelf === '' ? 'true' : undefined"
        data-testid="shelf-default"
        @click="selectShelf('')"
      >
        {{ t('streams.shelf.default') }}
      </button>
      <button
        v-for="shelf in SHELVES"
        :key="shelf"
        type="button"
        class="chip"
        :aria-current="activeShelf === shelf ? 'true' : undefined"
        :data-testid="`shelf-${shelf}`"
        @click="selectShelf(shelf)"
      >
        {{ t(`streams.state.${shelf}`) }}
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
      v-else-if="streams.length === 0"
      variant="empty"
      :message="t('streams.hub.empty')"
    />

    <ul
      v-else
      class="card-grid cards"
      data-testid="stream-list"
    >
      <li
        v-for="stream in streams"
        :key="stream.id"
        class="card card-interactive s-card"
        :data-testid="`stream-card-${stream.slug}`"
      >
        <AppThumb
          class="card-thumb"
          :src="stream.coverImageUrl"
          :label="stream.title"
          :ratio="16 / 9"
        />
        <div class="s-top">
          <span
            class="status-pill"
            :class="`status-pill-${TONES[stream.state]}`"
            :data-testid="`stream-state-${stream.slug}`"
          >{{ t(`streams.state.${stream.state}`) }}</span>
          <span
            v-if="stream.accessMode === 'authenticated'"
            class="badge badge-neutral"
            data-testid="stream-access-authenticated"
          >{{ t('streams.access.authenticated') }}</span>
          <!-- The degraded state is stated in the card, so a visitor is not sent to a
               watch page that cannot play (STREAM-008). -->
          <span
            v-if="stream.availability === 'unavailable'"
            class="badge badge-warning"
            :data-testid="`stream-unavailable-${stream.slug}`"
          >{{ t('streams.availability.unavailable') }}</span>
        </div>
        <RouterLink
          class="s-link"
          :to="`${prefix}/streams/${stream.slug}`"
        >
          <h2 class="card-title">
            {{ stream.title }}
          </h2>
        </RouterLink>
        <p class="summary">
          {{ stream.summary }}
        </p>
        <dl
          v-if="stream.scheduledStartAt"
          class="meta"
        >
          <div>
            <dt>{{ t('streams.field.scheduledStartAt') }}</dt>
            <dd>{{ formatDateTime(stream.scheduledStartAt, activeLocale(), viewerTimeZone()) }}</dd>
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

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.chip-clear {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: var(--text-lg);
  line-height: 1;
  cursor: pointer;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block-end: var(--space-4);
}

.cards {
  list-style: none;
  margin: 0;
  padding: 0;
}

.s-top {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block: var(--space-3) var(--space-2);
}

.s-link {
  color: inherit;
  text-decoration: none;
}
.card-title {
  margin: 0;
}

.summary {
  margin-block: var(--space-2);
  color: var(--color-text-muted);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin: 0;
  font-size: var(--text-sm);
}
.meta dt {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-eyebrow);
}
[lang='fa'] .meta dt {
  font-family: var(--font-sans);
  text-transform: none;
  letter-spacing: normal;
  font-size: var(--text-sm);
}
.meta dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
</style>
