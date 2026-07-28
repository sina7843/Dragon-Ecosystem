<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AppThumb from '../components/AppThumb.vue';
import ChatPanel from '../components/ChatPanel.vue';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { applyHead } from '../head.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { getStream, requestPlaybackAccess, type PlaybackGrant, type PublicStreamState, type StreamCard } from '../composables/useStreamsApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useAuth } from '../composables/useAuth.ts';

/**
 * Stream watch page (PAGE-028).
 *
 * The play control never decides anything: it asks the server, and the server checks the
 * stream's access mode, lifecycle state, rights, and provider health before it returns any
 * playable data (STREAM-006, BR-023). Every refusal below is rendered from the server's
 * own answer, so hiding the control is presentation, not authorization.
 *
 * Live chat sits beside the player in its own panel; it inherits this stream's access
 * decision from the server rather than making one here (CHAT-001).
 */

const { t, locale } = useI18n();
const route = useRoute();
const { messageFor } = useApiErrors();
const { authenticated, loaded, refresh } = useAuth();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);

const loading = ref(true);
const notFound = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const stream = ref<StreamCard | null>(null);

const grant = ref<PlaybackGrant | null>(null);
const requesting = ref(false);
/** Why the server refused playback, in the viewer's language. */
const playbackProblem = ref<{ kind: 'sign_in' | 'not_playing' | 'unavailable' | 'other'; message: string } | null>(null);

const TONES: Readonly<Record<PublicStreamState, string>> = {
  live: 'success',
  scheduled: 'accent',
  ended: 'neutral',
  archived: 'neutral',
  cancelled: 'danger',
  failed: 'warning'
};

function applySeo(detail: StreamCard): void {
  applyHead({
    title: `${detail.title} — ${t('app.name')}`,
    locale: activeLocale(),
    path: `${prefix.value}/streams/${encodeURIComponent(detail.slug)}`,
    indexable: true,
    description: detail.summary
  });
}

onMounted(async () => {
  try {
    stream.value = await getStream(String(route.params['slug']), activeLocale());
    applySeo(stream.value);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound.value = true;
    else errorMessage.value = messageFor(error);
    return;
  } finally {
    loading.value = false;
  }
  if (!loaded.value) await refresh();
});

/**
 * Asks for playback. The status code carries the reason, so each refusal gets the copy
 * that tells the viewer what to do next rather than one generic failure banner.
 */
async function watch(): Promise<void> {
  if (stream.value === null || requesting.value) return;
  requesting.value = true;
  playbackProblem.value = null;
  try {
    grant.value = await requestPlaybackAccess(stream.value.slug);
  } catch (error) {
    grant.value = null;
    const status = error instanceof ApiRequestError ? error.status : 0;
    const kind = status === 401 || status === 403 ? 'sign_in' : status === 409 ? 'not_playing' : status === 503 ? 'unavailable' : 'other';
    playbackProblem.value = { kind, message: messageFor(error) };
  } finally {
    requesting.value = false;
  }
}

const canOfferPlay = computed(() => stream.value !== null && stream.value.availability === 'playable');
const grantExpiry = computed(() =>
  grant.value === null ? null : formatDateTime(grant.value.config.expiresAt, activeLocale(), viewerTimeZone())
);
</script>

<template>
  <section>
    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="notFound"
      variant="notFound"
      data-testid="stream-not-found"
      :message="t('streams.detail.notFound')"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />

    <template v-else-if="stream">
      <div class="hero">
        <AppThumb
          class="hero-thumb"
          :src="stream.coverImageUrl"
          :label="stream.title"
          :ratio="16 / 9"
        />
        <div class="hero-scrim">
          <div class="hero-meta">
            <span
              class="status-pill"
              :class="`status-pill-${TONES[stream.state]}`"
              data-testid="stream-state"
            >{{ t(`streams.state.${stream.state}`) }}</span>
            <span
              class="badge badge-neutral"
              data-testid="stream-access-mode"
            >{{ t(`streams.access.${stream.accessMode}`) }}</span>
          </div>
          <h1 data-testid="stream-title">
            {{ stream.title }}
          </h1>
          <p class="summary">
            {{ stream.summary }}
          </p>
        </div>
      </div>

      <!-- The player region. Nothing is mounted until the server has issued playback
           configuration, so a viewer without access never has a frame to poke at. -->
      <section
        class="block player-block"
        :aria-label="t('streams.player.region')"
      >
        <div
          v-if="grant"
          class="player"
          data-testid="stream-player"
        >
          <!-- The active provider is the deterministic local stub (OD-013 keeps the
               contracted Arvan player out of scope), so this states what was authorised
               instead of embedding a frame that would only pretend to play. -->
          <p class="player-kicker">
            {{ t('streams.player.authorized') }}
          </p>
          <p
            class="player-detail"
            data-testid="stream-player-expiry"
          >
            {{ t('streams.player.expiresAt', { time: grantExpiry }) }}
          </p>
          <p class="player-detail">
            {{ t('streams.player.provider', { provider: grant.config.provider }) }}
          </p>
        </div>

        <div
          v-else
          class="player player-idle"
          data-testid="stream-player-idle"
        >
          <button
            v-if="canOfferPlay"
            type="button"
            class="btn btn-primary"
            :disabled="requesting"
            data-testid="stream-watch"
            @click="watch"
          >
            {{ t('streams.player.watch') }}
          </button>
          <p
            v-else
            class="player-detail"
            data-testid="stream-not-playable"
          >
            {{ stream.availability === 'unavailable' ? t('streams.availability.unavailableDetail') : t('streams.player.notPlaying') }}
          </p>
        </div>

        <div
          v-if="playbackProblem"
          class="playback-problem"
          role="alert"
          data-testid="stream-playback-problem"
        >
          <p>{{ playbackProblem.message }}</p>
          <RouterLink
            v-if="playbackProblem.kind === 'sign_in'"
            class="btn btn-primary"
            :to="`${prefix}/auth/mobile`"
            data-testid="stream-sign-in"
          >
            {{ t('nav.signIn') }}
          </RouterLink>
          <button
            v-else-if="playbackProblem.kind === 'unavailable'"
            type="button"
            class="btn btn-neutral"
            data-testid="stream-retry"
            @click="watch"
          >
            {{ t('streams.player.retry') }}
          </button>
        </div>

        <p
          v-if="stream.accessMode === 'authenticated' && loaded && !authenticated"
          class="access-note"
          data-testid="stream-access-note"
        >
          {{ t('streams.access.signInRequired') }}
        </p>
      </section>

      <!-- Chat is a peer of the player, not a sub-section of it: on a wide viewport they
           sit side by side, and on a narrow one chat follows the player. -->
      <ChatPanel
        class="block"
        :stream-id="stream.id"
      />

      <section class="block">
        <h2>{{ t('streams.detail.about') }}</h2>
        <dl class="meta">
          <div v-if="stream.scheduledStartAt">
            <dt>{{ t('streams.field.scheduledStartAt') }}</dt>
            <dd>{{ formatDateTime(stream.scheduledStartAt, activeLocale(), viewerTimeZone()) }}</dd>
          </div>
          <div v-if="stream.scheduledEndAt">
            <dt>{{ t('streams.field.scheduledEndAt') }}</dt>
            <dd>{{ formatDateTime(stream.scheduledEndAt, activeLocale(), viewerTimeZone()) }}</dd>
          </div>
          <div v-if="stream.actualStartAt">
            <dt>{{ t('streams.field.actualStartAt') }}</dt>
            <dd>{{ formatDateTime(stream.actualStartAt, activeLocale(), viewerTimeZone()) }}</dd>
          </div>
        </dl>

        <!-- STREAM-004 resolves in both directions: the stream names its tournament, and
             the tournament's own streams are one filtered query away. -->
        <p
          v-if="stream.links.tournamentIds.length > 0"
          class="related"
        >
          <RouterLink
            :to="`${prefix}/streams?tournament=${stream.links.tournamentIds[0]}`"
            data-testid="stream-related-tournament"
          >
            {{ t('streams.detail.relatedTournament') }}
          </RouterLink>
        </p>
        <p
          v-if="stream.archiveAvailable"
          class="related"
          data-testid="stream-archive"
        >
          {{ t('streams.detail.archiveRetained') }}
        </p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  margin-block-end: var(--space-5);
}
.hero-scrim {
  padding-block: var(--space-4);
}
.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block-end: var(--space-2);
}
.hero h1 {
  margin: 0;
}
.summary {
  margin-block: var(--space-2) 0;
  color: var(--color-text-muted);
}

.block {
  margin-block-end: var(--space-6);
}

/* The player plate keeps the 16/9 footprint whether or not playback was authorised, so
   the page does not jump when the viewer presses watch. */
.player {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-block-size: 14rem;
  padding: var(--space-5);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-sunken);
  text-align: center;
}

.player-kicker {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
}
[lang='fa'] .player-kicker {
  font-family: var(--font-sans);
}

.player-detail {
  margin: 0;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.playback-problem {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-block-start: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-danger-text);
  border-radius: var(--radius-sm);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
}
.playback-problem p {
  margin: 0;
  flex: 1;
  min-inline-size: 12rem;
}

.access-note {
  margin-block-start: var(--space-3);
  color: var(--color-text-muted);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0 0 var(--space-3);
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

.related {
  margin-block: var(--space-2);
}
</style>
