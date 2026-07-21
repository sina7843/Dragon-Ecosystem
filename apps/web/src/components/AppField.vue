<script setup lang="ts">
import { computed } from 'vue';

/**
 * Form field with a persistent label and associated error (A11Y-004, section 13.1).
 *
 * `latin` isolates code-like values — email, URL, username, game ID, transaction
 * ID, SKU — so they keep LTR presentation inside Persian text (section 17.5).
 */
const props = defineProps<{
  id: string;
  label: string;
  modelValue: string;
  // Explicit `| undefined` because the workspace enables exactOptionalPropertyTypes.
  hint?: string | undefined;
  error?: string | undefined;
  type?: string | undefined;
  required?: boolean;
  latin?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [string] }>();

const hintId = computed(() => `${props.id}-hint`);
const errorId = computed(() => `${props.id}-error`);

// Only reference description ids that actually exist, or assistive technology
// announces a dangling reference.
const describedBy = computed(() => {
  const ids = [props.hint === undefined ? null : hintId.value, props.error === undefined ? null : errorId.value];
  const present = ids.filter((id): id is string => id !== null);
  return present.length === 0 ? undefined : present.join(' ');
});

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="field">
    <label :for="props.id">
      {{ props.label }}
      <span
        v-if="props.required"
        aria-hidden="true"
      >*</span>
    </label>

    <input
      :id="props.id"
      :class="{ 'latin-value': props.latin }"
      :type="props.type ?? 'text'"
      :value="props.modelValue"
      :required="props.required"
      :disabled="props.disabled"
      :dir="props.latin ? 'ltr' : undefined"
      :aria-invalid="props.error === undefined ? undefined : 'true'"
      :aria-describedby="describedBy"
      @input="onInput"
    >

    <p
      v-if="props.hint"
      :id="hintId"
      class="hint"
    >
      {{ props.hint }}
    </p>

    <p
      v-if="props.error"
      :id="errorId"
      class="error"
      data-testid="field-error"
    >
      <!-- Status is never carried by colour alone (section 23.2). -->
      <span aria-hidden="true">!</span> {{ props.error }}
    </p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-block-end: var(--space-4);
}

label {
  font-weight: 600;
}

input {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

input[aria-invalid='true'] {
  border-color: var(--color-danger-text);
  border-inline-start-width: 4px;
}

input:disabled {
  background-color: var(--color-surface-sunken);
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-danger-text);
  font-weight: 600;
}
</style>
