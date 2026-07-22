<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { listContent, type ContentCard } from '../composables/useContentApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { formatDate } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Public content hub (PAGE-002). Type filter and pagination synchronise with the
 * URL (section 20.2). Only published content is returned by the API.
 */
const CONTENT_TYPES = ['news', 'article', 'announcement', 'guide', 'rules', 'page'] as const;

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { messageFor } = useApiErrors();

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);
const activeType = computed(() => (route.query.type as string | undefined) ?? '');

const loading = ref(true);
const error = ref<string | undefined>(undefined);
const items = ref<ContentCard[]>([]);
const nextCursor = ref<string | null>(null);

async function load(cursor?: string): Promise<void> {
  loading.value = true;
  try {
    const page = await listContent({
      locale: activeLocale.value,
      ...(activeType.value === '' ? {} : { type: activeType.value }),
      ...(cursor === undefined ? {} : { cursor })
    });
    items.value = cursor === undefined ? page.items : [...items.value, ...page.items];
    nextCursor.value = page.nextCursor;
    error.value = undefined;
  } catch (caught) {
    error.value = messageFor(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(() => load());
// Re-fetch when the filter or locale changes.
watch([activeType, activeLocale], () => load());

function selectType(type: string): void {
  const query = type === '' ? {} : { type };
  void router.push({ path: `${prefix.value}/content`, query });
}

function detailPath(card: ContentCard): string {
  return `${prefix.value}/content/${card.type}/${encodeURIComponent(card.slug)}`;
}
</script>

<template>
  <section>
    <h1>{{ t('content.hub.heading') }}</h1>
    <p>{{ t('content.hub.intro') }}</p>

    <nav
      class="filters"
      :aria-label="t('content.hub.filterLabel')"
    >
      <button
        type="button"
        :aria-current="activeType === '' ? 'true' : undefined"
        data-testid="filter-all"
        @click="selectType('')"
      >
        {{ t('content.hub.all') }}
      </button>
      <button
        v-for="type in CONTENT_TYPES"
        :key="type"
        type="button"
        :aria-current="activeType === type ? 'true' : undefined"
        :data-testid="`filter-${type}`"
        @click="selectType(type)"
      >
        {{ t(`content.type.${type}`) }}
      </button>
    </nav>

    <StateBlock
      v-if="loading && items.length === 0"
      variant="loading"
    />
    <StateBlock
      v-else-if="error"
      variant="error"
      :message="error"
    />
    <StateBlock
      v-else-if="items.length === 0"
      variant="empty"
      :message="t('content.hub.empty')"
    />

    <ul
      v-else
      class="cards"
    >
      <li
        v-for="card in items"
        :key="card.id"
        class="card"
      >
        <RouterLink
          :to="detailPath(card)"
          :data-testid="`content-card-${card.slug}`"
        >
          <span class="type">{{ t(`content.type.${card.type}`) }}</span>
          <h2>{{ card.title }}</h2>
          <p>{{ card.summary }}</p>
          <time :datetime="card.publishedAt">{{ formatDate(card.publishedAt, activeLocale) }}</time>
        </RouterLink>
      </li>
    </ul>

    <button
      v-if="nextCursor"
      type="button"
      class="more"
      data-testid="load-more"
      @click="load(nextCursor ?? undefined)"
    >
      {{ t('content.hub.loadMore') }}
    </button>
  </section>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block: var(--space-4);
}

.filters button {
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}

.filters button[aria-current='true'] {
  border-color: var(--color-accent);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
}

.cards {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
}

.card a {
  display: block;
  block-size: 100%;
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  text-decoration: none;
  color: inherit;
}

.type {
  font-size: var(--text-xs);
  text-transform: uppercase;
  color: var(--color-accent);
}

.card h2 {
  font-size: var(--text-lg);
  margin-block: var(--space-2);
}

time {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.more {
  margin-block-start: var(--space-5);
  padding-inline: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}
</style>
