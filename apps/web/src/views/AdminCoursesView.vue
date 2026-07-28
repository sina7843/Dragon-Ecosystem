<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppField from '../components/AppField.vue';
import StateBlock from '../components/StateBlock.vue';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import {
  createCourse,
  getEducationConfig,
  listAdminCourses,
  setCourseState,
  type AdminCourse,
  type CourseState
} from '../composables/useEducationApi.ts';

/**
 * Education administration (PAGE-054).
 *
 * Publication runs through the server's completeness check, so a course that is missing a
 * localized title, a curriculum, or an approved owning coach is refused with the reasons
 * listed rather than half-published (EDU-009).
 */

const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor, fieldMessage } = useApiErrors();
const { push } = useToasts();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

/** Section 12.10, as operator controls. */
const NEXT_STATES: Readonly<Record<string, readonly CourseState[]>> = {
  draft: ['review', 'archived'],
  review: ['published', 'draft', 'archived'],
  published: ['unpublished', 'archived'],
  unpublished: ['review', 'published', 'archived'],
  archived: []
};

const loading = ref(true);
const listError = ref<string | undefined>(undefined);
const courses = ref<AdminCourse[]>([]);
const paidCoursesEnabled = ref(false);
const busy = ref('');
const creating = ref(false);
const formError = ref<string | undefined>(undefined);
const slugError = ref<string | undefined>(undefined);
/** Per-row publication problems, so an author sees exactly what is missing. */
const problems = reactive<Record<string, string[]>>({});

const form = reactive({ slug: '', enTitle: '', faTitle: '' });

async function loadList(): Promise<void> {
  loading.value = true;
  try {
    const [page, config] = await Promise.all([listAdminCourses(), getEducationConfig()]);
    courses.value = page.items;
    paidCoursesEnabled.value = config.paidCoursesEnabled;
    listError.value = undefined;
  } catch (caught) {
    listError.value = messageFor(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await refreshCaps();
  await loadList();
});

async function create(): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  formError.value = undefined;
  slugError.value = undefined;
  try {
    await createCourse({
      ...(form.slug.trim() === '' ? {} : { slug: form.slug.trim() }),
      translations: { en: { title: form.enTitle }, fa: { title: form.faTitle } }
    });
    push('success', t('adminCourses.created'));
    Object.assign(form, { slug: '', enTitle: '', faTitle: '' });
    await loadList();
  } catch (caught) {
    slugError.value = fieldMessage(caught, 'slug');
    if (slugError.value === undefined) formError.value = messageFor(caught);
  } finally {
    creating.value = false;
  }
}

async function move(course: AdminCourse, state: CourseState): Promise<void> {
  if (busy.value !== '') return;
  busy.value = course.id;
  delete problems[course.id];
  try {
    await setCourseState(course.id, { state, expectedVersion: course.version, reason: t('adminCourses.stateReason', { state: t(`adminCourses.state.${state}`) }) });
    push('success', t('adminCourses.stateChanged'));
    await loadList();
  } catch (caught) {
    // Publication completeness comes back as field errors; show them all at once.
    const fieldErrors = (caught as { fieldErrors?: Array<{ message: string }> }).fieldErrors ?? [];
    if (fieldErrors.length > 0) problems[course.id] = fieldErrors.map((f) => f.message);
    else push('danger', messageFor(caught));
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('adminCourses.heading') }}</h1>
        <p class="page-lead">
          {{ t('adminCourses.intro') }}
        </p>
      </div>
      <div class="page-header-actions">
        <!-- OD-015: the console says plainly that paid courses are gated. -->
        <span
          v-if="!paidCoursesEnabled"
          class="badge badge-warning"
          data-testid="courses-paid-gate"
        >{{ t('adminCourses.paidGated') }}</span>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="courses-forbidden"
    />

    <template v-else>
      <form
        class="create-form data-panel"
        data-testid="course-create-form"
        @submit.prevent="create"
      >
        <h2>{{ t('adminCourses.createHeading') }}</h2>
        <div class="fields">
          <AppField
            id="course-en-title"
            v-model="form.enTitle"
            :label="t('adminCourses.field.titleEn')"
            required
          />
          <AppField
            id="course-fa-title"
            v-model="form.faTitle"
            :label="t('adminCourses.field.titleFa')"
            required
          />
          <AppField
            id="course-slug"
            v-model="form.slug"
            :label="t('adminCourses.field.slug')"
            :error="slugError"
          />
        </div>
        <p
          v-if="formError"
          class="form-error"
          role="alert"
        >
          {{ formError }}
        </p>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="creating"
          data-testid="course-create-submit"
        >
          {{ t('adminCourses.create') }}
        </button>
      </form>

      <StateBlock
        v-if="loading"
        variant="loading"
      />
      <StateBlock
        v-else-if="listError"
        variant="error"
        :message="listError"
      />
      <StateBlock
        v-else-if="courses.length === 0"
        variant="empty"
        :message="t('adminCourses.empty')"
      />

      <ul
        v-else
        class="course-rows"
        data-testid="admin-course-list"
      >
        <li
          v-for="course in courses"
          :key="course.id"
          class="card course-row"
          :data-testid="`admin-course-${course.slug}`"
        >
          <div class="row-head">
            <h2 class="card-title">
              {{ course.translations[activeLocale()].title || course.slug }}
            </h2>
            <span
              class="status-pill status-pill-neutral"
              :data-testid="`admin-course-state-${course.slug}`"
            >{{ t(`adminCourses.state.${course.state}`) }}</span>
            <span class="badge badge-neutral">{{ t(`academy.${course.accessModel}`) }}</span>
          </div>

          <dl class="meta">
            <div>
              <dt>{{ t('adminCourses.field.updatedAt') }}</dt>
              <dd>{{ formatDateTime(course.updatedAt, activeLocale(), viewerTimeZone()) }}</dd>
            </div>
            <div>
              <dt>{{ t('adminCourses.field.completion') }}</dt>
              <dd>{{ course.completionRule.thresholdPercent }}%</dd>
            </div>
          </dl>

          <ul
            v-if="problems[course.id]"
            class="problems"
            role="alert"
            :data-testid="`course-problems-${course.slug}`"
          >
            <li
              v-for="problem in problems[course.id]"
              :key="problem"
            >
              {{ problem }}
            </li>
          </ul>

          <div class="row-actions">
            <button
              v-for="next in NEXT_STATES[course.state] ?? []"
              :key="next"
              type="button"
              class="btn btn-neutral"
              :disabled="busy === course.id"
              :data-testid="`move-${course.slug}-${next}`"
              @click="move(course, next)"
            >
              {{ t('adminCourses.moveTo', { state: t(`adminCourses.state.${next}`) }) }}
            </button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.create-form {
  margin-block-end: var(--space-5);
  padding: var(--space-4);
}
.create-form h2 {
  margin-block: 0 var(--space-3);
  font-size: var(--text-lg);
}
.fields {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  margin-block-end: var(--space-3);
}
.form-error {
  margin-block: 0 var(--space-3);
  color: var(--color-danger-text);
}

.course-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}
.course-row {
  padding: var(--space-4);
}

.row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-block-end: var(--space-3);
}
.card-title {
  margin: 0;
  margin-inline-end: auto;
  font-size: var(--text-lg);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
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

.problems {
  margin-block: 0 var(--space-3);
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-5);
  border-inline-start: 4px solid var(--color-danger-text);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-size: var(--text-sm);
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
