<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AppThumb from '../components/AppThumb.vue';
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
  const path = `${prefix.value}/content/${detail.type}/${encodeURIComponent(detail.slug)}`;
  const origin = globalThis.location?.origin ?? '';
  applyHead({
    title: `${detail.seoTitle} — ${t('app.name')}`,
    locale: activeLocale.value,
    path,
    indexable: true,
    description: detail.seoDescription,
    ogType: 'article',
    image: detail.coverImageUrl,
    // hreflang must use each locale's own slug (section 17.3).
    alternates: {
      fa: `/fa/content/${detail.type}/${encodeURIComponent(detail.alternateSlugs.fa)}`,
      en: `/en/content/${detail.type}/${encodeURIComponent(detail.alternateSlugs.en)}`
    },
    // Structured data for the article (SEO-007).
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: detail.title,
      description: detail.seoDescription,
      inLanguage: activeLocale.value,
      datePublished: detail.publishedAt,
      url: `${origin}${path}`
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
    <!-- Image-forward hero: cover banner with the title/type over a scrim. -->
    <header class="hero">
      <AppThumb
        class="hero-thumb"
        :src="item.coverImageUrl"
        :label="item.title"
        :ratio="21 / 9"
      />
      <div class="hero-scrim">
        <span class="badge badge-accent type">{{ t(`content.type.${item.type}`) }}</span>
        <h1>{{ item.title }}</h1>
        <p
          v-if="item.publishedAt"
          class="meta"
        >
          <time :datetime="item.publishedAt">{{ formatDate(item.publishedAt, activeLocale) }}</time>
        </p>
      </div>
    </header>

    <p class="summary">
      {{ item.summary }}
    </p>

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
  max-inline-size: 46rem;
  margin-inline: auto;
  margin-block: var(--space-5);
}

.hero {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
  margin-block-end: var(--space-5);
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
  margin-block: var(--space-3) var(--space-2);
  color: #ffffff;
}
[lang='fa'] .hero-scrim h1 {
  line-height: 1.4;
}

.type {
  margin-block: 0;
}

.summary {
  font-size: var(--text-lg);
  color: var(--color-text-soft);
  margin-block-end: var(--space-5);
}

.meta {
  color: rgb(255 255 255 / 82%);
  font-size: var(--text-sm);
  margin-block-start: var(--space-2);
  margin-block-end: 0;
}

.body :deep(h2) {
  margin-block-start: var(--space-5);
}

.body :deep(a) {
  color: var(--color-accent);
}
</style>
