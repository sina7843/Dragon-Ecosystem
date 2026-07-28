<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AppThumb from '../components/AppThumb.vue';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { getGame, listContent, type ContentCard, type GameDetail } from '../composables/useContentApi.ts';
import { listTournaments, type TournamentCard } from '../composables/useTournamentsApi.ts';
import { applyHead } from '../head.ts';
import { formatDateTime } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/** Public game detail (PAGE-005). Unpublished games show the not-found state. */
const { t, locale } = useI18n();
const route = useRoute();

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);

const loading = ref(true);
const notFound = ref(false);
const game = ref<GameDetail | null>(null);
// Everything played on / written about this game.
const tournaments = ref<TournamentCard[]>([]);
const content = ref<ContentCard[]>([]);

function fmtDate(value: string | null): string {
  return value === null ? t('tournaments.tbd') : formatDateTime(value, activeLocale.value, 'Asia/Tehran');
}

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  tournaments.value = [];
  content.value = [];
  const slug = String(route.params.slug);
  try {
    const detail = await getGame(slug, activeLocale.value);
    game.value = detail;
    // The game slug is shared across locales, so the default locale swap is correct.
    applyHead({
      title: `${detail.seoTitle} — ${t('app.name')}`,
      locale: activeLocale.value,
      path: `${prefix.value}/games/${encodeURIComponent(detail.slug)}`,
      indexable: true,
      description: detail.seoDescription,
      ogType: 'website',
      image: detail.coverImageUrl
    });
    // Related lists are supporting detail: a failure leaves them empty rather than
    // turning the whole page into an error.
    const [tours, articles] = await Promise.allSettled([
      listTournaments({ locale: activeLocale.value, game: detail.id }),
      listContent({ locale: activeLocale.value, game: detail.id })
    ]);
    if (tours.status === 'fulfilled') tournaments.value = tours.value.items.slice(0, 6);
    if (articles.status === 'fulfilled') content.value = articles.value.items.slice(0, 6);
  } catch (caught) {
    game.value = null;
    if (caught instanceof ApiRequestError && caught.status === 404) notFound.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(activeLocale, () => load());
watch(() => route.params.slug, () => load());
</script>

<template>
  <StateBlock
    v-if="loading"
    variant="loading"
  />
  <StateBlock
    v-else-if="notFound"
    variant="notFound"
    data-testid="game-not-found"
  />

  <article
    v-else-if="game"
    class="detail"
  >
    <RouterLink
      class="btn btn-ghost back"
      :to="`${prefix}/games`"
    >‹ {{ t('nav.games') }}</RouterLink>

    <!-- Image-forward hero: cover fills the banner, title sits over a scrim. -->
    <header class="hero">
      <AppThumb
        class="hero-thumb"
        :src="game.coverImageUrl"
        :label="game.name"
        :ratio="21 / 9"
      />
      <div class="hero-scrim">
        <span class="badge badge-accent kind">{{ t('nav.games') }}</span>
        <h1>{{ game.name }}</h1>
      </div>
    </header>

    <p class="description">
      {{ game.description }}
    </p>

    <!-- Sanitised on the server at write time (CONTENT-005), so it renders directly. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div
      v-if="game.body"
      class="body"
      data-testid="game-body"
      v-html="game.body"
    />

    <section
      v-if="tournaments.length"
      class="related"
      data-testid="game-tournaments"
    >
      <div class="section-header">
        <h2>{{ t('games.detail.tournaments') }}</h2>
        <RouterLink
          class="see-all"
          :to="`${prefix}/tournaments?game=${encodeURIComponent(game.id)}`"
        >{{ t('home.viewAll') }}</RouterLink>
      </div>
      <ul class="cards reset-list">
        <li
          v-for="item in tournaments"
          :key="item.id"
        >
          <RouterLink
            class="card card-interactive tile"
            :to="`${prefix}/tournaments/${encodeURIComponent(item.slug)}`"
          >
            <h3 class="tile-title">{{ item.name }}</h3>
            <div class="tile-meta">
              <span class="badge badge-neutral">{{ t(`tournaments.feeKind.${item.feeKind}`) }}</span>
              <span class="numeric">{{ fmtDate(item.startAt) }}</span>
            </div>
          </RouterLink>
        </li>
      </ul>
    </section>

    <section
      v-if="content.length"
      class="related"
      data-testid="game-content"
    >
      <div class="section-header">
        <h2>{{ t('games.detail.content') }}</h2>
        <RouterLink
          class="see-all"
          :to="`${prefix}/content?game=${encodeURIComponent(game.id)}`"
        >{{ t('home.viewAll') }}</RouterLink>
      </div>
      <ul class="cards reset-list">
        <li
          v-for="item in content"
          :key="item.id"
        >
          <RouterLink
            class="card card-interactive tile"
            :to="`${prefix}/content/${encodeURIComponent(item.type)}/${encodeURIComponent(item.slug)}`"
          >
            <span class="badge badge-accent">{{ t(`content.type.${item.type}`) }}</span>
            <h3 class="tile-title">{{ item.title }}</h3>
            <p class="tile-summary">{{ item.summary }}</p>
          </RouterLink>
        </li>
      </ul>
    </section>
  </article>
</template>

<style scoped>
.detail {
  max-inline-size: 60rem;
  margin-inline: auto;
  margin-block: var(--space-5);
}

.back {
  margin-block-end: var(--space-4);
}

.hero {
  position: relative;
  overflow: hidden;
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
.hero-scrim h1 {
  margin-block: var(--space-2) 0;
  color: #ffffff;
}
[lang='fa'] .hero-scrim h1 {
  line-height: 1.4;
}
.kind {
  margin: 0;
}

.description {
  max-inline-size: 65ch;
  margin-block-start: var(--space-5);
  font-size: var(--text-lg);
  color: var(--color-text-soft);
}

/* ---- Editorial body ---- */
.body {
  max-inline-size: 70ch;
  margin-block-start: var(--space-5);
  line-height: var(--leading-normal);
}
.body :deep(h2) {
  font-size: var(--text-xl);
  margin-block: var(--space-6) var(--space-3);
}
.body :deep(h3) {
  font-size: var(--text-lg);
  margin-block: var(--space-5) var(--space-2);
}
.body :deep(p) {
  margin-block: 0 var(--space-4);
}
.body :deep(img) {
  max-inline-size: 100%;
  block-size: auto;
  border-radius: var(--radius-md);
}
.body :deep(blockquote) {
  margin-inline: 0;
  padding-inline-start: var(--space-4);
  border-inline-start: 3px solid var(--color-primary);
  color: var(--color-text-soft);
}
.body :deep(pre) {
  padding: var(--space-4);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-sunken);
  overflow-x: auto;
}
.body :deep(ul),
.body :deep(ol) {
  padding-inline-start: var(--space-5);
  margin-block: 0 var(--space-4);
}

/* ---- Related tournaments / content ---- */
.reset-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.related {
  margin-block-start: var(--space-7);
}
.section-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-block-end: var(--space-4);
}
.section-header h2 {
  margin: 0;
}
.see-all {
  display: inline-flex;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-text-soft);
  text-decoration: none;
}
.see-all:hover {
  color: var(--color-accent);
  border-color: var(--color-border-strong);
}
.cards {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
}
.tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  block-size: 100%;
  color: inherit;
  text-decoration: none;
}
.tile-title {
  margin: 0;
  font-size: var(--text-md);
  line-height: 1.3;
}
.tile:hover .tile-title {
  color: var(--color-accent);
}
.tile-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.tile-summary {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
