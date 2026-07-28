<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import AppThumb from '../components/AppThumb.vue';
import { apiFetch } from '../api.ts';
import { listContent, type ContentCard } from '../composables/useContentApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { formatDate } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Public content hub (PAGE-002). Type filter and pagination synchronise with the
 * URL (section 20.2). Only published content is returned by the API.
 */
const CONTENT_TYPES = ['news', 'article', 'announcement', 'guide', 'rules', 'page'] as const;

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { messageFor } = useApiErrors();

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);
const activeType = computed(() => (route.query.type as string | undefined) ?? '');
const activeQuery = computed(() => (route.query.q as string | undefined) ?? '');
// Set when arriving from a game page ("view all articles for this game").
const activeGame = computed(() => (route.query.game as string | undefined) ?? '');
const activeGameName = ref<string | null>(null);
const searchInput = ref(activeQuery.value);
watch(activeQuery, (value) => {
  searchInput.value = value;
});

const loading = ref(true);
const error = ref<string | undefined>(undefined);
const items = ref<ContentCard[]>([]);
const nextCursor = ref<string | null>(null);

// Monotonic token: a slower earlier fetch must never overwrite a newer one (stale-response guard).
let requestToken = 0;

async function load(cursor?: string): Promise<void> {
  const token = ++requestToken;
  loading.value = true;
  try {
    const page = await listContent({
      locale: activeLocale.value,
      ...(activeType.value === '' ? {} : { type: activeType.value }),
      ...(activeQuery.value === '' ? {} : { q: activeQuery.value }),
      ...(activeGame.value === '' ? {} : { game: activeGame.value }),
      ...(cursor === undefined ? {} : { cursor })
    });
    if (token !== requestToken) return; // a newer load started; drop this stale result
    items.value = cursor === undefined ? page.items : [...items.value, ...page.items];
    nextCursor.value = page.nextCursor;
    error.value = undefined;
  } catch (caught) {
    if (token === requestToken) error.value = messageFor(caught);
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

/** Resolves the filtered game's name so the chip reads as a name, not an id. */
async function loadGameName(): Promise<void> {
  if (activeGame.value === '') {
    activeGameName.value = null;
    return;
  }
  try {
    const games = await apiFetch<{ items: Array<{ id: string; name: string }> }>(
      `/games?locale=${activeLocale.value}&limit=100`
    );
    activeGameName.value = games.items.find((g) => g.id === activeGame.value)?.name ?? null;
  } catch {
    activeGameName.value = null; // the chip falls back to the raw id
  }
}

onMounted(async () => {
  await Promise.all([load(), loadGameName()]);
});
// Re-fetch when the filter, search text, or locale changes.
watch([activeType, activeQuery, activeGame, activeLocale], () => load());
watch([activeGame, activeLocale], () => void loadGameName());

function pushQuery(overrides: { type?: string; q?: string; game?: string }): void {
  const type = overrides.type ?? activeType.value;
  const q = overrides.q ?? activeQuery.value;
  // A game filter survives type/search changes until it is explicitly cleared.
  const game = overrides.game ?? activeGame.value;
  const query: Record<string, string> = {};
  if (type !== '') query.type = type;
  if (q !== '') query.q = q;
  if (game !== '') query.game = game;
  void router.push({ path: `${prefix.value}/content`, query });
}

/**
 * Every filter currently narrowing the list, each with its own clear control. The type
 * toggle row below shows only its own dimension, so this is the one place the combined
 * filter state (an arriving game, a search term, a type) is visible at once.
 */
const activeFilters = computed(() => {
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (activeGame.value !== '') {
    chips.push({
      key: 'game',
      label: t('content.hub.filteredByGame', { game: activeGameName.value ?? activeGame.value }),
      clear: () => pushQuery({ game: '' })
    });
  }
  if (activeQuery.value !== '') {
    chips.push({ key: 'q', label: t('search.filteredByTerm', { q: activeQuery.value }), clear: () => pushQuery({ q: '' }) });
  }
  if (activeType.value !== '') {
    chips.push({
      key: 'type',
      label: t('content.hub.filteredByType', { type: t(`content.type.${activeType.value}`) }),
      clear: () => pushQuery({ type: '' })
    });
  }
  return chips;
});

function selectType(type: string): void {
  pushQuery({ type });
}

function submitSearch(): void {
  pushQuery({ q: searchInput.value.trim() });
}

function detailPath(card: ContentCard): string {
  return `${prefix.value}/content/${card.type}/${encodeURIComponent(card.slug)}`;
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('content.hub.heading') }}</h1>
        <p class="page-lead">
          {{ t('content.hub.intro') }}
        </p>
      </div>
    </div>

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
      :aria-label="t('content.hub.filterLabel')"
    >
      <button
        type="button"
        class="chip"
        :aria-current="activeType === '' ? 'true' : undefined"
        data-testid="filter-all"
        @click="selectType('')"
      >
        {{ t('content.hub.all') }}
      </button>
      <button
        v-for="type in CONTENT_TYPES"
        :key="type"
        type="button"
        class="chip"
        :aria-current="activeType === type ? 'true' : undefined"
        :data-testid="`filter-${type}`"
        @click="selectType(type)"
      >
        {{ t(`content.type.${type}`) }}
      </button>
    </nav>

    <form
      class="search toolbar"
      role="search"
      @submit.prevent="submitSearch"
    >
      <label
        class="search-field"
        for="content-search"
      >
        <span class="visually-hidden">{{ t('search.label') }}</span>
        <input
          id="content-search"
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

    <StateBlock
      v-if="loading && items.length === 0"
      variant="loading"
    />
    <StateBlock
      v-else-if="error"
      variant="error"
      :message="error"
    />
    <StateBlock
      v-else-if="items.length === 0"
      variant="empty"
      :message="t('content.hub.empty')"
    />

    <ul
      v-else
      class="card-grid cards"
    >
      <li
        v-for="card in items"
        :key="card.id"
        class="card card-interactive"
      >
        <RouterLink
          class="card-link"
          :to="detailPath(card)"
          :data-testid="`content-card-${card.slug}`"
        >
          <!-- Matches the article hero's 21/9 so the cover is cropped the same way here
               as on the page it links to. -->
          <AppThumb
            class="card-thumb"
            :src="card.coverImageUrl"
            :label="card.title"
            :ratio="21 / 9"
          />
          <span class="badge badge-accent type">{{ t(`content.type.${card.type}`) }}</span>
          <h2 class="card-title">
            {{ card.title }}
          </h2>
          <p class="card-meta">
            {{ card.summary }}
          </p>
          <time
            class="date"
            :datetime="card.publishedAt"
          >{{ formatDate(card.publishedAt, activeLocale) }}</time>
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
        {{ t('content.hub.loadMore') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
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

.cards {
  list-style: none;
  margin: 0;
  padding: 0;
}

.card-link {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  block-size: 100%;
  color: inherit;
  text-decoration: none;
}

.card-link:hover .card-title {
  color: var(--color-accent);
}

.card-thumb {
  margin-block-end: var(--space-1);
}

.type {
  align-self: flex-start;
}

.date {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  margin-block-start: auto;
}

.more-row {
  display: flex;
  justify-content: center;
  margin-block-start: var(--space-6);
}
</style>
