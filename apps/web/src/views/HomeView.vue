<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { listGames, listContent, type GameCard, type ContentCard } from '../composables/useContentApi.ts';
import { listTournaments, type TournamentCard } from '../composables/useTournamentsApi.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

type ApiStatus = 'checking' | 'online' | 'unavailable';

const { t, locale } = useI18n();
const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);

const apiStatus = ref<ApiStatus>('checking');
const tournaments = ref<TournamentCard[]>([]);
const games = ref<GameCard[]>([]);
const content = ref<ContentCard[]>([]);
const loaded = ref(false);

// Product pillars render with zero data, so the landing is a real page even before
// anything is published. Each links into the relevant funnel.
const pillars = computed(() => [
  { title: t('home.pillarCompeteTitle'), body: t('home.pillarCompeteBody'), to: `${prefix.value}/tournaments` },
  { title: t('home.pillarTeamTitle'), body: t('home.pillarTeamBody'), to: `${prefix.value}/account/teams` },
  { title: t('home.pillarWalletTitle'), body: t('home.pillarWalletBody'), to: `${prefix.value}/account/wallet` }
]);

// Time-based status derived from the card's own dates — no invented backend state.
function tournamentStatus(card: TournamentCard): { key: string; tone: string } {
  const now = Date.now();
  const start = card.startAt ? Date.parse(card.startAt) : null;
  const end = card.endAt ? Date.parse(card.endAt) : null;
  if (start === null) return { key: 'statusUnscheduled', tone: 'neutral' };
  if (end !== null && now > end) return { key: 'statusFinished', tone: 'neutral' };
  if (now >= start && (end === null || now <= end)) return { key: 'statusLive', tone: 'success' };
  return { key: 'statusUpcoming', tone: 'accent' };
}

function formatDate(value: string | null): string {
  if (value === null) return t('home.statusUnscheduled');
  return new Intl.DateTimeFormat(activeLocale.value === 'fa' ? 'fa-IR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(new Date(value));
}

// Each section fails independently: a slow or failed section never blanks the page.
onMounted(async () => {
  const loc = activeLocale.value;
  const settle = async <T,>(p: Promise<{ items: T[] }>, target: { value: T[] }, take: number) => {
    try {
      target.value = (await p).items.slice(0, take);
    } catch {
      /* leave section empty; a graceful placeholder renders in its place */
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
    settle(listTournaments({ locale: loc }), tournaments, 6),
    settle(listGames({ locale: loc }), games, 6),
    settle(listContent({ locale: loc }), content, 4)
  ]);
  loaded.value = true;
});
</script>

<template>
  <div class="home">
    <section class="hero">
      <h1>{{ t('home.heading') }}</h1>
      <p class="hero-lead">
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
          class="btn btn-ghost"
          :to="`${prefix}/games`"
        >
          {{ t('home.ctaGames') }}
        </RouterLink>
      </div>
    </section>

    <!-- Product pillars: always render, so the page has substance without data. -->
    <section
      class="block pillars"
      aria-labelledby="pillars-heading"
    >
      <h2
        id="pillars-heading"
        class="block-title"
      >
        {{ t('home.pillarsHeading') }}
      </h2>
      <ul class="pillar-list reset-list">
        <li
          v-for="pillar in pillars"
          :key="pillar.to"
          class="pillar"
        >
          <RouterLink
            class="pillar-link"
            :to="pillar.to"
          >
            <h3 class="pillar-title">
              {{ pillar.title }}
            </h3>
            <p class="pillar-body">
              {{ pillar.body }}
            </p>
            <span
              class="pillar-arrow"
              aria-hidden="true"
            >&rarr;</span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <section class="block">
      <div class="section-header">
        <h2>{{ t('home.featuredTournaments') }}</h2>
        <RouterLink
          class="btn btn-ghost"
          :to="`${prefix}/tournaments`"
        >
          {{ t('home.viewAll') }}
        </RouterLink>
      </div>
      <ul
        v-if="tournaments.length"
        class="card-grid reset-list"
      >
        <li
          v-for="item in tournaments"
          :key="item.id"
          class="card card-interactive t-card"
        >
          <RouterLink
            class="card-link"
            :to="`${prefix}/tournaments/${encodeURIComponent(item.slug)}`"
          >
            <span
              class="status-pill"
              :class="`status-pill-${tournamentStatus(item).tone}`"
            >{{ t(`home.${tournamentStatus(item).key}`) }}</span>
            <h3 class="card-title">
              {{ item.name }}
            </h3>
            <p class="card-meta">
              {{ item.summary }}
            </p>
            <div class="t-meta">
              <span class="badge badge-neutral">{{ t(`tournaments.feeKind.${item.feeKind}`) }}</span>
              <span class="numeric t-date">{{ formatDate(item.startAt) }}</span>
            </div>
          </RouterLink>
        </li>
      </ul>
      <p
        v-else
        class="section-empty"
      >
        {{ t('home.featuredEmpty') }}
      </p>
    </section>

    <section class="block">
      <div class="section-header">
        <h2>{{ t('home.featuredGames') }}</h2>
        <RouterLink
          class="btn btn-ghost"
          :to="`${prefix}/games`"
        >
          {{ t('home.viewAll') }}
        </RouterLink>
      </div>
      <ul
        v-if="games.length"
        class="card-grid reset-list"
      >
        <li
          v-for="game in games"
          :key="game.id"
          class="card card-interactive"
        >
          <RouterLink
            class="card-link"
            :to="`${prefix}/games/${encodeURIComponent(game.slug)}`"
          >
            <h3 class="card-title">
              {{ game.name }}
            </h3>
            <p class="card-meta">
              {{ game.description }}
            </p>
          </RouterLink>
        </li>
      </ul>
      <p
        v-else
        class="section-empty"
      >
        {{ t('home.featuredEmpty') }}
      </p>
    </section>

    <section
      v-if="content.length"
      class="block"
    >
      <div class="section-header">
        <h2>{{ t('home.recentContent') }}</h2>
        <RouterLink
          class="btn btn-ghost"
          :to="`${prefix}/content`"
        >
          {{ t('home.viewAll') }}
        </RouterLink>
      </div>
      <ul class="card-grid reset-list">
        <li
          v-for="item in content"
          :key="item.id"
          class="card card-interactive"
        >
          <RouterLink
            class="card-link"
            :to="`${prefix}/content/${encodeURIComponent(item.type)}/${encodeURIComponent(item.slug)}`"
          >
            <h3 class="card-title">
              {{ item.title }}
            </h3>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- Closing call to action: always present, drives sign-up. -->
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

    <!-- Quiet developer/status line: no alarming error block on the landing. -->
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
.home {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.reset-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* Hero */
.hero {
  padding-block: var(--space-8) var(--space-7);
}
.hero h1 {
  font-size: var(--text-5xl);
  line-height: 1.02;
  letter-spacing: var(--tracking-tight);
  max-inline-size: 12ch;
  margin-block-end: var(--space-5);
}
[lang='fa'] .hero h1 {
  line-height: 1.25;
  letter-spacing: normal;
}
.hero-lead {
  font-size: var(--text-lg);
  color: var(--color-text-muted);
  max-inline-size: 42ch;
  margin-block-end: var(--space-6);
}
.hero-cta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* Sections split by hairlines, not cards */
.block {
  padding-block-start: var(--space-6);
  border-block-start: 1px solid var(--color-border);
}
.block-title {
  margin-block-end: var(--space-5);
}

/* Pillars: editorial hairline rows (not three boxed cards) */
.pillar-list {
  display: grid;
  gap: 0;
}
.pillar + .pillar {
  border-block-start: 1px solid var(--color-border);
}
.pillar-link {
  display: grid;
  grid-template-columns: minmax(8rem, 14rem) 1fr auto;
  align-items: baseline;
  gap: var(--space-3) var(--space-6);
  padding-block: var(--space-5);
  color: inherit;
  text-decoration: none;
}
.pillar-title {
  margin: 0;
  font-size: var(--text-xl);
  letter-spacing: var(--tracking-tight);
}
.pillar-body {
  margin: 0;
  color: var(--color-text-muted);
  max-inline-size: 48ch;
}
.pillar-arrow {
  color: var(--color-text-muted);
  transition: transform var(--motion-fast) var(--motion-ease), color var(--motion-fast) var(--motion-ease);
}
.pillar-link:hover .pillar-title {
  color: var(--color-accent);
}
.pillar-link:hover .pillar-arrow {
  color: var(--color-accent);
  transform: translateX(0.25rem);
}
[dir='rtl'] .pillar-arrow {
  transform: scaleX(-1);
}
[dir='rtl'] .pillar-link:hover .pillar-arrow {
  transform: scaleX(-1) translateX(0.25rem);
}

.section-empty {
  margin: 0;
  padding-block: var(--space-6);
  color: var(--color-text-muted);
}

.t-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-block-start: auto;
  padding-block-start: var(--space-3);
}
.t-date {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

/* Closing CTA band */
.cta-band {
  padding: var(--space-7) var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface-sunken);
}
.cta-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4) var(--space-6);
}
.cta-heading {
  margin: 0 0 var(--space-2);
  font-size: var(--text-2xl);
  letter-spacing: var(--tracking-tight);
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
  background-color: var(--color-accent);
}
.status-dot[data-state='unavailable'] {
  background-color: var(--color-danger);
}
.status-sep {
  color: var(--color-border-strong);
}

@media (max-width: 640px) {
  .hero {
    max-inline-size: none;
  }
  .hero h1 {
    font-size: var(--text-4xl);
  }
  .pillar-link {
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }
  .pillar-arrow {
    display: none;
  }
}
</style>
