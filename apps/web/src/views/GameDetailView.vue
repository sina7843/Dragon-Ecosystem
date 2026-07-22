<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { getGame, type GameDetail } from '../composables/useContentApi.ts';
import { applyHead } from '../head.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/** Public game detail (PAGE-005). Unpublished games show the not-found state. */
const { t, locale } = useI18n();
const route = useRoute();

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);

const loading = ref(true);
const notFound = ref(false);
const game = ref<GameDetail | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
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
  } catch (caught) {
    game.value = null;
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
    data-testid="game-not-found"
  />

  <article
    v-else-if="game"
    class="detail"
  >
    <h1>{{ game.name }}</h1>
    <img
      v-if="game.coverImageUrl"
      :src="game.coverImageUrl"
      :alt="game.name"
      class="cover"
    >
    <p class="description">
      {{ game.description }}
    </p>
  </article>
</template>

<style scoped>
.detail {
  max-inline-size: 48rem;
  margin-block: var(--space-5);
}

.cover {
  inline-size: 100%;
  border-radius: var(--radius-md);
  margin-block: var(--space-4);
}

.description {
  font-size: var(--text-lg);
}
</style>
