<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import AppThumb from '../components/AppThumb.vue';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { applyHead } from '../head.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatNumber } from '../i18n/format.ts';
import { activateEnrollment, enroll, getCourse, type CourseDetail } from '../composables/useEducationApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useAuth } from '../composables/useAuth.ts';
import { useToasts } from '../composables/useToasts.ts';

/**
 * Course detail (PAGE-031).
 *
 * The curriculum outline is public; lesson bodies are not, and never appear in this
 * payload. The call to action is driven by the learner's own enrolment state as the
 * server reports it — a paid enrolment goes through an explicit activation step, so the
 * learner sees what they are spending before it is captured.
 */

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { messageFor } = useApiErrors();
const { authenticated, loaded, refresh } = useAuth();
const { push } = useToasts();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);

const loading = ref(true);
const notFound = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const course = ref<CourseDetail | null>(null);
const busy = ref(false);

async function load(): Promise<void> {
  try {
    course.value = await getCourse(String(route.params['slug']), activeLocale());
    applyHead({
      title: `${course.value.title} — ${t('app.name')}`,
      locale: activeLocale(),
      path: `${prefix.value}/academy/courses/${encodeURIComponent(course.value.slug)}`,
      indexable: true,
      description: course.value.summary
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound.value = true;
    else errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();
  if (!loaded.value) await refresh();
});

const priceLabel = computed(() => {
  const detail = course.value;
  if (detail === null || detail.accessModel === 'free') return t('academy.free');
  const coin = detail.price.find((component) => component.assetCode === 'DRC');
  return coin === undefined ? t('academy.paid') : `${formatNumber(coin.amountInteger, activeLocale())} ${t('money.dragonCoinUnit')}`;
});

/** What the primary control should do, from the server-reported enrolment state. */
const action = computed<'sign_in' | 'enroll' | 'activate' | 'open' | 'blocked'>(() => {
  if (loaded.value && !authenticated.value) return 'sign_in';
  const enrollment = course.value?.myEnrollment ?? null;
  if (enrollment === null) return 'enroll';
  if (enrollment.state === 'pending_payment') return 'activate';
  if (enrollment.state === 'active' || enrollment.state === 'completed') return 'open';
  return 'blocked';
});

async function onEnroll(): Promise<void> {
  if (course.value === null || busy.value) return;
  busy.value = true;
  try {
    const enrollment = await enroll(course.value.id);
    push('success', t('academy.enrolled'));
    // A free course is active immediately; a paid one waits for an explicit activation.
    if (enrollment.state === 'active') await router.push(`${prefix.value}/academy/learn/${enrollment.id}`);
    else await load();
  } catch (error) {
    push('danger', messageFor(error));
  } finally {
    busy.value = false;
  }
}

async function onActivate(): Promise<void> {
  const enrollmentId = course.value?.myEnrollment?.id;
  if (enrollmentId === undefined || busy.value) return;
  busy.value = true;
  try {
    await activateEnrollment(enrollmentId);
    push('success', t('academy.activated'));
    await router.push(`${prefix.value}/academy/learn/${enrollmentId}`);
  } catch (error) {
    push('danger', messageFor(error));
  } finally {
    busy.value = false;
  }
}
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
      data-testid="course-not-found"
      :message="t('academy.detail.notFound')"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />

    <template v-else-if="course">
      <div class="hero">
        <AppThumb
          class="hero-thumb"
          :src="course.coverImageUrl"
          :label="course.title"
          :ratio="16 / 9"
        />
        <div class="hero-body">
          <div class="hero-meta">
            <span
              class="badge"
              :class="course.accessModel === 'free' ? 'badge-neutral' : 'badge-accent'"
              data-testid="course-price"
            >{{ priceLabel }}</span>
            <!-- The coach's approved public fields are shown here. A dedicated
                 /coaches/{slug} page (PAGE-033) is not built, so this is deliberately
                 not a link — a card that led nowhere is the BUG-001 mistake. -->
            <span
              v-if="course.coach"
              class="badge badge-neutral"
              data-testid="course-coach"
            >{{ course.coach.displayName }}</span>
          </div>
          <h1 data-testid="course-title">
            {{ course.title }}
          </h1>
          <p class="summary">
            {{ course.summary }}
          </p>

          <div class="cta">
            <RouterLink
              v-if="action === 'sign_in'"
              class="btn btn-primary"
              :to="`${prefix}/auth/mobile`"
              data-testid="course-sign-in"
            >
              {{ t('nav.signIn') }}
            </RouterLink>
            <button
              v-else-if="action === 'enroll'"
              type="button"
              class="btn btn-primary"
              :disabled="busy"
              data-testid="course-enroll"
              @click="onEnroll"
            >
              {{ course.accessModel === 'free' ? t('academy.enroll') : t('academy.enrollPaid') }}
            </button>
            <button
              v-else-if="action === 'activate'"
              type="button"
              class="btn btn-primary"
              :disabled="busy"
              data-testid="course-activate"
              @click="onActivate"
            >
              {{ t('academy.activate', { price: priceLabel }) }}
            </button>
            <RouterLink
              v-else-if="action === 'open'"
              class="btn btn-primary"
              :to="`${prefix}/academy/learn/${course.myEnrollment?.id}`"
              data-testid="course-open"
            >
              {{ t('academy.continue') }}
            </RouterLink>
            <p
              v-else
              class="blocked"
              data-testid="course-blocked"
            >
              {{ t('academy.enrolmentBlocked') }}
            </p>
          </div>
        </div>
      </div>

      <section class="block">
        <h2>{{ t('academy.detail.about') }}</h2>
        <!-- Sanitised on write by the server, so it is safe to render as markup. -->
        <div
          class="description"
          v-html="course.description"
        />
      </section>

      <section class="block">
        <h2>{{ t('academy.detail.curriculum') }}</h2>
        <ol
          class="curriculum"
          data-testid="course-curriculum"
        >
          <li
            v-for="entry in course.curriculum"
            :key="entry.id"
          >
            <span class="lesson-title">{{ entry.title }}</span>
            <span
              v-if="entry.required"
              class="badge badge-neutral"
            >{{ t('academy.required') }}</span>
          </li>
        </ol>
        <p class="completion-note">
          {{ t('academy.completionNote', { percent: formatNumber(course.completionRule.thresholdPercent, activeLocale()) }) }}
        </p>
      </section>

      <section
        v-if="course.reviews.length > 0"
        class="block"
      >
        <h2>{{ t('academy.detail.reviews') }}</h2>
        <ul
          class="reviews"
          data-testid="course-reviews"
        >
          <li
            v-for="review in course.reviews"
            :key="review.id"
            class="card review"
          >
            <span class="rating">{{ formatNumber(review.rating, activeLocale()) }}/{{ formatNumber(5, activeLocale()) }}</span>
            <p>{{ review.body }}</p>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.hero {
  margin-block-end: var(--space-5);
}
.hero-body {
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
  margin-block: var(--space-2);
  color: var(--color-text-muted);
}
.cta {
  margin-block-start: var(--space-4);
}
.blocked {
  margin: 0;
  color: var(--color-danger-text);
}

.block {
  margin-block-end: var(--space-6);
}

.description :deep(p) {
  margin-block: var(--space-2);
}

.curriculum {
  margin: 0;
  padding-inline-start: var(--space-5);
  display: grid;
  gap: var(--space-2);
}
.lesson-title {
  margin-inline-end: var(--space-2);
}
.completion-note {
  margin-block-start: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.reviews {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}
.review {
  padding: var(--space-3) var(--space-4);
}
.rating {
  font-variant-numeric: tabular-nums;
  font-weight: var(--weight-bold);
}
.review p {
  margin-block: var(--space-2) 0;
}
</style>
