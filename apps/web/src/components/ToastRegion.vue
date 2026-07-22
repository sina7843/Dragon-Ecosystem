<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useToasts } from '../composables/useToasts.ts';

/**
 * One controlled status region for transient notifications (A11Y-016).
 * Polite live updates so announcements never interrupt the user mid-task.
 */
const { t } = useI18n();
const { toasts, dismiss } = useToasts();

// An urgent tone interrupts (assertive alert); routine notices are polite. The live
// role lives on each toast, not the container, so the container's label is not re-read
// with every announcement and each toast is announced exactly once on insertion.
function toneRole(tone: string): 'alert' | 'status' {
  return tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
}
function toneLive(tone: string): 'assertive' | 'polite' {
  return tone === 'danger' || tone === 'warning' ? 'assertive' : 'polite';
}
</script>

<template>
  <div
    class="toast-region"
    role="region"
    :aria-label="t('toast.region')"
    data-testid="toast-region"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="['toast', toast.tone]"
      :role="toneRole(toast.tone)"
      :aria-live="toneLive(toast.tone)"
      data-testid="toast"
    >
      <!-- The tone is stated in text, so colour is never the only carrier of meaning. -->
      <span class="tone">{{ t(`toast.tone.${toast.tone}`) }}</span>
      <span class="message">{{ toast.message }}</span>
      <button
        type="button"
        class="dismiss"
        :aria-label="t('toast.dismiss')"
        @click="dismiss(toast.id)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-region {
  position: fixed;
  inset-block-end: var(--space-4);
  inset-inline-end: var(--space-4);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-inline-size: min(24rem, calc(100vw - 2rem));
  /* The empty area around the toasts must never swallow clicks meant for the
     page beneath it (section 22.2: sticky elements must not obscure content). */
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  background-color: var(--color-surface-raised);
}

.tone {
  font-weight: 700;
  font-size: var(--text-sm);
}

.message {
  flex: 1;
}

.toast.info {
  background-color: var(--color-info-surface);
  color: var(--color-info-text);
}
.toast.success {
  background-color: var(--color-success-surface);
  color: var(--color-success-text);
}
.toast.warning {
  background-color: var(--color-warning-surface);
  color: var(--color-warning-text);
}
.toast.danger {
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.dismiss {
  min-inline-size: var(--target-min);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font-size: var(--text-lg);
  cursor: pointer;
}

/**
 * On narrow screens the bottom of the viewport is where primary actions live, so
 * notifications dock to the top instead of covering them (section 22.2).
 */
@media (max-width: 767px) {
  .toast-region {
    inset-block-start: var(--space-2);
    inset-block-end: auto;
    inset-inline: var(--space-2);
    max-inline-size: none;
  }
}
</style>
