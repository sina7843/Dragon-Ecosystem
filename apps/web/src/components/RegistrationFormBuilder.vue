<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * Registration form builder: the organizer's side of a tournament's entry form.
 *
 * The server owns every rule (allowed types, at least two options on a choice question,
 * contiguous page numbers, both locales present). This component's job is to make those
 * rules easy to satisfy — it keeps pages contiguous as questions move and seeds an option
 * pair when a choice type is picked — but it never validates on the server's behalf, so a
 * form that slips through here is still refused on save with a field error.
 */
export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'national_id'
  | 'single_choice'
  | 'multi_choice'
  | 'file'
  | 'image';

export interface QuestionDraft {
  key: string;
  prompt: { fa: string; en: string };
  type: QuestionType;
  required: boolean;
  page: number;
  options: Array<{ fa: string; en: string }>;
}

const TYPES: readonly QuestionType[] = [
  'short_text',
  'long_text',
  'number',
  'national_id',
  'single_choice',
  'multi_choice',
  'file',
  'image'
];

/** Types that present a fixed option list; the server requires at least two. */
const CHOICE_TYPES: readonly QuestionType[] = ['single_choice', 'multi_choice'];

const props = defineProps<{ modelValue: QuestionDraft[] }>();
const emit = defineEmits<{ 'update:modelValue': [QuestionDraft[]] }>();

const { t } = useI18n();

const questions = computed(() => props.modelValue);
const pageCount = computed(() => questions.value.reduce((max, q) => Math.max(max, q.page), 1));

/** Questions grouped by page, so the builder mirrors what an entrant will step through. */
const pages = computed(() =>
  Array.from({ length: pageCount.value }, (_, i) => ({
    page: i + 1,
    items: questions.value.filter((q) => q.page === i + 1)
  }))
);

function update(next: QuestionDraft[]): void {
  emit('update:modelValue', next);
}

function isChoice(type: QuestionType): boolean {
  return CHOICE_TYPES.includes(type);
}

function addQuestion(page: number): void {
  const nextIndex = questions.value.length + 1;
  update([
    ...questions.value,
    {
      key: `q${String(nextIndex)}`,
      prompt: { fa: '', en: '' },
      type: 'short_text',
      required: false,
      page,
      options: []
    }
  ]);
}

function removeQuestion(index: number): void {
  const next = questions.value.filter((_, i) => i !== index);
  update(renumberPages(next));
}

/**
 * Closes any page a removal emptied. The server rejects a form whose pages skip a
 * number, so keeping them contiguous here means an organizer never has to work out why
 * a save failed after deleting the last question on a step.
 */
function renumberPages(list: QuestionDraft[]): QuestionDraft[] {
  const used = [...new Set(list.map((q) => q.page))].sort((a, b) => a - b);
  const remap = new Map(used.map((page, i) => [page, i + 1]));
  return list.map((q) => ({ ...q, page: remap.get(q.page) ?? 1 }));
}

function patch(index: number, change: Partial<QuestionDraft>): void {
  update(questions.value.map((q, i) => (i === index ? { ...q, ...change } : q)));
}

/** Switching to a choice type seeds two blank options, which is the minimum the server takes. */
function onTypeChange(index: number, type: QuestionType): void {
  const current = questions.value[index];
  if (current === undefined) return;
  const options = isChoice(type) && current.options.length < 2
    ? [{ fa: '', en: '' }, { fa: '', en: '' }]
    : isChoice(type)
      ? current.options
      : [];
  patch(index, { type, options });
}

function addOption(index: number): void {
  const current = questions.value[index];
  if (current === undefined) return;
  patch(index, { options: [...current.options, { fa: '', en: '' }] });
}

function removeOption(index: number, optionIndex: number): void {
  const current = questions.value[index];
  if (current === undefined) return;
  patch(index, { options: current.options.filter((_, i) => i !== optionIndex) });
}

function move(index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= questions.value.length) return;
  const next = [...questions.value];
  const moved = next[index] as QuestionDraft;
  next[index] = next[target] as QuestionDraft;
  next[target] = moved;
  update(next);
}

function addPage(): void {
  addQuestion(pageCount.value + 1);
}

function indexOf(question: QuestionDraft): number {
  return questions.value.indexOf(question);
}
</script>

<template>
  <fieldset class="builder">
    <legend>{{ t('formBuilder.legend') }}</legend>
    <p class="hint">
      {{ t('formBuilder.hint') }}
    </p>

    <div
      v-for="group in pages"
      :key="group.page"
      class="page-group"
      :data-testid="`form-page-${group.page}`"
    >
      <div class="page-head">
        <h4>{{ t('formBuilder.page', { n: group.page }) }}</h4>
        <button
          type="button"
          class="btn btn-ghost"
          :data-testid="`add-question-page-${group.page}`"
          @click="addQuestion(group.page)"
        >
          {{ t('formBuilder.addQuestion') }}
        </button>
      </div>

      <p
        v-if="group.items.length === 0"
        class="hint"
      >
        {{ t('formBuilder.emptyPage') }}
      </p>

      <div
        v-for="question in group.items"
        :key="question.key"
        class="question"
        :data-testid="`question-${question.key}`"
      >
        <div class="row">
          <label :for="`q-prompt-fa-${question.key}`">
            <span>{{ t('formBuilder.promptFa') }}</span>
            <input
              :id="`q-prompt-fa-${question.key}`"
              :value="question.prompt.fa"
              type="text"
              :data-testid="`prompt-fa-${question.key}`"
              @input="patch(indexOf(question), { prompt: { ...question.prompt, fa: ($event.target as HTMLInputElement).value } })"
            >
          </label>
          <label :for="`q-prompt-en-${question.key}`">
            <span>{{ t('formBuilder.promptEn') }}</span>
            <input
              :id="`q-prompt-en-${question.key}`"
              :value="question.prompt.en"
              type="text"
              :data-testid="`prompt-en-${question.key}`"
              @input="patch(indexOf(question), { prompt: { ...question.prompt, en: ($event.target as HTMLInputElement).value } })"
            >
          </label>
        </div>

        <div class="row">
          <label :for="`q-type-${question.key}`">
            <span>{{ t('formBuilder.type') }}</span>
            <select
              :id="`q-type-${question.key}`"
              :value="question.type"
              :data-testid="`type-${question.key}`"
              @change="onTypeChange(indexOf(question), ($event.target as HTMLSelectElement).value as QuestionType)"
            >
              <option
                v-for="type in TYPES"
                :key="type"
                :value="type"
              >
                {{ t(`formBuilder.typeValue.${type}`) }}
              </option>
            </select>
          </label>

          <label :for="`q-page-${question.key}`">
            <span>{{ t('formBuilder.onPage') }}</span>
            <select
              :id="`q-page-${question.key}`"
              :value="String(question.page)"
              :data-testid="`page-${question.key}`"
              @change="update(renumberPages(questions.map((q, i) => (i === indexOf(question) ? { ...q, page: Number(($event.target as HTMLSelectElement).value) } : q))))"
            >
              <option
                v-for="n in pageCount"
                :key="n"
                :value="String(n)"
              >
                {{ t('formBuilder.page', { n }) }}
              </option>
            </select>
          </label>

          <label class="check">
            <input
              type="checkbox"
              :checked="question.required"
              :data-testid="`required-${question.key}`"
              @change="patch(indexOf(question), { required: ($event.target as HTMLInputElement).checked })"
            >
            <span>{{ t('formBuilder.required') }}</span>
          </label>
        </div>

        <!-- Choice questions carry their own option list, in both languages. -->
        <div
          v-if="isChoice(question.type)"
          class="options"
        >
          <div
            v-for="(option, optionIndex) in question.options"
            :key="optionIndex"
            class="row option-row"
          >
            <label :for="`opt-fa-${question.key}-${optionIndex}`">
              <span>{{ t('formBuilder.optionFa', { n: optionIndex + 1 }) }}</span>
              <input
                :id="`opt-fa-${question.key}-${optionIndex}`"
                :value="option.fa"
                type="text"
                @input="patch(indexOf(question), { options: question.options.map((o, i) => (i === optionIndex ? { ...o, fa: ($event.target as HTMLInputElement).value } : o)) })"
              >
            </label>
            <label :for="`opt-en-${question.key}-${optionIndex}`">
              <span>{{ t('formBuilder.optionEn', { n: optionIndex + 1 }) }}</span>
              <input
                :id="`opt-en-${question.key}-${optionIndex}`"
                :value="option.en"
                type="text"
                @input="patch(indexOf(question), { options: question.options.map((o, i) => (i === optionIndex ? { ...o, en: ($event.target as HTMLInputElement).value } : o)) })"
              >
            </label>
            <button
              type="button"
              class="btn btn-ghost"
              :disabled="question.options.length <= 2"
              :aria-label="t('formBuilder.removeOption')"
              @click="removeOption(indexOf(question), optionIndex)"
            >
              ×
            </button>
          </div>
          <button
            type="button"
            class="btn btn-ghost"
            :data-testid="`add-option-${question.key}`"
            @click="addOption(indexOf(question))"
          >
            {{ t('formBuilder.addOption') }}
          </button>
        </div>

        <div class="question-actions">
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="indexOf(question) === 0"
            :aria-label="t('formBuilder.moveUp')"
            @click="move(indexOf(question), -1)"
          >
            ↑
          </button>
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="indexOf(question) === questions.length - 1"
            :aria-label="t('formBuilder.moveDown')"
            @click="move(indexOf(question), 1)"
          >
            ↓
          </button>
          <button
            type="button"
            class="btn btn-ghost danger"
            :data-testid="`remove-${question.key}`"
            @click="removeQuestion(indexOf(question))"
          >
            {{ t('formBuilder.removeQuestion') }}
          </button>
        </div>
      </div>
    </div>

    <div class="builder-actions">
      <button
        type="button"
        class="btn btn-secondary"
        data-testid="add-question"
        @click="addQuestion(1)"
      >
        {{ t('formBuilder.addQuestion') }}
      </button>
      <button
        type="button"
        class="btn btn-ghost"
        data-testid="add-page"
        @click="addPage"
      >
        {{ t('formBuilder.addPage') }}
      </button>
    </div>
  </fieldset>
</template>

<style scoped>
.builder {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.page-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
}

.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.page-head h4 {
  margin: 0;
}

.question {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-sunken);
}

.row {
  display: grid;
  gap: var(--space-2);
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  align-items: end;
}

.row label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-sm);
}

.check {
  flex-direction: row !important;
  align-items: center;
  gap: var(--space-2);
}

input[type='text'],
select {
  inline-size: 100%;
  padding: var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.options {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-inline-start: var(--space-3);
  border-inline-start: 2px solid var(--color-border-strong);
}

.option-row {
  align-items: end;
}

.question-actions,
.builder-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.danger {
  color: var(--color-danger);
}
</style>
