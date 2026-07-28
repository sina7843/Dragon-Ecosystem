<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { PublicQuestion } from '../composables/useTournamentsApi.ts';

/**
 * One question on a tournament's registration form.
 *
 * Each question renders as its own component instance rather than as a branch in a long
 * `v-if` chain inside the form. That chain mixed `<input>`, `<select>`, `<textarea>` and a
 * multi-root branch as siblings, and Vue reused DOM nodes across those branches: once a
 * numeric field was populated the surrounding subtree stopped responding to events at all.
 * A component per question gives every field its own render scope and its own lifecycle.
 */
const props = defineProps<{
  question: PublicQuestion;
  modelValue: string;
  error?: string | undefined;
  uploading?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [string]; upload: [File] }>();

const { t } = useI18n();

const fieldId = `q-${props.question.key}`;

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
}

/** Multi-choice travels as a comma-separated index list, matching the API contract. */
function selected(): number[] {
  return props.modelValue === '' ? [] : props.modelValue.split(',').map(Number).filter(Number.isInteger);
}
function onToggle(index: number, checked: boolean): void {
  const current = new Set(selected());
  if (checked) current.add(index);
  else current.delete(index);
  emit('update:modelValue', [...current].sort((a, b) => a - b).join(','));
}

function onFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file !== undefined) emit('upload', file);
  input.value = '';
}
</script>

<template>
  <div
    class="field"
    :data-testid="`field-${props.question.key}`"
  >
    <label :for="fieldId">
      {{ props.question.prompt }}
      <span
        v-if="props.question.required"
        class="required-mark"
        :aria-label="t('registration.requiredField')"
      >*</span>
    </label>

    <select
      v-if="props.question.type === 'single_choice'"
      :id="fieldId"
      :value="props.modelValue"
      :required="props.question.required"
      @change="onInput"
    >
      <option value="">
        {{ t('registration.choosePrompt') }}
      </option>
      <option
        v-for="(option, index) in props.question.options"
        :key="index"
        :value="String(index)"
      >
        {{ option }}
      </option>
    </select>

    <fieldset
      v-else-if="props.question.type === 'multi_choice'"
      class="choices"
    >
      <legend class="visually-hidden">
        {{ props.question.prompt }}
      </legend>
      <label
        v-for="(option, index) in props.question.options"
        :key="index"
        class="choice"
      >
        <input
          type="checkbox"
          :checked="selected().includes(index)"
          :data-testid="`choice-${props.question.key}-${index}`"
          @change="onToggle(index, ($event.target as HTMLInputElement).checked)"
        >
        <span>{{ option }}</span>
      </label>
    </fieldset>

    <textarea
      v-else-if="props.question.type === 'long_text'"
      :id="fieldId"
      :value="props.modelValue"
      rows="4"
      :required="props.question.required"
      @input="onInput"
    />

    <!-- The answer carries the uploaded asset's path, never its bytes. -->
    <div
      v-else-if="props.question.type === 'file' || props.question.type === 'image'"
      class="upload-field"
    >
      <input
        :id="fieldId"
        type="file"
        :accept="props.question.type === 'image' ? 'image/*' : undefined"
        :data-testid="`upload-${props.question.key}`"
        @change="onFile"
      >
      <p
        v-if="props.uploading"
        class="muted"
      >
        {{ t('upload.uploading') }}
      </p>
      <p
        v-else-if="props.modelValue !== ''"
        class="muted"
        :data-testid="`uploaded-${props.question.key}`"
      >
        {{ t('registration.fileAttached') }}
      </p>
    </div>

    <input
      v-else-if="props.question.type === 'number'"
      :id="fieldId"
      :value="props.modelValue"
      type="number"
      inputmode="decimal"
      :required="props.question.required"
      @input="onInput"
    >

    <input
      v-else-if="props.question.type === 'national_id'"
      :id="fieldId"
      :value="props.modelValue"
      type="text"
      inputmode="numeric"
      maxlength="10"
      autocomplete="off"
      :required="props.question.required"
      @input="onInput"
    >

    <input
      v-else
      :id="fieldId"
      :value="props.modelValue"
      type="text"
      :required="props.question.required"
      @input="onInput"
    >

    <p
      v-if="props.error"
      class="field-error"
      role="alert"
      :data-testid="`error-${props.question.key}`"
    >
      {{ props.error }}
    </p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-block-end: var(--space-3);
}

label {
  font-weight: var(--weight-semibold);
  font-size: var(--text-sm);
}

.required-mark {
  color: var(--color-danger);
}

input[type='text'],
input[type='number'],
input[type='file'],
select,
textarea {
  inline-size: 100%;
  padding: var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}

.choices {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.choice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: var(--weight-regular);
}

.muted {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.field-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-sm);
}
</style>
