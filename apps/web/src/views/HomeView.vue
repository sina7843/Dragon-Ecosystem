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

// Auto-scrolling marquee needs enough cards to fill and loop seamlessly; below that
// it stays a plain scroll rail. The list is doubled so a -50% translate loops with
// no seam; the second copy is decorative (aria-hidden, not focusable).
const useMarquee = computed(() => rail.value.length >= 3);
const railEntries = computed(() => {
  const base = rail.value.map((item) => ({ item, clone: false, key: item.id }));
  if (!useMarquee.value) return base;
  return [...base, ...rail.value.map((item) => ({ item, clone: true, key: `${item.id}-c` }))];
});

function tStatus(card: TournamentCard): { key: string; tone: string } {
  const now = Date.now();
  const start = card.startAt ? Date.parse(card.startAt) : null;
  const end = card.endAt ? Date.parse(card.endAt) : null;
  if (start === null) return { key: 'statusUnscheduled', tone: 'neutral' };
  if (end !== null && now > end) return { key: 'statusFinished', tone: 'neutral' };
  if (now >= start && (end === null || now <= end)) return { key: 'statusLive', tone: 'success' };
  return { key: 'statusUpcoming', tone: 'accent' };
}

// The API's format vocabulary; anything outside it would render as a raw i18n key.
const KNOWN_FORMATS = new Set(['single_elimination', 'double_elimination', 'round_robin', 'swiss', 'custom']);
function tFormat(card: TournamentCard): string {
  return KNOWN_FORMATS.has(card.format)
    ? t(`tournaments.format.${card.format}`)
    : t('home.heroKicker');
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
    <!-- Featured banner: the marquee tournament, image-forward.

         The page keeps its own <h1> even when the banner is showing. The banner's title
         is the tournament, not the page, so promoting it to <h1> made the top-level
         heading change with the data and left the site heading absent entirely. The h1
         stays visually hidden here so the image-forward design is unchanged. -->
    <h1
      v-if="featured"
      class="visually-hidden"
    >
      {{ t('home.heading') }}
    </h1>
    <section
      v-if="featured"
      class="feature"
    >
      <div class="feature-art">
        <AppThumb
          class="feature-thumb"
          :src="featured.coverImageUrl"
          :label="featured.name"
          :ratio="21 / 9"
        />

        <span
          class="status-pill feature-status"
          :class="`status-pill-${tStatus(featured).tone}`"
        >{{ t(`home.${tStatus(featured).key}`) }}</span>

        <!-- The bracket seam, drawn at full scale: an eight-entrant ladder
             converging on a single lit node. Decorative — the tournament's real
             state is in the status pill and the readout below. -->
        <svg
          class="bracket"
          viewBox="0 0 200 220"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <g
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path d="M8 12h52M8 40h52M8 68h52M8 96h52M8 124h52M8 152h52M8 180h52M8 208h52" />
            <path d="M60 12v28M60 68v28M60 124v28M60 180v28" />
            <path d="M60 26h58M60 82h58M60 138h58M60 194h58" />
            <path d="M118 26v56M118 138v56" />
            <path d="M118 54h58M118 166h58" />
            <path d="M176 54v112" />
            <path d="M176 110h16" />
          </g>
          <circle
            class="bracket-node"
            cx="194"
            cy="110"
            r="5"
            fill="currentColor"
          />
        </svg>

      </div>

      <!-- The banner is not one giant link: a screen reader would have to hear
           the whole summary as link text. The title and the action are the two
           targets, and both go to the same place. -->
      <div class="feature-body">
        <!-- The eyebrow names the format, not the platform: how the bracket
             runs is the first thing an entrant needs to know. -->
        <p class="eyebrow feature-eyebrow">
          {{ tFormat(featured) }}
        </p>
        <h2 class="feature-title">
          <RouterLink
            class="feature-link"
            :to="`${prefix}/tournaments/${encodeURIComponent(featured.slug)}`"
          >{{ featured.name }}</RouterLink>
        </h2>
        <p class="feature-summary">{{ featured.summary }}</p>
        <div class="feature-foot">
          <dl class="readout">
            <div class="readout-cell">
              <dt>{{ t('tournaments.field.feeKind') }}</dt>
              <dd>{{ t(`tournaments.feeKind.${featured.feeKind}`) }}</dd>
            </div>
            <div class="readout-cell">
              <dt>{{ t('tournaments.field.startAt') }}</dt>
              <dd class="numeric">{{ fmtDate(featured.startAt) }}</dd>
            </div>
            <div class="readout-cell">
              <dt>{{ t('tournaments.field.capacity') }}</dt>
              <dd class="numeric">{{ featured.capacity }}</dd>
            </div>
          </dl>
          <RouterLink
            class="btn btn-primary"
            :to="`${prefix}/tournaments/${encodeURIComponent(featured.slug)}`"
          >
            {{ t('home.ctaFeatured') }}
          </RouterLink>
        </div>
      </div>
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

    <!-- Featured tournaments: an auto-scrolling marquee (pauses on hover / focus). -->
    <section
      v-if="rail.length"
      v-reveal
      class="rail-section"
    >
      <div class="section-header">
        <h2>{{ t('home.featuredTournaments') }}</h2>
        <RouterLink
          class="see-all"
          :to="`${prefix}/tournaments`"
        >{{ t('home.viewAll') }}</RouterLink>
      </div>
      <div
        :class="['rail-wrap', { marquee: useMarquee }]"
        role="group"
        :aria-label="t('home.featuredTournaments')"
      >
        <ul :class="['reset-list', useMarquee ? 'marquee-track' : 'rail']">
          <li
            v-for="entry in railEntries"
            :key="entry.key"
            class="rail-card"
            :aria-hidden="entry.clone || undefined"
          >
            <RouterLink
              class="tile"
              :to="`${prefix}/tournaments/${encodeURIComponent(entry.item.slug)}`"
              :tabindex="entry.clone ? -1 : undefined"
            >
              <div class="tile-thumb-wrap">
                <AppThumb
                  :src="entry.item.coverImageUrl"
                  :label="entry.item.name"
                />
                <span
                  class="status-pill tile-status"
                  :class="`status-pill-${tStatus(entry.item).tone}`"
                >{{ t(`home.${tStatus(entry.item).key}`) }}</span>
              </div>
              <h3 class="tile-title">{{ entry.item.name }}</h3>
              <div class="tile-meta">
                <span class="badge badge-neutral">{{ t(`tournaments.feeKind.${entry.item.feeKind}`) }}</span>
                <span class="numeric tile-date">{{ fmtDate(entry.item.startAt) }}</span>
              </div>
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>

    <!-- Latest content feed -->
    <section
      v-if="content.length"
      v-reveal
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
      v-reveal
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
            <!-- Same 21/9 as the games catalogue and the game page. -->
            <AppThumb
              :src="game.coverImageUrl"
              :label="game.name"
              :ratio="21 / 9"
            />
            <h3 class="game-name">{{ game.name }}</h3>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- Partners and supporters live in the footer on every page, so the landing
         no longer repeats the same strip two screens above it. -->

    <!-- Closing CTA -->
    <section
      v-reveal
      class="cta-band"
    >
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

/* ---- Featured banner ----
   The hero is the deepest plate on the site: a chamfered lapis frame around the
   marquee tournament, with the bracket ladder converging over the artwork. */
.feature {
  --hud-cut: var(--hud-cut-xl);
  position: relative;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  clip-path: polygon(
    0 0,
    100% 0,
    100% calc(100% - var(--hud-cut)),
    calc(100% - var(--hud-cut)) 100%,
    var(--hud-cut) 100%,
    0 calc(100% - var(--hud-cut))
  );
  background-color: var(--color-surface-raised);
  box-shadow: var(--shadow-lg);
}
.feature-art {
  position: relative;
}
.feature-link {
  color: inherit;
  text-decoration: none;
}
.feature-link:hover {
  color: var(--color-primary-bright);
}
.feature-thumb {
  border-radius: 0;
}

/* Live/upcoming tag rides the artwork, the way a broadcast bug does. */
.feature-status {
  position: absolute;
  inset-block-start: var(--space-4);
  inset-inline-start: var(--space-4);
  z-index: 2;
  /* Opaque, so the tone stays legible over whatever the cover art is doing. */
  background-color: var(--color-surface);
}

/* ---- The bracket: an eight-entrant ladder resolving to one node ---- */
.bracket {
  position: absolute;
  inset-block-start: 8%;
  inset-inline-end: clamp(var(--space-5), 5vw, var(--space-8));
  z-index: 1;
  inline-size: clamp(9rem, 15vw, 14rem);
  block-size: auto;
  color: var(--color-accent);
  opacity: 0.55;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 22%, #000 100%);
  mask-image: linear-gradient(to bottom, transparent, #000 22%, #000 100%);
}
/* RTL mirrors the ladder so it still converges toward the reading edge. */
[dir='rtl'] .bracket {
  transform: scaleX(-1);
}
/* The champion node is the only thing on the page that pulses. */
.bracket-node {
  animation: node-pulse 2.6s var(--motion-ease) infinite;
}
@keyframes node-pulse {
  0%,
  100% {
    r: 4;
    opacity: 0.7;
  }
  50% {
    r: 6.5;
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bracket-node {
    animation: none;
  }
}

.feature-body {
  position: absolute;
  inset-block-end: 0;
  inset-inline: 0;
  z-index: 2;
  padding: clamp(var(--space-4), 3vw, var(--space-7));
  background: var(--gradient-hero);
}
.feature-eyebrow {
  margin: 0;
  color: var(--color-primary-bright);
}
.feature-title {
  margin: var(--space-2) 0 var(--space-3);
  font-size: clamp(1.75rem, 6vw, 3.75rem);
  line-height: 0.98;
  letter-spacing: -0.02em;
  color: #ffffff;
}
[lang='fa'] .feature-title {
  line-height: 1.25;
  letter-spacing: normal;
}
.feature-summary {
  margin: 0 0 var(--space-4);
  max-inline-size: 52ch;
  color: rgb(255 255 255 / 82%);
}

/* ---- HUD readout strip: the three facts that decide whether you enter ---- */
.feature-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4) var(--space-5);
  padding-block-start: var(--space-4);
  border-block-start: 1px solid rgb(255 255 255 / 18%);
}
.readout {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
  margin: 0;
}
.readout-cell dt {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: rgb(255 255 255 / 62%);
}
[lang='fa'] .readout-cell dt {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  letter-spacing: normal;
  text-transform: none;
}
.readout-cell dd {
  margin: var(--space-1) 0 0;
  font-family: var(--font-display);
  font-variation-settings: 'wdth' var(--display-width);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  text-align: start;
  color: #ffffff;
}
[lang='fa'] .readout-cell dd {
  font-family: var(--font-sans);
  font-variation-settings: normal;
}

/* ---- Text hero fallback ---- */
.text-hero {
  padding-block: var(--space-7) var(--space-6);
}
.text-hero h1 {
  font-size: clamp(2.25rem, 7vw, 3.75rem);
  line-height: 0.98;
  letter-spacing: -0.02em;
  max-inline-size: 16ch;
  margin-block-end: var(--space-4);
}
[lang='fa'] .text-hero h1 {
  line-height: 1.25;
  letter-spacing: normal;
}
.text-hero-lead {
  font-size: var(--text-lg);
  color: var(--color-text-soft);
  max-inline-size: 46ch;
  margin-block-end: var(--space-5);
}
.hero-cta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* Section headers come from components.css, seam and all; only the trailing
   "view all" action is local. It reads as a HUD affordance: mono, tracked, with
   a chevron that steps outward on hover. */
.section-header {
  margin-block-end: var(--space-5);
}
.see-all {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--color-text-soft);
  text-decoration: none;
  transition:
    color var(--motion-fast) var(--motion-ease),
    border-color var(--motion-fast) var(--motion-ease);
}
[lang='fa'] .see-all {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  letter-spacing: normal;
  text-transform: none;
}
.see-all::after {
  content: '';
  inline-size: 0.45rem;
  block-size: 0.45rem;
  /* Physical edges on purpose: the arrow is rotated per direction below, so a
     logical border would flip the shape twice and point the wrong way. */
  border-top: 2px solid currentColor;
  border-right: 2px solid currentColor;
  transform: rotate(45deg);
  transition: transform var(--motion-fast) var(--motion-ease);
}
[dir='rtl'] .see-all::after {
  transform: rotate(-135deg);
}
.see-all:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}
.see-all:hover::after {
  transform: rotate(45deg) translate(2px, -2px);
}
[dir='rtl'] .see-all:hover::after {
  transform: rotate(-135deg) translate(2px, -2px);
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
  font-family: var(--font-display);
  font-variation-settings: 'wdth' var(--display-width);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  line-height: 1.15;
  transition: color var(--motion-fast) var(--motion-ease);
}
[lang='fa'] .tile-title {
  font-family: var(--font-sans);
  font-variation-settings: normal;
  font-size: var(--text-md);
  line-height: 1.5;
}
.tile:hover .tile-title {
  color: var(--color-accent);
}
/* The artwork lifts toward the viewer on hover; the plate itself stays put. */
.tile :deep(.thumb) {
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  transition: border-color var(--motion-base) var(--motion-ease);
}
.tile:hover :deep(.thumb) {
  border-color: var(--color-accent);
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

/* ---- Tournament rail (horizontal scroll fallback) ---- */
.rail {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(15rem, 1fr);
  gap: var(--space-4);
  overflow-x: auto;
  padding-block-end: var(--space-2);
  scroll-snap-type: x proximity;
}
.rail .rail-card {
  scroll-snap-align: start;
}

/* ---- Featured marquee (auto-scroll) ---- */
.rail-wrap.marquee {
  overflow: hidden;
  /* Fade the two edges so cards enter and leave softly. */
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent);
}
.marquee-track {
  display: flex;
  inline-size: max-content;
  gap: var(--space-4);
  padding-block-end: var(--space-2);
  /* Travel follows the writing direction: negative in LTR, positive in RTL, where the
     track is laid out from the right edge. Flipping the sign keeps the loop seamless
     in both directions instead of scrolling away from the reading flow. */
  --marquee-end: -50%;
  animation: rail-marquee 45s linear infinite;
  will-change: transform;
}
[dir='rtl'] .marquee-track {
  --marquee-end: 50%;
}
/* Pause when a viewer hovers or tabs into the strip, so they can read/click. */
.rail-wrap.marquee:hover .marquee-track,
.rail-wrap.marquee:focus-within .marquee-track {
  animation-play-state: paused;
}
.marquee-track .rail-card {
  flex: 0 0 16rem;
}
@keyframes rail-marquee {
  to {
    /* One full copy of the list; the doubled second copy makes it seamless. */
    transform: translateX(var(--marquee-end));
  }
}
@media (prefers-reduced-motion: reduce) {
  .marquee-track {
    animation: none;
  }
  /* Fall back to a manual horizontal scroll when motion is reduced. */
  .rail-wrap.marquee {
    overflow-x: auto;
    -webkit-mask-image: none;
    mask-image: none;
  }
}
.tile-thumb-wrap {
  position: relative;
}
.tile-status {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-start: var(--space-2);
  font-size: var(--text-xs);
  background-color: var(--color-surface);
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
/* Auto-fill drops to a single column on a phone, which wastes the whole width on
   one cover; pin two instead. */
@media (max-width: 560px) {
  .games {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.game-name {
  margin: var(--space-2) 0 0;
  font-family: var(--font-display);
  font-variation-settings: 'wdth' var(--display-width);
  font-size: var(--text-md);
  font-weight: var(--weight-bold);
  transition: color var(--motion-fast) var(--motion-ease);
}
[lang='fa'] .game-name {
  font-family: var(--font-sans);
  font-variation-settings: normal;
}
.game-card .tile:hover .game-name {
  color: var(--color-accent);
}

/* ---- Closing band ----
   The final plate closes the bracket: the same chamfer, the seam capping its top
   edge, and the ember gradient reserved for this one moment on the page. */
.cta-band {
  --hud-cut: var(--hud-cut-lg);
  position: relative;
  padding: clamp(var(--space-5), 3vw, var(--space-7));
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  clip-path: polygon(
    0 0,
    100% 0,
    100% calc(100% - var(--hud-cut)),
    calc(100% - var(--hud-cut)) 100%,
    var(--hud-cut) 100%,
    0 calc(100% - var(--hud-cut))
  );
  background-color: var(--color-surface-raised);
  box-shadow: var(--glass-highlight), var(--shadow-md);
}
.cta-band::before {
  content: '';
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  block-size: 3px;
  background: var(--gradient-brand);
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
  font-size: clamp(1.5rem, 3vw, 2.125rem);
}
.cta-body {
  margin: 0;
  color: var(--color-text-soft);
}
.cta-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* Platform telemetry, set as a monospaced readout rather than a sentence. */
.status-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--color-text-muted);
}
[lang='fa'] .status-line {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  letter-spacing: normal;
  text-transform: none;
}
.status-dot {
  inline-size: 0.4rem;
  block-size: 0.75rem;
  background-color: var(--color-border-strong);
}
.status-dot[data-state='online'] {
  background-color: var(--color-success-text);
}
.status-dot[data-state='unavailable'] {
  background-color: var(--color-danger-text);
}
.status-sep {
  color: var(--color-border-strong);
}

/* Narrow screens stop overlaying the copy on the artwork — with the readout and
   the action in it, the panel is taller than the 21/9 image it would sit on. */
@media (max-width: 767px) {
  .feature-body {
    position: static;
    background: var(--color-surface-raised);
    border-block-start: 1px solid var(--color-border);
  }
  .feature-title,
  .readout-cell dd {
    color: var(--color-text);
  }
  .feature-summary {
    color: var(--color-text-soft);
  }
  .feature-foot {
    border-block-start-color: var(--color-border);
  }
  .readout-cell dt {
    color: var(--color-text-muted);
  }
  /* The ladder needs room to read; below this it would sit under the copy. */
  .bracket {
    display: none;
  }
  .readout {
    gap: var(--space-4);
  }
}
</style>
