<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { listContent, listGames } from '../composables/useContentApi.ts';
import { listTournaments } from '../composables/useTournamentsApi.ts';
import { listPublicPlayers, listPublicTeams } from '../composables/useDirectoryApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Global search across every public surface (FEATURE-008).
 *
 * Each source already exposes its own `q` search, so this fans out to all five in
 * parallel and groups the results rather than adding a server-side aggregate index —
 * one screen, five existing contracts, and each group keeps its own "see all" link back
 * to the list that owns it. A source that fails leaves its group empty instead of taking
 * the page down with it, because a directory being unavailable should not hide the
 * tournaments a visitor was looking for.
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { messageFor } = useApiErrors();

const PER_GROUP = 5;

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);
const activeQuery = computed(() => (route.query.q as string | undefined) ?? '');
const searchInput = ref(activeQuery.value);
watch(activeQuery, (value) => {
  searchInput.value = value;
});

interface Hit {
  key: string;
  title: string;
  meta: string;
  to: string;
}
interface Group {
  key: string;
  hits: Hit[];
  seeAll: string;
}

const loading = ref(false);
const error = ref<string | undefined>(undefined);
const groups = ref<Group[]>([]);
const total = computed(() => groups.value.reduce((n, g) => n + g.hits.length, 0));

let requestToken = 0;

/** Runs one source, returning an empty group if it fails so the others still render. */
async function group<T>(key: string, seeAll: string, run: () => Promise<{ items: T[] }>, toHit: (item: T) => Hit): Promise<Group> {
  try {
    const page = await run();
    return { key, seeAll, hits: page.items.slice(0, PER_GROUP).map(toHit) };
  } catch {
    return { key, seeAll, hits: [] };
  }
}

async function load(): Promise<void> {
  const q = activeQuery.value;
  if (q === '') {
    groups.value = [];
    return;
  }
  const token = ++requestToken;
  loading.value = true;
  const l = activeLocale.value;
  const p = prefix.value;
  try {
    const found = await Promise.all([
      group('tournaments', `${p}/tournaments?q=${encodeURIComponent(q)}`, () => listTournaments({ locale: l, q }), (item) => ({
        key: `tournament-${item.id}`,
        title: item.name,
        meta: item.summary,
        to: `${p}/tournaments/${encodeURIComponent(item.slug)}`
      })),
      group('games', `${p}/games?q=${encodeURIComponent(q)}`, () => listGames({ locale: l, q }), (item) => ({
        key: `game-${item.id}`,
        title: item.name,
        meta: item.description,
        to: `${p}/games/${encodeURIComponent(item.slug)}`
      })),
      group('content', `${p}/content?q=${encodeURIComponent(q)}`, () => listContent({ locale: l, q }), (item) => ({
        key: `content-${item.id}`,
        title: item.title,
        meta: item.summary,
        to: `${p}/content/${encodeURIComponent(item.type)}/${encodeURIComponent(item.slug)}`
      })),
      group('teams', `${p}/teams?q=${encodeURIComponent(q)}`, () => listPublicTeams({ q }), (item) => ({
        key: `team-${item.slug}`,
        title: item.name,
        meta: '',
        to: `${p}/teams/${encodeURIComponent(item.slug)}`
      })),
      group('players', `${p}/players?q=${encodeURIComponent(q)}`, () => listPublicPlayers({ q }), (item) => ({
        key: `player-${item.username}`,
        title: item.displayName,
        meta: `@${item.username}`,
        to: `${p}/players/${encodeURIComponent(item.username)}`
      }))
    ]);
    if (token !== requestToken) return; // a newer search started; drop this stale result
    groups.value = found.filter((g) => g.hits.length > 0);
    error.value = undefined;
  } catch (caught) {
    if (token === requestToken) error.value = messageFor(caught);
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

onMounted(() => load());
watch([activeQuery, activeLocale], () => load());

function submitSearch(): void {
  const q = searchInput.value.trim();
  void router.push({ path: `${prefix.value}/search`, query: q === '' ? {} : { q } });
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('search.global.heading') }}</h1>
        <p class="page-lead">
          {{ t('search.global.intro') }}
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
        for="global-search"
      >
        <span class="visually-hidden">{{ t('search.label') }}</span>
        <input
          id="global-search"
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
      v-if="activeQuery === ''"
      variant="empty"
      :message="t('search.global.prompt')"
    />
    <StateBlock
      v-else-if="loading && total === 0"
      variant="loading"
    />
    <StateBlock
      v-else-if="error"
      variant="error"
      :message="error"
    />
    <StateBlock
      v-else-if="total === 0"
      variant="empty"
      :message="t('search.global.empty', { q: activeQuery })"
    />

    <template v-else>
      <p
        class="result-count"
        role="status"
        data-testid="search-summary"
      >
        {{ t('search.global.summary', { q: activeQuery }) }}
      </p>
      <section
        v-for="g in groups"
        :key="g.key"
        class="block group"
        :data-testid="`search-group-${g.key}`"
      >
        <div class="group-head">
          <h2>{{ t(`search.global.group.${g.key}`) }}</h2>
          <RouterLink
            class="btn btn-ghost"
            :to="g.seeAll"
            :data-testid="`search-see-all-${g.key}`"
          >
            {{ t('search.global.seeAll') }}
          </RouterLink>
        </div>
        <ul class="hits">
          <li
            v-for="hit in g.hits"
            :key="hit.key"
          >
            <RouterLink
              class="hit"
              :to="hit.to"
            >
              <span class="hit-title">{{ hit.title }}</span>
              <span
                v-if="hit.meta"
                class="hit-meta"
              >{{ hit.meta }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
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

.result-count {
  margin-block-end: var(--space-4);
  color: var(--color-text-soft);
}

.group + .group {
  margin-block-start: var(--space-4);
}

.group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-block-end: var(--space-2);
}
.group-head h2 {
  margin: 0;
}

.hits {
  list-style: none;
  margin: 0;
  padding: 0;
}

.hit {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: inherit;
  text-decoration: none;
}
.hit:hover,
.hit:focus-visible {
  background-color: var(--color-surface-sunken);
}
.hit-title {
  font-weight: var(--weight-semibold);
}
.hit-meta {
  overflow: hidden;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
