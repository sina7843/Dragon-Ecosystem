<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useToasts } from '../composables/useToasts.ts';

import { computed } from 'vue';

/**
 * One controlled status region for transient notifications (A11Y-016).
 *
 * Announcements come from two live regions that are mounted for the lifetime of the app
 * and start empty. Assistive technology only reliably announces text inserted *into* an
 * existing live region; a region added to the DOM together with its text is commonly
 * missed, which is what happened when `aria-live` sat on each toast element. The visible
 * toasts are therefore `aria-hidden` decoration, and the two mirrors below carry the
 * announcement: polite for routine notices, assertive for urgent ones.
 */
const { t } = useI18n();
const { toasts, dismiss } = useToasts();

function isUrgent(tone: string): boolean {
  return tone === 'danger' || tone === 'warning';
}

/** Announcement text, split by urgency so each lands in the right live region. */
const politeText = computed(() =>
  toasts.value.filter((x) => !isUrgent(x.tone)).map((x) => `${t(`toast.tone.${x.tone}`)}: ${x.message}`).join('. ')
);
const assertiveText = computed(() =>
  toasts.value.filter((x) => isUrgent(x.tone)).map((x) => `${t(`toast.tone.${x.tone}`)}: ${x.message}`).join('. ')
);
</script>

<template>
  <div
    class="toast-region"
    role="region"
    :aria-label="t('toast.region')"
    data-testid="toast-region"
  >
    <!-- Always-mounted, initially empty live regions. Text is inserted into them, which
         is the only reliably announced pattern. -->
    <div
      class="visually-hidden"
      role="status"
      aria-live="polite"
      data-testid="toast-live-polite"
    >
      {{ politeText }}
    </div>
    <div
      class="visually-hidden"
      role="alert"
      aria-live="assertive"
      data-testid="toast-live-assertive"
    >
      {{ assertiveText }}
    </div>

    <!-- Visible presentation only; the announcement is handled above, so these are
         hidden from assistive technology to avoid reading each toast twice. The dismiss
         control stays reachable because it lives outside the hidden subtree. -->
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="['toast', toast.tone]"
      data-testid="toast"
    >
      <span
        class="toast-text"
        aria-hidden="true"
      >
        <!-- The tone is stated in text, so colour is never the only carrier of meaning. -->
        <span class="tone">{{ t(`toast.tone.${toast.tone}`) }}</span>
        <span class="message">{{ toast.message }}</span>
      </span>
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

/* A notification is a plate with a lit leading edge in its own tone, so the tone
   is legible from shape and position before the colour registers. */
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid currentColor;
  border-inline-start-width: 4px;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  background-color: var(--color-surface-raised);
}

.toast-text {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-inline-size: 0;
}

.tone {
  font-family: var(--font-mono);
  font-weight: var(--weight-bold);
  font-size: var(--text-xs);
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
}
[lang='fa'] .tone {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  letter-spacing: normal;
  text-transform: none;
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
