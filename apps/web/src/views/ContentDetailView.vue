<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { getContent, type ContentDetail } from '../composables/useContentApi.ts';
import { applyHead } from '../head.ts';
import { formatDate } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Public content detail (PAGE-003). The body is already sanitised server-side
 * (CONTENT-005), so it is rendered directly. SEO title, description, canonical,
 * hreflang (with the correct per-locale slug), and Open Graph are set from the
 * loaded content. An unpublished or unknown item shows the not-found state.
 */
const { t, locale } = useI18n();
const route = useRoute();

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);

const loading = ref(true);
const notFound = ref(false);
const error = ref<string | undefined>(undefined);
const item = ref<ContentDetail | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  const type = String(route.params.type);
  const slug = String(route.params.slug);
  try {
    const detail = await getContent(type, slug, activeLocale.value);
    item.value = detail;
    applySeo(detail);
  } catch (caught) {
    item.value = null;
    if (caught instanceof ApiRequestError && caught.status === 404) notFound.value = true;
    else error.value = t('error.code.UNEXPECTED');
  } finally {
    loading.value = false;
  }
}

function applySeo(detail: ContentDetail): void {
  applyHead({
    title: `${detail.seoTitle} — ${t('app.name')}`,
    locale: activeLocale.value,
    path: `${prefix.value}/content/${detail.type}/${encodeURIComponent(detail.slug)}`,
    indexable: true,
    description: detail.seoDescription,
    ogType: 'article',
    image: detail.coverImageUrl,
    // hreflang must use each locale's own slug (section 17.3).
    alternates: {
      fa: `/fa/content/${detail.type}/${encodeURIComponent(detail.alternateSlugs.fa)}`,
      en: `/en/content/${detail.type}/${encodeURIComponent(detail.alternateSlugs.en)}`
    }
  });
}

onMounted(load);
// Reload when the language switches so the correct localized slug and body load.
watch(activeLocale, () => {
  if (item.value !== null) {
    // Switch to the alternate-locale slug for the same item.
    const slug = item.value.alternateSlugs[activeLocale.value];
    void getContent(item.value.type, slug, activeLocale.value)
      .then((detail) => {
        item.value = detail;
        applySeo(detail);
      })
      .catch(() => load());
  } else {
    void load();
  }
});
</script>

<template>
  <StateBlock
    v-if="loading"
    variant="loading"
  />
  <StateBlock
    v-else-if="notFound"
    variant="notFound"
    data-testid="content-not-found"
  />
  <StateBlock
    v-else-if="error"
    variant="error"
    :message="error"
  />

  <article
    v-else-if="item"
    class="detail"
  >
    <p class="type">
      {{ t(`content.type.${item.type}`) }}
    </p>
    <h1>{{ item.title }}</h1>
    <p class="summary">
      {{ item.summary }}
    </p>
    <p
      v-if="item.publishedAt"
      class="meta"
    >
      <time :datetime="item.publishedAt">{{ formatDate(item.publishedAt, activeLocale) }}</time>
    </p>
    <img
      v-if="item.coverImageUrl"
      :src="item.coverImageUrl"
      :alt="item.title"
      class="cover"
    >
    <!-- Body is sanitised at write time on the server (CONTENT-005), so it is safe to render. -->
    <!-- eslint-disable vue/no-v-html -->
    <div
      class="body"
      data-testid="content-body"
      v-html="item.body"
    />
    <!-- eslint-enable vue/no-v-html -->
  </article>
</template>

<style scoped>
.detail {
  max-inline-size: 48rem;
  margin-block: var(--space-5);
}

.type {
  font-size: var(--text-xs);
  text-transform: uppercase;
  color: var(--color-accent);
  margin-block: 0;
}

.summary {
  font-size: var(--text-lg);
  color: var(--color-text-muted);
}

.meta {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.cover {
  inline-size: 100%;
  border-radius: var(--radius-md);
  margin-block: var(--space-4);
}

.body :deep(h2) {
  margin-block-start: var(--space-5);
}

.body :deep(a) {
  color: var(--color-accent);
}
</style>
