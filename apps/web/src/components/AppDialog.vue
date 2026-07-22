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

    <form method="dialog">
      <button
        type="submit"
        data-testid="dialog-close"
      >
        {{ props.closeLabel }}
      </button>
    </form>
  </dialog>
</template>

<style scoped>
.dialog {
  inline-size: min(32rem, calc(100vw - 2rem));
  /* Long content must never exceed the viewport without a scroll path (320px). */
  max-block-size: calc(100dvh - 2rem);
  overflow: auto;
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-lg);
}

.description {
  margin-block: 0 var(--space-3);
  color: var(--color-text-muted);
}

.dialog::backdrop {
  background-color: rgb(0 0 0 / 55%);
}

.title {
  margin-block-start: 0;
}

.body {
  margin-block-end: var(--space-4);
}

button {
  padding-inline: var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
  cursor: pointer;
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
