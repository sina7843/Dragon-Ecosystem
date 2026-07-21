<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppDialog from '../components/AppDialog.vue';
import AppField from '../components/AppField.vue';
import AppPagination from '../components/AppPagination.vue';
import AppTable, { type TableColumn } from '../components/AppTable.vue';
import StateBlock, { type StateVariant } from '../components/StateBlock.vue';
import { useToasts } from '../composables/useToasts.ts';
import { formatDateTime, formatTomanValue } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Design-system reference.
 *
 * A living catalogue of the shared components and states, used by later prompts
 * and by the browser tests. It contains no product feature and is not indexable;
 * the sample rows are explicitly labelled as samples.
 */
const { t, locale } = useI18n();
const { push } = useToasts();

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));

const STATES: readonly StateVariant[] = ['loading', 'empty', 'error', 'forbidden', 'notFound'];

/* Form ------------------------------------------------------------------- */

const email = ref('');
const emailError = ref<string | undefined>(undefined);
const submitting = ref(false);
const submitted = ref(false);

function validate(): boolean {
  if (email.value.trim() === '') {
    emailError.value = t('form.sample.email.errorRequired');
    return false;
  }
  if (!email.value.includes('@')) {
    emailError.value = t('form.sample.email.errorFormat');
    return false;
  }
  emailError.value = undefined;
  return true;
}

async function onSubmit(): Promise<void> {
  // Duplicate submission is prevented while a request is in flight (section 13.1).
  if (submitting.value) return;
  submitted.value = true;
  if (!validate()) return;

  submitting.value = true;
  // Client-side only: this reference page has no server endpoint. Real forms
  // revalidate authoritatively on the server.
  await new Promise((resolve) => globalThis.setTimeout(resolve, 150));
  submitting.value = false;
  push('success', t('form.sample.success'));
}

/* Table and pagination ---------------------------------------------------- */

const columns: readonly TableColumn[] = [
  { key: 'reference', label: t('table.column.reference'), latin: true },
  { key: 'date', label: t('table.column.date') },
  { key: 'amount', label: t('table.column.amount'), numeric: true }
];

// Sample rows for the catalogue; amounts are stored rial, displayed as Toman.
const SAMPLE_RIAL = [2_500_000, 750_000, 12_000_000];
const SAMPLE_DATES = ['2026-03-21T09:30:00.000Z', '2026-04-02T14:05:00.000Z', '2026-05-19T07:45:00.000Z'];

const rows = computed(() =>
  SAMPLE_RIAL.map((amount, index) => ({
    reference: `TRX-2026-000${String(index + 1)}`,
    date: formatDateTime(SAMPLE_DATES[index] as string, activeLocale.value, 'Asia/Tehran'),
    amount: `${formatTomanValue(amount, activeLocale.value)} ${t('money.tomanUnit')}`
  }))
);

const page = ref(1);
const pageCount = 3;

/* Dialog and toasts -------------------------------------------------------- */

const dialogOpen = ref(false);
</script>

<template>
  <section>
    <h1>{{ t('designSystem.heading') }}</h1>
    <p>{{ t('designSystem.intro') }}</p>

    <h2>{{ t('designSystem.statesHeading') }}</h2>
    <div class="states">
      <StateBlock
        v-for="variant in STATES"
        :key="variant"
        :variant="variant"
      />
    </div>

    <h2>{{ t('designSystem.formHeading') }}</h2>
    <form
      novalidate
      data-testid="sample-form"
      @submit.prevent="onSubmit"
    >
      <!-- Validation summary is announced when it appears (A11Y-005). -->
      <p
        v-if="submitted && emailError"
        class="summary"
        role="alert"
        data-testid="form-error-summary"
      >
        {{ t('form.errorSummary') }}
      </p>

      <AppField
        id="sample-email"
        v-model="email"
        :label="t('form.sample.email.label')"
        :hint="t('form.sample.email.hint')"
        :error="emailError"
        type="email"
        required
        latin
        :disabled="submitting"
      />

      <button
        type="submit"
        class="primary"
        data-testid="form-submit"
        :disabled="submitting"
      >
        {{ submitting ? t('form.sample.submitting') : t('form.sample.submit') }}
      </button>
    </form>

    <h2>{{ t('designSystem.tableHeading') }}</h2>
    <AppTable
      :caption="t('table.sampleCaption')"
      :columns="columns"
      :rows="rows"
      :empty-message="t('table.empty')"
      dense
    />

    <AppPagination
      v-model:page="page"
      class="pagination"
      :page-count="pageCount"
      :label="t('pagination.label')"
      :previous-label="t('pagination.previous')"
      :next-label="t('pagination.next')"
      :page-label="(value: number) => t('pagination.goToPage', { page: value })"
    />

    <h2>{{ t('designSystem.dialogHeading') }}</h2>
    <button
      type="button"
      class="primary"
      data-testid="dialog-open"
      @click="dialogOpen = true"
    >
      {{ t('dialog.sample.open') }}
    </button>

    <AppDialog
      v-model:open="dialogOpen"
      :title="t('dialog.sample.title')"
      :close-label="t('dialog.sample.close')"
    >
      <p>{{ t('dialog.sample.body') }}</p>
    </AppDialog>

    <h2>{{ t('designSystem.notificationsHeading') }}</h2>
    <div class="toast-buttons">
      <button
        type="button"
        data-testid="toast-info"
        @click="push('info', t('toast.sample.info'))"
      >
        {{ t('toast.sample.showInfo') }}
      </button>
      <button
        type="button"
        data-testid="toast-danger"
        @click="push('danger', t('toast.sample.danger'))"
      >
        {{ t('toast.sample.showDanger') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.states {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  margin-block-end: var(--space-6);
}

form {
  max-inline-size: 32rem;
}

.summary {
  padding: var(--space-3);
  border: 1px solid var(--color-danger-text);
  border-radius: var(--radius-md);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-weight: 600;
}

.primary {
  padding-inline: var(--space-4);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
  cursor: pointer;
}

.primary:disabled {
  background-color: var(--color-surface-sunken);
  border-color: var(--color-border);
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.pagination {
  margin-block: var(--space-4) var(--space-6);
}

.toast-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.toast-buttons button {
  padding-inline: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}
</style>
