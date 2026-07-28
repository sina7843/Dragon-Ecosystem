<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { listPublicPlayers, type PlayerCard } from '../composables/useDirectoryApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Public player directory (UX-002). Lists only the profiles their owner has made public —
 * that is the server's decision, so a private profile is absent here exactly as it is
 * absent from a direct URL lookup.
 */
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
const players = ref<PlayerCard[]>([]);
const nextCursor = ref<string | null>(null);

// Monotonic token: a slower earlier fetch must never overwrite a newer one.
let requestToken = 0;

async function load(cursor?: string): Promise<void> {
  const token = ++requestToken;
  loading.value = true;
  try {
    const page = await listPublicPlayers({
      ...(activeQuery.value === '' ? {} : { q: activeQuery.value }),
      ...(cursor === undefined ? {} : { cursor })
    });
    if (token !== requestToken) return;
    players.value = cursor === undefined ? page.items : [...players.value, ...page.items];
    nextCursor.value = page.nextCursor;
    error.value = undefined;
  } catch (caught) {
    if (token === requestToken) error.value = messageFor(caught);
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

onMounted(() => load());
watch(activeQuery, () => load());

function submitSearch(): void {
  const q = searchInput.value.trim();
  void router.push({ path: `${prefix.value}/players`, query: q === '' ? {} : { q } });
}

/** Initial used as an avatar stand-in; profiles carry no public picture in this list. */
function initial(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase();
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('players.directory.heading') }}</h1>
        <p class="page-lead">
          {{ t('players.directory.intro') }}
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
        for="players-search"
      >
        <span class="visually-hidden">{{ t('search.label') }}</span>
        <input
          id="players-search"
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
      v-if="loading && players.length === 0"
      variant="loading"
    />
    <StateBlock
      v-else-if="error"
      variant="error"
      :message="error"
    />
    <StateBlock
      v-else-if="players.length === 0"
      variant="empty"
      :message="t('players.directory.empty')"
    />

    <ul
      v-else
      class="card-grid cards"
    >
      <li
        v-for="player in players"
        :key="player.username"
        class="card card-interactive"
      >
        <RouterLink
          class="player-link"
          :to="`${prefix}/players/${encodeURIComponent(player.username)}`"
          :data-testid="`player-card-${player.username}`"
        >
          <span
            class="player-badge"
            aria-hidden="true"
          >{{ initial(player.displayName) }}</span>
          <span class="player-body">
            <span class="card-title">{{ player.displayName }}</span>
            <!-- A username is a code-like value, so it stays LTR inside Persian text. -->
            <bdi class="latin-value player-handle">@{{ player.username }}</bdi>
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

.player-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  block-size: 100%;
  color: inherit;
  text-decoration: none;
}
.player-badge {
  flex: none;
  display: grid;
  place-items: center;
  inline-size: 3rem;
  block-size: 3rem;
  border-radius: var(--radius-full);
  background-color: var(--color-primary-soft);
  color: var(--color-accent);
  font-weight: var(--weight-black);
}
.player-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-inline-size: 0;
}
.player-handle {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.player-link:hover .card-title {
  color: var(--color-accent);
}

.more-row {
  display: flex;
  justify-content: center;
  margin-block-start: var(--space-6);
}
</style>
