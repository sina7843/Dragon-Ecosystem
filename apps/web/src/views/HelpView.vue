<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppField from '../components/AppField.vue';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useAuth } from '../composables/useAuth.ts';
import {
  listMySupportCases,
  openSupportCase,
  SUPPORT_CATEGORIES,
  type SupportCaseView,
  type SupportCategory
} from '../composables/useModerationApi.ts';

/**
 * Public help and support entry point (PAGE-023).
 *
 * The page is public because the requirement's audience is, but opening a case requires a
 * session — the API has always been session-gated, so an anonymous visitor is offered sign-in
 * rather than a form that cannot submit.
 *
 * **What this page deliberately does not contain.** PAGE-023 also asks for FAQs and tournament
 * help, and no approved copy for either exists in the repository. Nothing here invents an
 * answer, a contact address, a response time, or an availability promise: a help page that
 * guesses is worse than one that is honest about its scope, and a support promise nobody
 * approved is a commitment the platform has not made. Those clauses stay open, and the
 * traceability row says so rather than this page implying otherwise.
 */

const { t, locale } = useI18n();
const { messageFor, fieldMessage } = useApiErrors();
const { authenticated, loaded, refresh } = useAuth();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = () => `/${activeLocale()}`;

const category = ref<SupportCategory>('account');
const subject = ref('');
const body = ref('');
const submitting = ref(false);
const formError = ref<string | undefined>(undefined);
const subjectError = ref<string | undefined>(undefined);
const bodyError = ref<string | undefined>(undefined);
const submitted = ref<SupportCaseView | null>(null);

const cases = ref<SupportCaseView[]>([]);
const casesLoading = ref(false);
const casesError = ref<string | undefined>(undefined);

const errorSummary = ref<HTMLElement | null>(null);
const successRegion = ref<HTMLElement | null>(null);

const summaryMessage = computed(() =>
  formError.value ?? (subjectError.value === undefined && bodyError.value === undefined ? undefined : t('form.errorSummary'))
);

async function loadCases(): Promise<void> {
  if (!authenticated.value) return;
  casesLoading.value = true;
  casesError.value = undefined;
  try {
    cases.value = (await listMySupportCases()).items;
  } catch (error) {
    casesError.value = messageFor(error);
  } finally {
    casesLoading.value = false;
  }
}

/**
 * Both fields are required by the server too, but a schema rejection arrives without field
 * errors — it would surface as the generic "unexpected error" and never point at the empty
 * box. Checking here is what makes the message specific; the server stays authoritative.
 */
function validate(): boolean {
  subjectError.value = subject.value.trim() === '' ? t('help.contact.subjectRequired') : undefined;
  bodyError.value = body.value.trim() === '' ? t('help.contact.messageRequired') : undefined;
  return subjectError.value === undefined && bodyError.value === undefined;
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  formError.value = undefined;
  submitted.value = null;
  if (!validate()) {
    await nextTick();
    errorSummary.value?.focus();
    return;
  }
  submitting.value = true;
  try {
    submitted.value = await openSupportCase({ category: category.value, subject: subject.value, body: body.value });
    subject.value = '';
    body.value = '';
    await loadCases();
    // Focus moves to the confirmation so a keyboard or screen-reader user is told the
    // outcome rather than being left at a cleared field.
    await nextTick();
    successRegion.value?.focus();
  } catch (error) {
    subjectError.value = fieldMessage(error, 'subject');
    bodyError.value = fieldMessage(error, 'body');
    if (subjectError.value === undefined && bodyError.value === undefined) formError.value = messageFor(error);
    await nextTick();
    errorSummary.value?.focus();
  } finally {
    submitting.value = false;
  }
}

function when(value: string): string {
  return formatDateTime(value, activeLocale(), viewerTimeZone());
}

onMounted(async () => {
  if (!loaded.value) await refresh();
  await loadCases();
});
</script>

<template>
  <section class="stack">
    <h1>{{ t('help.title') }}</h1>
    <p class="muted">
      {{ t('help.intro') }}
    </p>

    <!-- Where the platform already answers questions. These are existing public surfaces,
         not help copy written for this page. -->
    <nav
      class="links"
      :aria-label="t('help.linksHeading')"
      data-testid="help-links"
    >
      <h2>{{ t('help.linksHeading') }}</h2>
      <ul>
        <li>
          <RouterLink :to="`${prefix()}/tournaments`">
            {{ t('help.link.tournaments') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink :to="`${prefix()}/account/registrations`">
            {{ t('help.link.registrations') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink :to="`${prefix()}/account/matches`">
            {{ t('help.link.matches') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink :to="`${prefix()}/search`">
            {{ t('help.link.search') }}
          </RouterLink>
        </li>
      </ul>
    </nav>

    <section class="panel">
      <h2>{{ t('help.contact.heading') }}</h2>
      <p class="muted">
        {{ t('help.contact.intro') }}
      </p>

      <StateBlock
        v-if="!loaded"
        variant="loading"
      />

      <!-- Opening a case needs a session, so an anonymous visitor gets the way in rather
           than a form whose submit could only fail. -->
      <p
        v-else-if="!authenticated"
        data-testid="help-sign-in-required"
      >
        <RouterLink
          class="btn btn-primary"
          :to="`${prefix()}/auth/mobile`"
          data-testid="help-sign-in"
        >
          {{ t('help.contact.signIn') }}
        </RouterLink>
      </p>

      <template v-else>
        <p
          v-if="submitted"
          ref="successRegion"
          class="success"
          role="status"
          tabindex="-1"
          data-testid="help-submitted"
        >
          {{ t('help.contact.submitted', { reference: submitted.id.slice(0, 8) }) }}
        </p>

        <!-- One summary for both kinds of failure: a field that was left empty and a
             request the server refused. Focus moves here either way. -->
        <p
          v-if="summaryMessage"
          ref="errorSummary"
          class="summary"
          role="alert"
          tabindex="-1"
          data-testid="help-error"
        >
          {{ summaryMessage }}
        </p>

        <form
          novalidate
          data-testid="help-form"
          @submit.prevent="submit"
        >
          <label for="support-category">{{ t('help.contact.category') }}</label>
          <select
            id="support-category"
            v-model="category"
            data-testid="support-category"
            :disabled="submitting"
          >
            <option
              v-for="value in SUPPORT_CATEGORIES"
              :key="value"
              :value="value"
            >
              {{ t(`admin.support.category.${value}`) }}
            </option>
          </select>

          <AppField
            id="support-subject"
            v-model="subject"
            :label="t('help.contact.subject')"
            :error="subjectError"
            :disabled="submitting"
            required
          />

          <label for="support-body">{{ t('help.contact.message') }}</label>
          <!-- dir="auto" so a Persian message typed on the English page keeps its own
               direction, and the reverse. -->
          <textarea
            id="support-body"
            v-model="body"
            dir="auto"
            rows="5"
            maxlength="4000"
            data-testid="support-body"
            :disabled="submitting"
            :aria-invalid="bodyError === undefined ? undefined : 'true'"
            :aria-describedby="bodyError === undefined ? undefined : 'support-body-error'"
          />
          <p
            v-if="bodyError"
            id="support-body-error"
            class="error"
            data-testid="support-body-error"
          >
            {{ bodyError }}
          </p>

          <button
            type="submit"
            class="btn btn-primary"
            data-testid="support-submit"
            :disabled="submitting"
          >
            {{ submitting ? t('help.contact.submitting') : t('help.contact.submit') }}
          </button>
        </form>

        <h3>{{ t('help.cases.heading') }}</h3>
        <StateBlock
          v-if="casesLoading"
          variant="loading"
        />
        <StateBlock
          v-else-if="casesError"
          variant="error"
          :message="casesError"
        />
        <p
          v-else-if="cases.length === 0"
          class="muted"
          data-testid="help-cases-empty"
        >
          {{ t('help.cases.empty') }}
        </p>
        <ul
          v-else
          class="cases"
          data-testid="help-cases"
        >
          <li
            v-for="supportCase in cases"
            :key="supportCase.id"
            class="case"
            data-testid="help-case"
          >
            <!-- The subject is user-entered, so it carries its own direction. -->
            <bdi
              class="case-subject"
              dir="auto"
              data-testid="help-case-subject"
            >{{ supportCase.subject }}</bdi>
            <span class="muted">
              {{ t(`admin.support.category.${supportCase.category}`) }}
              ·
              <!-- The operator console's already-approved state and category wording; the
                   requester sees the same vocabulary rather than a second, invented one. -->
              <span data-testid="help-case-state">{{ t(`admin.support.stateValue.${supportCase.state}`) }}</span>
              ·
              <time :datetime="supportCase.createdAt">{{ when(supportCase.createdAt) }}</time>
            </span>
          </li>
        </ul>
      </template>
    </section>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.links ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-5);
}
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-raised);
}
form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-inline-size: 34rem;
}
select,
textarea {
  inline-size: 100%;
  padding: var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-sunken);
  color: var(--color-text);
}
textarea {
  resize: vertical;
}
button {
  align-self: flex-start;
  min-block-size: var(--target-min);
}
.summary,
.success {
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
}
.summary {
  border: 1px solid var(--color-danger-text);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-weight: var(--weight-bold);
}
.success {
  border: 1px solid var(--color-border-strong);
  background-color: var(--color-surface-sunken);
}
.cases {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.case {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.case-subject {
  font-weight: var(--weight-bold);
  overflow-wrap: anywhere;
}
h2,
h3 {
  margin: 0;
  font-size: var(--text-md);
}
</style>
