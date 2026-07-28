<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import AppThumb from '../components/AppThumb.vue';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatNumber } from '../i18n/format.ts';
import { listCourses, type AccessModel, type CourseCard } from '../composables/useEducationApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';

/**
 * Academy catalog (PAGE-030). Only published courses are served, and the access filter
 * and search term synchronise with the URL so a shared link reproduces the view.
 */

const ACCESS_FILTERS: readonly AccessModel[] = ['free', 'paid'];

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);
const activeQuery = computed(() => (route.query.q as string | undefined) ?? '');
const activeAccess = computed<AccessModel | ''>(() => {
  const requested = route.query.accessModel as string | undefined;
  return ACCESS_FILTERS.find((a) => a === requested) ?? '';
});
const searchInput = ref(activeQuery.value);
watch(activeQuery, (value) => {
  searchInput.value = value;
});

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const courses = ref<CourseCard[]>([]);

// Monotonic token: a slower earlier fetch must never overwrite a newer one.
let requestToken = 0;

async function load(): Promise<void> {
  const token = ++requestToken;
  loading.value = true;
  try {
    const page = await listCourses({
      locale: activeLocale(),
      ...(activeQuery.value === '' ? {} : { q: activeQuery.value }),
      ...(activeAccess.value === '' ? {} : { accessModel: activeAccess.value })
    });
    if (token !== requestToken) return;
    courses.value = page.items;
    errorMessage.value = undefined;
  } catch (error) {
    if (token === requestToken) errorMessage.value = messageFor(error);
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

onMounted(load);
watch([activeQuery, activeAccess, activeLocale], () => load());

function pushQuery(overrides: { q?: string; accessModel?: AccessModel | '' }): void {
  const q = overrides.q ?? activeQuery.value;
  const accessModel = overrides.accessModel ?? activeAccess.value;
  const query: Record<string, string> = {};
  if (q !== '') query.q = q;
  if (accessModel !== '') query.accessModel = accessModel;
  void router.push({ path: `${prefix.value}/academy`, query });
}

function submitSearch(): void {
  pushQuery({ q: searchInput.value.trim() });
}

/** Course price label. A course is priced in Dragon Coin only (see DECISIONS.md, OD-015). */
function priceLabel(course: CourseCard): string {
  if (course.accessModel === 'free') return t('academy.free');
  const coin = course.price.find((component) => component.assetCode === 'DRC');
  return coin === undefined
    ? t('academy.paid')
    : `${formatNumber(coin.amountInteger, activeLocale())} ${t('money.dragonCoinUnit')}`;
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('academy.hub.heading') }}</h1>
        <p class="page-lead">
          {{ t('academy.hub.intro') }}
        </p>
      </div>
    </div>

    <form
      class="search toolbar"
      role="search"
      @submit.prevent="submitSearch"
    >
      <label
        class="search-field"
        for="academy-search"
      >
        <span class="visually-hidden">{{ t('search.label') }}</span>
        <input
          id="academy-search"
          v-model="searchInput"
          type="search"
          data-testid="search-input"
          :placeholder="t('search.placeholder')"
        >
      </label>
      <button
        type="submit"
        class="btn btn-primary"
        data-testid="search-submit"
      >
        {{ t('search.submit') }}
      </button>
    </form>

    <nav
      class="filters"
      :aria-label="t('academy.accessFilter')"
    >
      <button
        type="button"
        class="chip"
        :aria-current="activeAccess === '' ? 'true' : undefined"
        data-testid="access-all"
        @click="pushQuery({ accessModel: '' })"
      >
        {{ t('content.hub.all') }}
      </button>
      <button
        v-for="access in ACCESS_FILTERS"
        :key="access"
        type="button"
        class="chip"
        :aria-current="activeAccess === access ? 'true' : undefined"
        :data-testid="`access-${access}`"
        @click="pushQuery({ accessModel: access })"
      >
        {{ t(`academy.${access}`) }}
      </button>
    </nav>

    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />
    <StateBlock
      v-else-if="courses.length === 0"
      variant="empty"
      :message="t('academy.hub.empty')"
    />

    <ul
      v-else
      class="card-grid cards"
      data-testid="course-list"
    >
      <li
        v-for="course in courses"
        :key="course.id"
        class="card card-interactive c-card"
        :data-testid="`course-card-${course.slug}`"
      >
        <AppThumb
          class="card-thumb"
          :src="course.coverImageUrl"
          :label="course.title"
          :ratio="16 / 9"
        />
        <div class="c-top">
          <span
            class="badge"
            :class="course.accessModel === 'free' ? 'badge-neutral' : 'badge-accent'"
            :data-testid="`course-price-${course.slug}`"
          >{{ priceLabel(course) }}</span>
        </div>
        <RouterLink
          class="c-link"
          :to="`${prefix}/academy/courses/${course.slug}`"
        >
          <h2 class="card-title">
            {{ course.title }}
          </h2>
        </RouterLink>
        <p class="summary">
          {{ course.summary }}
        </p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.search-field {
  flex: 1;
  min-inline-size: 12rem;
}
.search-field input {
  inline-size: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block-end: var(--space-4);
}

.cards {
  list-style: none;
  margin: 0;
  padding: 0;
}

.c-top {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block: var(--space-3) var(--space-2);
}

.c-link {
  color: inherit;
  text-decoration: none;
}
.card-title {
  margin: 0;
}

.summary {
  margin-block: var(--space-2) 0;
  color: var(--color-text-muted);
}
</style>
