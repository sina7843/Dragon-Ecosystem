<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppThumb from '../components/AppThumb.vue';
import { listGames, listContent, type GameCard, type ContentCard } from '../composables/useContentApi.ts';
import { listTournaments, type TournamentCard } from '../composables/useTournamentsApi.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { applyHead } from '../head.ts';

const { t, locale } = useI18n();
const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);

type ApiStatus = 'checking' | 'online' | 'unavailable';
const apiStatus = ref<ApiStatus>('checking');
const tournaments = ref<TournamentCard[]>([]);
const games = ref<GameCard[]>([]);
const content = ref<ContentCard[]>([]);

const featured = computed(() => tournaments.value[0] ?? null);
const rail = computed(() => tournaments.value.slice(featured.value ? 1 : 0, 7));

function tStatus(card: TournamentCard): { key: string; tone: string } {
  const now = Date.now();
  const start = card.startAt ? Date.parse(card.startAt) : null;
  const end = card.endAt ? Date.parse(card.endAt) : null;
  if (start === null) return { key: 'statusUnscheduled', tone: 'neutral' };
  if (end !== null && now > end) return { key: 'statusFinished', tone: 'neutral' };
  if (now >= start && (end === null || now <= end)) return { key: 'statusLive', tone: 'success' };
  return { key: 'statusUpcoming', tone: 'accent' };
}

function fmtDate(value: string | null): string {
  if (value === null) return t('home.statusUnscheduled');
  return new Intl.DateTimeFormat(activeLocale.value === 'fa' ? 'fa-IR' : 'en-US', {
    month: 'short',
    day: 'numeric'
  }).format(new Date(value));
}

onMounted(async () => {
  // SEO: localized title + description + website Open Graph for the landing.
  applyHead({
    title: t('home.heading'),
    locale: activeLocale.value,
    path: `${prefix.value}`,
    indexable: true,
    description: t('home.intro'),
    ogType: 'website'
  });
  const loc = activeLocale.value;
  const settle = async <T,>(p: Promise<{ items: T[] }>, target: { value: T[] }, take: number) => {
    try {
      target.value = (await p).items.slice(0, take);
    } catch {
      /* graceful empty */
    }
  };
  await Promise.allSettled([
    (async () => {
      try {
        const response = await fetch('/api/v1/meta', { headers: { accept: 'application/json' } });
        apiStatus.value = response.ok ? 'online' : 'unavailable';
      } catch {
        apiStatus.value = 'unavailable';
      }
    })(),
    settle(listTournaments({ locale: loc }), tournaments, 8),
    settle(listGames({ locale: loc }), games, 8),
    settle(listContent({ locale: loc }), content, 6)
  ]);
});
</script>

<template>
  <div class="portal">
    <!-- Featured banner: the marquee tournament, image-forward. -->
    <section
      v-if="featured"
      class="feature"
    >
      <RouterLink
        class="feature-link"
        :to="`${prefix}/tournaments/${encodeURIComponent(featured.slug)}`"
      >
        <AppThumb
          class="feature-thumb"
          :src="null"
          :label="featured.name"
          :ratio="21 / 9"
        />
        <div class="feature-body">
          <span
            class="status-pill"
            :class="`status-pill-${tStatus(featured).tone}`"
          >{{ t(`home.${tStatus(featured).key}`) }}</span>
          <h1 class="feature-title">{{ featured.name }}</h1>
          <p class="feature-summary">{{ featured.summary }}</p>
          <div class="feature-meta">
            <span class="badge badge-neutral">{{ t(`tournaments.feeKind.${featured.feeKind}`) }}</span>
            <span class="meta-dot" aria-hidden="true" />
            <span class="numeric">{{ fmtDate(featured.startAt) }}</span>
            <span class="meta-dot" aria-hidden="true" />
            <span class="numeric">{{ featured.capacity }} {{ t('tournaments.field.capacity') }}</span>
          </div>
        </div>
      </RouterLink>
    </section>

    <!-- Fallback hero when no tournaments exist yet. -->
    <section
      v-else
      class="text-hero"
    >
      <h1>{{ t('home.heading') }}</h1>
      <p class="text-hero-lead">
        {{ t('home.intro') }}
      </p>
      <div class="hero-cta">
        <RouterLink
          class="btn btn-primary"
          :to="`${prefix}/tournaments`"
        >
          {{ t('home.ctaTournaments') }}
        </RouterLink>
        <RouterLink
          class="btn btn-neutral"
          :to="`${prefix}/games`"
        >
          {{ t('home.ctaGames') }}
        </RouterLink>
      </div>
    </section>

    <!-- Upcoming tournaments rail -->
    <section
      v-if="rail.length"
      class="rail-section"
    >
      <div class="section-header">
        <h2>{{ t('home.featuredTournaments') }}</h2>
        <RouterLink
          class="see-all"
          :to="`${prefix}/tournaments`"
        >{{ t('home.viewAll') }}</RouterLink>
      </div>
      <ul class="rail reset-list">
        <li
          v-for="item in rail"
          :key="item.id"
          class="rail-card"
        >
          <RouterLink
            class="tile"
            :to="`${prefix}/tournaments/${encodeURIComponent(item.slug)}`"
          >
            <div class="tile-thumb-wrap">
              <AppThumb
                :src="null"
                :label="item.name"
              />
              <span
                class="status-pill tile-status"
                :class="`status-pill-${tStatus(item).tone}`"
              >{{ t(`home.${tStatus(item).key}`) }}</span>
            </div>
            <h3 class="tile-title">{{ item.name }}</h3>
            <div class="tile-meta">
              <span class="badge badge-neutral">{{ t(`tournaments.feeKind.${item.feeKind}`) }}</span>
              <span class="numeric tile-date">{{ fmtDate(item.startAt) }}</span>
            </div>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- Latest content feed -->
    <section
      v-if="content.length"
      class="feed-section"
    >
      <div class="section-header">
        <h2>{{ t('home.recentContent') }}</h2>
        <RouterLink
          class="see-all"
          :to="`${prefix}/content`"
        >{{ t('home.viewAll') }}</RouterLink>
      </div>
      <ul class="feed reset-list">
        <li
          v-for="item in content"
          :key="item.id"
          class="feed-card"
        >
          <RouterLink
            class="tile"
            :to="`${prefix}/content/${encodeURIComponent(item.type)}/${encodeURIComponent(item.slug)}`"
          >
            <AppThumb
              :src="item.coverImageUrl"
              :label="item.title"
            />
            <span class="badge badge-accent feed-type">{{ item.type }}</span>
            <h3 class="tile-title">{{ item.title }}</h3>
            <p class="tile-summary">{{ item.summary }}</p>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- Games grid -->
    <section
      v-if="games.length"
      class="games-section"
    >
      <div class="section-header">
        <h2>{{ t('home.featuredGames') }}</h2>
        <RouterLink
          class="see-all"
          :to="`${prefix}/games`"
        >{{ t('home.viewAll') }}</RouterLink>
      </div>
      <ul class="games reset-list">
        <li
          v-for="game in games"
          :key="game.id"
          class="game-card"
        >
          <RouterLink
            class="tile"
            :to="`${prefix}/games/${encodeURIComponent(game.slug)}`"
          >
            <AppThumb
              :src="game.coverImageUrl"
              :label="game.name"
              :ratio="4 / 3"
            />
            <h3 class="game-name">{{ game.name }}</h3>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- Closing CTA -->
    <section class="cta-band">
      <div class="cta-inner">
        <div>
          <h2 class="cta-heading">
            {{ t('home.ctaHeading') }}
          </h2>
          <p class="cta-body">
            {{ t('home.ctaBody') }}
          </p>
        </div>
        <div class="cta-actions">
          <RouterLink
            class="btn btn-primary"
            :to="`${prefix}/auth/mobile`"
          >
            {{ t('nav.signIn') }}
          </RouterLink>
          <RouterLink
            class="btn btn-neutral"
            :to="`${prefix}/tournaments`"
          >
            {{ t('home.ctaTournaments') }}
          </RouterLink>
        </div>
      </div>
    </section>

    <p class="status-line">
      <span
        class="status-dot"
        :data-state="apiStatus"
        aria-hidden="true"
      />
      <span>{{ t('home.apiLabel') }}:</span>
      <span
        data-testid="api-status"
        :data-state="apiStatus"
      >{{ apiStatus === 'online' ? t('home.statusOnline') : apiStatus === 'unavailable' ? t('home.apiUnavailable') : '…' }}</span>
      <span
        class="status-sep"
        aria-hidden="true"
      >·</span>
      <span>{{ t('home.localeLabel') }}:</span>
      <span data-testid="active-locale">{{ t(`locale.name.${locale}`) }}</span>
    </p>
  </div>
</template>

<style scoped>
.portal {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}
.reset-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* ---- Featured banner ---- */
/* Hero container: glass over the ambient field, at the design's largest radius. */
.feature {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  background-color: var(--color-surface);
  box-shadow: var(--shadow-md);
}
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .feature {
    background-color: var(--glass-bg);
    border-color: var(--glass-border);
    -webkit-backdrop-filter: blur(var(--glass-blur));
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--glass-highlight), var(--shadow-lg);
  }
}
.feature-link {
  display: block;
  position: relative;
  color: inherit;
  text-decoration: none;
}
.feature-thumb {
  border-radius: 0;
}
.feature-body {
  position: absolute;
  inset-block-end: 0;
  inset-inline: 0;
  padding: var(--space-6);
  background: var(--gradient-hero);
}
.feature-title {
  margin: var(--space-2) 0;
  font-size: var(--text-4xl);
  line-height: 1.05;
  letter-spacing: var(--tracking-tight);
  color: #ffffff;
}
[lang='fa'] .feature-title {
  line-height: 1.25;
  letter-spacing: normal;
}
.feature-summary {
  margin: 0 0 var(--space-3);
  max-inline-size: 60ch;
  color: rgb(255 255 255 / 82%);
}
.feature-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  color: rgb(255 255 255 / 88%);
  font-size: var(--text-sm);
}
.meta-dot {
  inline-size: 0.25rem;
  block-size: 0.25rem;
  border-radius: var(--radius-full);
  background-color: currentColor;
  opacity: 0.6;
}

/* ---- Text hero fallback ---- */
.text-hero {
  padding-block: var(--space-7) var(--space-6);
}
.text-hero h1 {
  font-size: var(--text-4xl);
  letter-spacing: var(--tracking-tight);
  max-inline-size: 16ch;
  margin-block-end: var(--space-4);
}
[lang='fa'] .text-hero h1 {
  letter-spacing: normal;
}
.text-hero-lead {
  font-size: var(--text-lg);
  color: var(--color-text-muted);
  max-inline-size: 46ch;
  margin-block-end: var(--space-5);
}
.hero-cta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* ---- Section headers ---- */
/* The design leads each section with a plain heading and a quiet outlined
   "view all" action — no rules, no uppercasing (which Persian cannot render). */
.section-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-block-end: var(--space-5);
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

/* ---- Shared tile ---- */
.tile {
  display: flex;
  flex-direction: column;
  block-size: 100%;
  color: inherit;
  text-decoration: none;
}
.tile-title {
  margin: var(--space-2) 0 0;
  font-size: var(--text-md);
  line-height: 1.3;
}
.tile:hover .tile-title {
  color: var(--color-accent);
}
.tile-summary {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ---- Tournament rail (horizontal scroll) ---- */
.rail {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(15rem, 1fr);
  gap: var(--space-4);
  overflow-x: auto;
  padding-block-end: var(--space-2);
  scroll-snap-type: x proximity;
}
.rail-card {
  scroll-snap-align: start;
}
.tile-thumb-wrap {
  position: relative;
}
.tile-status {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-start: var(--space-2);
  font-size: var(--text-xs);
}
.tile-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-block-start: var(--space-2);
}
.tile-date {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

/* ---- Content feed grid ---- */
.feed {
  display: grid;
  gap: var(--space-5) var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
}
.feed-type {
  align-self: flex-start;
  margin-block-start: var(--space-2);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  font-size: 0.6875rem;
}
[lang='fa'] .feed-type {
  text-transform: none;
  letter-spacing: normal;
}

/* ---- Games grid ---- */
.games {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 11rem), 1fr));
}
.game-name {
  margin: var(--space-2) 0 0;
  font-size: var(--text-md);
}
.game-card .tile:hover .game-name {
  color: var(--color-accent);
}

/* ---- CTA band ---- */
.cta-band {
  position: relative;
  overflow: hidden;
  padding: clamp(var(--space-5), 3vw, var(--space-7));
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-xl);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-sm);
}
/* Lit leading edge — the design's closing-band signature. */
.cta-band::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: 3px;
  background-color: var(--color-primary);
}
.cta-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4) var(--space-6);
}
.cta-heading {
  margin: 0 0 var(--space-1);
  font-size: var(--text-xl);
}
.cta-body {
  margin: 0;
  color: var(--color-text-muted);
}
.cta-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* Quiet status line */
.status-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.status-dot {
  inline-size: 0.5rem;
  block-size: 0.5rem;
  border-radius: var(--radius-full);
  background-color: var(--color-border-strong);
}
.status-dot[data-state='online'] {
  background-color: var(--color-success-text);
}
.status-dot[data-state='unavailable'] {
  background-color: var(--color-danger);
}
.status-sep {
  color: var(--color-border-strong);
}

@media (max-width: 640px) {
  .feature-title {
    font-size: var(--text-2xl);
  }
  .feature-body {
    padding: var(--space-4);
  }
}
</style>
