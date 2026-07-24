<script setup lang="ts">
import { ref, useId, watch } from 'vue';

/**
 * Accessible dialog (A11Y-006).
 *
 * Built on the native <dialog> element, so focus trapping, Escape handling, focus
 * restoration to the invoker, and inertness of the background come from the
 * platform rather than hand-rolled JavaScript.
 */
const props = defineProps<{ open: boolean; title: string; closeLabel: string; description?: string | undefined }>();
const emit = defineEmits<{ 'update:open': [boolean] }>();

// Unique ids so two dialogs never collide on a fixed id (broken aria / duplicate id).
const titleId = useId();
const descriptionId = useId();

const dialog = ref<HTMLDialogElement | null>(null);

watch(
  () => props.open,
  (open) => {
    const element = dialog.value;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }
);

// Covers Escape and any native close path, keeping the parent state in sync.
function onClose(): void {
  emit('update:open', false);
}
</script>

<template>
  <dialog
    ref="dialog"
    class="dialog"
    :aria-labelledby="titleId"
    :aria-describedby="props.description === undefined ? undefined : descriptionId"
    data-testid="app-dialog"
    @close="onClose"
  >
    <h2
      :id="titleId"
      class="title"
    >
      {{ props.title }}
    </h2>

    <p
      v-if="props.description !== undefined"
      :id="descriptionId"
      class="description"
    >
      {{ props.description }}
    </p>

    <div class="body">
      <slot />
    </div>

    <form
      method="dialog"
      class="actions"
    >
      <button
        type="submit"
        class="btn btn-neutral"
        data-testid="dialog-close"
      >
        {{ props.closeLabel }}
      </button>
      <slot name="actions" />
    </form>
  </dialog>
</template>

<style scoped>
.dialog {
  inline-size: min(32rem, calc(100vw - 2rem));
  /* Long content must never exceed the viewport without a scroll path (320px). */
  max-block-size: calc(100dvh - 2rem);
  overflow: auto;
  padding: var(--space-6);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-xl);
  background-color: var(--color-surface-overlay);
  color: var(--color-text);
  box-shadow: var(--shadow-lg);
}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .dialog {
    background-color: var(--glass-bg);
    border-color: var(--glass-border);
    -webkit-backdrop-filter: blur(var(--glass-blur));
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--glass-highlight), var(--shadow-lg);
  }
}
@media (prefers-reduced-transparency: reduce) {
  .dialog {
    background-color: var(--color-surface-overlay);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

/* Entrance is gated on motion preference via the reduced-motion token (A11Y-010). */
.dialog[open] {
  animation: dialog-in var(--motion-base) var(--motion-ease);
}

@keyframes dialog-in {
  from {
    opacity: 0;
    transform: translateY(0.5rem);
  }
}

.description {
  margin-block: 0 var(--space-3);
  color: var(--color-text-muted);
}

.dialog::backdrop {
  background-color: var(--color-overlay);
}

@supports (backdrop-filter: blur(1px)) {
  .dialog::backdrop {
    backdrop-filter: blur(3px);
  }
}

.title {
  margin-block-start: 0;
}

.body {
  margin-block-end: var(--space-5);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* Modals become full-height sheets on small screens (section 22.2). */
@media (max-width: 767px) {
  .dialog {
    inline-size: 100vw;
    max-inline-size: 100vw;
    block-size: 100dvh;
    max-block-size: 100dvh;
    margin: 0;
    border-radius: 0;
    /* Full-height sheet still scrolls when its content is taller than the viewport. */
    overflow-y: auto;
  }
}
</style>
