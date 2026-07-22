<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
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

async function load(cursor?: string): Promise<void> {
  loading.value = true;
  try {
    const page = await listGames({
      locale: activeLocale.value,
      ...(activeQuery.value === '' ? {} : { q: activeQuery.value }),
      ...(cursor === undefined ? {} : { cursor })
    });
    games.value = cursor === undefined ? page.items : [...games.value, ...page.items];
    nextCursor.value = page.nextCursor;
    error.value = undefined;
  } catch (caught) {
    error.value = messageFor(caught);
  } finally {
    loading.value = false;
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
    <h1>{{ t('games.catalog.heading') }}</h1>
    <p>{{ t('games.catalog.intro') }}</p>

    <form
      class="search"
      role="search"
      @submit.prevent="submitSearch"
    >
      <label for="games-search">{{ t('search.label') }}</label>
      <input
        id="games-search"
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
      class="cards"
    >
      <li
        v-for="game in games"
        :key="game.id"
        class="card"
      >
        <RouterLink
          :to="`${prefix}/games/${encodeURIComponent(game.slug)}`"
          :data-testid="`game-card-${game.slug}`"
        >
          <h2>{{ game.name }}</h2>
          <p>{{ game.description }}</p>
        </RouterLink>
      </li>
    </ul>

    <button
      v-if="nextCursor"
      type="button"
      class="more"
      data-testid="load-more"
      @click="load(nextCursor ?? undefined)"
    >
      {{ t('games.catalog.loadMore') }}
    </button>
  </section>
</template>

<style scoped>
.cards {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
}

.card a {
  display: block;
  block-size: 100%;
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  text-decoration: none;
  color: inherit;
}

.card h2 {
  font-size: var(--text-lg);
  margin-block: 0 var(--space-2);
}

.more {
  margin-block-start: var(--space-5);
  padding-inline: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}
</style>
