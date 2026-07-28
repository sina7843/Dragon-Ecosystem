<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatNumber } from '../i18n/format.ts';
import { getLearnerCourse, recordProgress, type LearnerCourse, type LearnerLesson } from '../composables/useEducationApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';

/**
 * Course player (PAGE-032).
 *
 * A locked lesson arrives from the server without its body or media, so the lock is a
 * fact about the payload rather than something this view enforces. Progress is reported
 * to the server, which stores it monotonically and recomputes completion — refreshing or
 * switching device therefore preserves it (EDU-006).
 */

const { t, locale } = useI18n();
const route = useRoute();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);
const enrollmentId = computed(() => String(route.params['enrollmentId']));

const loading = ref(true);
const forbidden = ref(false);
const notFound = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const data = ref<LearnerCourse | null>(null);
const selectedId = ref<string | null>(null);
const busy = ref(false);

async function load(): Promise<void> {
  try {
    data.value = await getLearnerCourse(enrollmentId.value, activeLocale());
    // Land on the first lesson that is still open, so a returning learner resumes.
    const next = data.value.lessons.find((lesson) => !lesson.locked && !lesson.completed) ?? data.value.lessons.find((lesson) => !lesson.locked);
    selectedId.value = selectedId.value ?? next?.id ?? null;
    forbidden.value = false;
    notFound.value = false;
    errorMessage.value = undefined;
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 0;
    // 403 is the entitlement decision (revoked, or a paid enrolment not yet activated).
    if (status === 403) forbidden.value = true;
    else if (status === 404) notFound.value = true;
    else errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const selected = computed<LearnerLesson | null>(() => data.value?.lessons.find((lesson) => lesson.id === selectedId.value) ?? null);
const completedCount = computed(() => data.value?.lessons.filter((lesson) => lesson.completed).length ?? 0);

function select(lesson: LearnerLesson): void {
  if (lesson.locked) return;
  selectedId.value = lesson.id;
}

async function markComplete(): Promise<void> {
  const lesson = selected.value;
  if (lesson === null || busy.value) return;
  busy.value = true;
  try {
    const result = await recordProgress(enrollmentId.value, lesson.id, 100);
    if (result.enrollment.state === 'completed') push('success', t('academy.courseCompleted'));
    // Reload so newly unlocked lessons appear with their content.
    await load();
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
      v-else-if="forbidden"
      variant="forbidden"
      data-testid="player-forbidden"
      :message="t('academy.player.noAccess')"
    />
    <StateBlock
      v-else-if="notFound"
      variant="notFound"
      data-testid="player-not-found"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />

    <template v-else-if="data">
      <div class="page-header">
        <div>
          <h1 data-testid="player-title">
            {{ data.course.title }}
          </h1>
          <p
            class="page-lead"
            data-testid="player-progress"
          >
            {{ t('academy.player.progress', {
              done: formatNumber(completedCount, activeLocale()),
              total: formatNumber(data.lessons.length, activeLocale())
            }) }}
          </p>
        </div>
        <div class="page-header-actions">
          <span
            v-if="data.enrollment.state === 'completed'"
            class="status-pill status-pill-success"
            data-testid="player-completed"
          >{{ t('academy.player.completed') }}</span>
          <RouterLink
            class="btn btn-ghost"
            :to="`${prefix}/academy`"
          >
            {{ t('academy.player.backToCatalog') }}
          </RouterLink>
        </div>
      </div>

      <div class="player">
        <nav
          class="lesson-nav"
          :aria-label="t('academy.player.lessons')"
        >
          <ol data-testid="lesson-list">
            <li
              v-for="lesson in data.lessons"
              :key="lesson.id"
            >
              <button
                type="button"
                class="lesson-button"
                :class="{ current: lesson.id === selectedId }"
                :disabled="lesson.locked"
                :aria-current="lesson.id === selectedId ? 'true' : undefined"
                :data-testid="`lesson-${lesson.id}`"
                @click="select(lesson)"
              >
                <span class="lesson-name">{{ lesson.title }}</span>
                <span
                  v-if="lesson.locked"
                  class="lesson-flag"
                  :data-testid="`lesson-locked-${lesson.id}`"
                >{{ t('academy.player.locked') }}</span>
                <span
                  v-else-if="lesson.completed"
                  class="lesson-flag"
                  :data-testid="`lesson-done-${lesson.id}`"
                >{{ t('academy.player.done') }}</span>
              </button>
            </li>
          </ol>
        </nav>

        <article
          v-if="selected"
          class="lesson-body"
          data-testid="lesson-body"
        >
          <h2>{{ selected.title }}</h2>
          <!-- Sanitised on write by the server; a locked lesson never reaches here. -->
          <div
            v-if="selected.body"
            class="lesson-content"
            v-html="selected.body"
          />
          <p
            v-if="selected.mediaUrl"
            class="lesson-media"
          >
            <a
              :href="selected.mediaUrl"
              rel="noopener noreferrer"
              data-testid="lesson-media"
            >{{ t('academy.player.openMaterial') }}</a>
          </p>
          <button
            v-if="!selected.completed"
            type="button"
            class="btn btn-primary"
            :disabled="busy"
            data-testid="lesson-complete"
            @click="markComplete"
          >
            {{ t('academy.player.markComplete') }}
          </button>
        </article>

        <StateBlock
          v-else
          variant="empty"
          :message="t('academy.player.selectLesson')"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.player {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: minmax(12rem, 18rem) 1fr;
  align-items: start;
}
@media (max-width: 767px) {
  .player {
    grid-template-columns: 1fr;
  }
}

.lesson-nav ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-1);
}

.lesson-button {
  inline-size: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
  color: var(--color-text);
  text-align: start;
  cursor: pointer;
}
.lesson-button.current {
  border-color: var(--color-accent);
  background-color: var(--color-primary-soft);
}
.lesson-button:disabled {
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.lesson-name {
  flex: 1;
  min-inline-size: 0;
}
.lesson-flag {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-eyebrow);
  color: var(--color-text-muted);
}
[lang='fa'] .lesson-flag {
  font-family: var(--font-sans);
  text-transform: none;
  letter-spacing: normal;
  font-size: var(--text-sm);
}

.lesson-body {
  padding: var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
}
.lesson-body h2 {
  margin-block: 0 var(--space-3);
}
.lesson-content :deep(p) {
  margin-block: var(--space-2);
}
.lesson-media {
  margin-block: var(--space-3);
}
</style>
