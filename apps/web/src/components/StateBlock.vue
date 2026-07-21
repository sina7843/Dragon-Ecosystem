<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * The shared page states required by the common page contract (section 10.1):
 * loading, empty, error, forbidden, and not found.
 *
 * Loading is a polite status region so screen-reader users learn that work is in
 * progress without the announcement interrupting them (A11Y-016).
 */
export type StateVariant = 'loading' | 'empty' | 'error' | 'forbidden' | 'notFound';

const props = defineProps<{
  variant: StateVariant;
  /** Overrides for the default localized copy. */
  heading?: string;
  message?: string;
}>();

const { t } = useI18n();

const heading = computed(() => props.heading ?? t(`state.${props.variant}.heading`));
const message = computed(() => props.message ?? t(`state.${props.variant}.message`));
const isLoading = computed(() => props.variant === 'loading');
</script>

<template>
  <div
    :class="['state', props.variant]"
    :role="isLoading ? 'status' : undefined"
    :aria-live="isLoading ? 'polite' : undefined"
    :data-testid="`state-${props.variant}`"
  >
    <span
      v-if="isLoading"
      class="spinner"
      aria-hidden="true"
    />
    <p class="heading">
      {{ heading }}
    </p>
    <p class="message">
      {{ message }}
    </p>
    <slot />
  </div>
</template>

<style scoped>
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface-raised);
  text-align: center;
}

.heading {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
}

.message {
  margin: 0;
  color: var(--color-text-muted);
  max-inline-size: 48ch;
}

/* Each state also differs in text, so colour is never the only signal. */
.error,
.forbidden {
  border-color: var(--color-danger-text);
}

.notFound {
  border-color: var(--color-border-strong);
}

.spinner {
  inline-size: 1.5rem;
  block-size: 1.5rem;
  border: 3px solid var(--color-border);
  border-block-start-color: var(--color-accent);
  border-radius: var(--radius-full);
  animation: spin 900ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
