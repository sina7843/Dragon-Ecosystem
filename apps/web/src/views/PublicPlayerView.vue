<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { getPublicPlayer, type PublicPlayer } from '../composables/usePlayersApi.ts';
import { applyHead } from '../head.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/** Public player profile (PAGE, section 16.4). A private or unknown player is a real 404. */
const { t, locale } = useI18n();
const route = useRoute();
const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);

const loading = ref(true);
const notFound = ref(false);
const player = ref<PublicPlayer | null>(null);

const initial = computed(() => (player.value?.displayName.trim()[0] ?? '?').toUpperCase());

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
      </div>
    </header>
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
</style>
