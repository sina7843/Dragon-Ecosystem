<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import AppThumb from '../components/AppThumb.vue';
import { listGames, type GameCard } from '../composables/useContentApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/** Public game catalog (PAGE-004). Only published games appear; search syncs to the URL. */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { messageFor } = useApiErrors();

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);
const activeQuery = computed(() => (route.query.q as string | undefined) ?? '');
const searchInput = ref(activeQuery.value);
watch(activeQuery, (value) => {
  searchInput.value = value;
});

const loading = ref(true);
const error = ref<string | undefined>(undefined);
const games = ref<GameCard[]>([]);
const nextCursor = ref<string | null>(null);

// Monotonic token: a slower earlier fetch must never overwrite a newer one (stale-response guard).
let requestToken = 0;

async function load(cursor?: string): Promise<void> {
  const token = ++requestToken;
  loading.value = true;
  try {
    const page = await listGames({
      locale: activeLocale.value,
      ...(activeQuery.value === '' ? {} : { q: activeQuery.value }),
      ...(cursor === undefined ? {} : { cursor })
    });
    if (token !== requestToken) return; // a newer load started; drop this stale result
    games.value = cursor === undefined ? page.items : [...games.value, ...page.items];
    nextCursor.value = page.nextCursor;
    error.value = undefined;
  } catch (caught) {
    if (token === requestToken) error.value = messageFor(caught);
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

onMounted(() => load());
watch([activeLocale, activeQuery], () => load());

function submitSearch(): void {
  const q = searchInput.value.trim();
  void router.push({ path: `${prefix.value}/games`, query: q === '' ? {} : { q } });
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('games.catalog.heading') }}</h1>
        <p class="page-lead">
          {{ t('games.catalog.intro') }}
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
        for="games-search"
      >
        <span class="visually-hidden">{{ t('search.label') }}</span>
        <input
          id="games-search"
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
      v-if="loading && games.length === 0"
      variant="loading"
    />
    <StateBlock
      v-else-if="error"
      variant="error"
      :message="error"
    />
    <StateBlock
      v-else-if="games.length === 0"
      variant="empty"
      :message="t('games.catalog.empty')"
    />

    <ul
      v-else
      class="card-grid cards"
    >
      <li
        v-for="game in games"
        :key="game.id"
        class="card card-interactive"
      >
        <RouterLink
          class="card-link"
          :to="`${prefix}/games/${encodeURIComponent(game.slug)}`"
          :data-testid="`game-card-${game.slug}`"
        >
          <!-- 21/9 everywhere a cover appears, matching the detail hero, so the same
               artwork is not cropped differently between the list and the page. -->
          <AppThumb
            class="card-thumb"
            :src="game.coverImageUrl"
            :label="game.name"
            :ratio="21 / 9"
          />
          <h2 class="card-title">
            {{ game.name }}
          </h2>
          <p class="card-meta">
            {{ game.description }}
          </p>
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

.card-link {
  display: block;
  block-size: 100%;
  color: inherit;
  text-decoration: none;
}

.card-thumb {
  margin-block-end: var(--space-3);
}

.card-link:hover .card-title {
  color: var(--color-accent);
}

.more-row {
  display: flex;
  justify-content: center;
  margin-block-start: var(--space-6);
}
</style>
