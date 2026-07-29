<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { getPublicPlayer, type PublicPlayer } from '../composables/usePlayersApi.ts';
import { follow, getSocialProfileByUsername, unfollow, type SocialProfileView } from '../composables/useSocialApi.ts';
import { applyHead } from '../head.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Public player profile (PAGE-035, section 16.4). A private or unknown player is a real 404.
 *
 * The community section sits beside the Phase 1 identity rather than replacing it
 * (SOCIAL-001): the username, display name, and URL are exactly what they were. Statistics
 * appear only when the owner opted in, and each states where it was counted from
 * (SOCIAL-010). A failed social read leaves the identity header intact — the community
 * layer is additive, so it must not be able to break the page it is attached to.
 */
const { t, locale } = useI18n();
const route = useRoute();
const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);

const loading = ref(true);
const notFound = ref(false);
const player = ref<PublicPlayer | null>(null);

const social = ref<(SocialProfileView & { accountId: string }) | null>(null);
const following = ref(false);
const followBusy = ref(false);

const initial = computed(() => (player.value?.displayName.trim()[0] ?? '?').toUpperCase());

async function toggleFollow(): Promise<void> {
  const target = social.value;
  if (target === null || followBusy.value) return;
  followBusy.value = true;
  try {
    if (following.value) await unfollow('user', target.accountId);
    else await follow('user', target.accountId);
    following.value = !following.value;
  } catch {
    // A failed follow leaves the button in its previous state rather than lying about it.
  } finally {
    followBusy.value = false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  const username = String(route.params.username);
  try {
    const detail = await getPublicPlayer(username);
    player.value = detail;
    applyHead({
      title: `${detail.displayName} — ${t('app.name')}`,
      locale: activeLocale.value,
      path: `${prefix.value}/players/${encodeURIComponent(detail.username)}`,
      indexable: true,
      description: t('player.metaDescription', { name: detail.displayName })
    });
  } catch (caught) {
    player.value = null;
    if (caught instanceof ApiRequestError && caught.status === 404) notFound.value = true;
  } finally {
    loading.value = false;
  }
  if (player.value !== null) {
    try {
      social.value = await getSocialProfileByUsername(player.value.username);
      // The control is a toggle, so its state has to come from the server. Defaulting to
      // "not following" made every reload show "Follow" to someone who already followed,
      // and pressing it followed again — there was no way to unfollow from this page.
      following.value = social.value.viewerFollows;
    } catch {
      social.value = null;
      following.value = false;
    }
  }
}

onMounted(load);
watch(activeLocale, () => load());
</script>

<template>
  <StateBlock
    v-if="loading"
    variant="loading"
  />
  <StateBlock
    v-else-if="notFound"
    variant="notFound"
    data-testid="player-not-found"
  />

  <article
    v-else-if="player"
    class="player"
  >
    <header class="hero">
      <span
        class="avatar"
        aria-hidden="true"
      >{{ initial }}</span>
      <div class="identity">
        <h1>{{ player.displayName }}</h1>
        <bdi class="username latin-value">@{{ player.username }}</bdi>
        <p
          v-if="social?.headline"
          data-testid="player-headline"
        >
          {{ social.headline }}
        </p>
      </div>
    </header>

    <section
      v-if="social"
      class="community"
      data-testid="player-community"
    >
      <h2>{{ t('community.profile.title') }}</h2>
      <button
        type="button"
        data-testid="player-follow"
        :aria-pressed="following"
        :disabled="followBusy"
        @click="toggleFollow"
      >
        {{ following ? t('community.profile.unfollow') : t('community.profile.follow') }}
      </button>

      <dl
        v-if="social.statistics.length > 0"
        class="statistics"
        data-testid="player-statistics"
      >
        <div
          v-for="statistic in social.statistics"
          :key="statistic.key"
        >
          <dt>{{ t(`community.profile.statistic.${statistic.key}`) }}</dt>
          <!-- The source is shown rather than hidden: a number a viewer cannot trace is a
               number they cannot check (SOCIAL-010). -->
          <dd>
            {{ statistic.value }}
            <span class="username">{{ t('community.profile.source', { source: statistic.source }) }}</span>
          </dd>
        </div>
      </dl>
      <p
        v-else
        class="username"
        data-testid="player-statistics-hidden"
      >
        {{ t('community.profile.statisticsHidden') }}
      </p>

      <ul
        v-if="social.posts.length > 0"
        class="posts"
        data-testid="player-posts"
      >
        <li
          v-for="post in social.posts"
          :key="post.id"
        >
          <RouterLink :to="`${prefix}/community/posts/${post.id}`">
            {{ post.body }}
          </RouterLink>
        </li>
      </ul>
    </section>
  </article>
</template>

<style scoped>
.player {
  max-inline-size: 46rem;
  margin-inline: auto;
  margin-block: var(--space-6);
}
.hero {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: clamp(var(--space-5), 4vw, var(--space-6));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-md);
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 5rem;
  block-size: 5rem;
  border-radius: var(--radius-full);
  background-color: var(--color-primary-strong);
  color: var(--color-primary-text);
  font-size: var(--text-2xl);
  font-weight: var(--weight-black);
  box-shadow: var(--glow-primary);
}
.identity h1 {
  margin: 0;
}
.username {
  color: var(--color-text-muted);
  font-size: var(--text-md);
}
.community {
  margin-block-start: var(--space-5);
  padding: clamp(var(--space-5), 4vw, var(--space-6));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  background-color: var(--color-surface);
}
.statistics {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
}
.posts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>
