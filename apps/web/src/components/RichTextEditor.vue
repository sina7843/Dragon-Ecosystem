<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uploadImage, UploadRejected, IMAGE_ACCEPT } from '../composables/useMediaApi.ts';
import { ApiRequestError } from '../api.ts';

/**
 * Rich-text body editor for content authoring. Emits HTML restricted to the tags
 * the server sanitizer allows (CONTENT-005): headings, lists, quote/code, links,
 * and images. The server re-sanitizes on save, so this editor is convenience, not
 * the trust boundary — anything it emits outside the allowlist is dropped there.
 *
 * Built on contenteditable + execCommand: no editor dependency, and the output is
 * plain HTML that round-trips through the existing sanitize/render path unchanged.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    /** DOM id on the editable surface, so a <label> or test can target it. */
    editorId?: string | undefined;
    dir?: 'rtl' | 'ltr';
    disabled?: boolean;
  }>(),
  { editorId: undefined, dir: 'ltr', disabled: false }
);

const emit = defineEmits<{ 'update:modelValue': [string] }>();

const { t } = useI18n();
const surface = ref<HTMLDivElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const error = ref<string | undefined>(undefined);
const empty = ref(true);

const accept = IMAGE_ACCEPT;

interface ToolButton {
  key: string;
  run: () => void;
  icon: string;
}

// SVG path data kept inline so the toolbar needs no icon dependency.
const TOOLS: ToolButton[] = [
  { key: 'bold', icon: 'M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z', run: () => exec('bold') },
  { key: 'italic', icon: 'M10 5h7M7 19h7M14 5l-4 14', run: () => exec('italic') },
  { key: 'underline', icon: 'M7 4v6a5 5 0 0010 0V4M5 21h14', run: () => exec('underline') },
  { key: 'strike', icon: 'M5 12h14M8 7a4 3 0 016-1M8 17a4 3 0 006 1', run: () => exec('strikeThrough') },
  { key: 'h2', icon: 'M4 6v12M12 6v12M4 12h8M16 18v-6l3-2v8', run: () => block('h2') },
  { key: 'h3', icon: 'M4 6v12M12 6v12M4 12h8M17 11h3l-2 3a2 2 0 11-2 2', run: () => block('h3') },
  { key: 'ul', icon: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01', run: () => exec('insertUnorderedList') },
  { key: 'ol', icon: 'M10 6h10M10 12h10M10 18h10M4 6h1v4M4 10h2', run: () => exec('insertOrderedList') },
  { key: 'quote', icon: 'M7 7h4v4a4 4 0 01-4 4M15 7h4v4a4 4 0 01-4 4', run: () => block('blockquote') },
  { key: 'code', icon: 'M9 8l-4 4 4 4M15 8l4 4-4 4', run: () => block('pre') },
  { key: 'link', icon: 'M10 14a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1', run: addLink },
  { key: 'image', icon: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5', run: () => fileInput.value?.click() }
];

function focusSurface(): void {
  surface.value?.focus();
}

function exec(command: string): void {
  if (props.disabled) return;
  focusSurface();
  document.execCommand(command, false);
  sync();
}

function block(tag: string): void {
  if (props.disabled) return;
  focusSurface();
  // execCommand wants the tag wrapped in angle brackets for formatBlock.
  document.execCommand('formatBlock', false, `<${tag}>`);
  sync();
}

function addLink(): void {
  if (props.disabled) return;
  focusSurface();
  const url = globalThis.prompt(t('richText.linkPrompt')) ?? '';
  const trimmed = url.trim();
  if (trimmed === '') return;
  // Only http(s) survives the server sanitizer; reject anything else up front.
  if (!/^https?:\/\//i.test(trimmed)) {
    error.value = t('richText.linkInvalid');
    return;
  }
  document.execCommand('createLink', false, trimmed);
  sync();
}

async function onPickImage(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (fileInput.value) fileInput.value.value = '';
  if (file === undefined || uploading.value) return;
  uploading.value = true;
  error.value = undefined;
  try {
    const media = await uploadImage(file);
    focusSurface();
    document.execCommand('insertImage', false, media.url);
    sync();
  } catch (caught) {
    if (caught instanceof UploadRejected) error.value = t(`upload.error.${caught.code}`);
    else if (caught instanceof ApiRequestError) {
      error.value = caught.status === 403 ? t('upload.error.FORBIDDEN') : caught.body.message || t('upload.error.FAILED');
    } else error.value = t('upload.error.FAILED');
  } finally {
    uploading.value = false;
  }
}

/** Push the current DOM back up as HTML, and track emptiness for the placeholder. */
function sync(): void {
  const el = surface.value;
  if (el === null) return;
  const html = el.innerHTML;
  empty.value = el.textContent?.trim() === '' && !html.includes('<img');
  emit('update:modelValue', empty.value ? '' : html);
}

// Only overwrite the DOM when the incoming value genuinely differs, so setting
// v-model from a parent (e.g. loading an item to edit) does not fight the caret.
watch(
  () => props.modelValue,
  (value) => {
    const el = surface.value;
    if (el !== null && el.innerHTML !== value) {
      el.innerHTML = value;
      empty.value = el.textContent?.trim() === '' && !value.includes('<img');
    }
  }
);

onMounted(() => {
  if (surface.value !== null) {
    surface.value.innerHTML = props.modelValue;
    empty.value = surface.value.textContent?.trim() === '' && !props.modelValue.includes('<img');
  }
});
</script>

<template>
  <div class="rich-text">
    <span class="rt-label">{{ props.label }}</span>

    <div
      class="toolbar"
      role="toolbar"
      :aria-label="t('richText.toolbar')"
    >
      <button
        v-for="tool in TOOLS"
        :key="tool.key"
        type="button"
        class="tool"
        :disabled="props.disabled || (tool.key === 'image' && uploading)"
        :title="t(`richText.tool.${tool.key}`)"
        :aria-label="t(`richText.tool.${tool.key}`)"
        @click="tool.run"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="tool.icon" />
        </svg>
      </button>
      <span
        v-if="uploading"
        class="uploading-note"
        role="status"
      >{{ t('upload.uploading') }}</span>
    </div>

    <div class="surface-wrap">
      <div
        :id="props.editorId"
        ref="surface"
        class="surface"
        :class="{ empty }"
        :dir="props.dir"
        :contenteditable="!props.disabled"
        role="textbox"
        aria-multiline="true"
        :aria-label="props.label"
        :data-placeholder="t('richText.placeholder')"
        @input="sync"
        @blur="sync"
      />
    </div>

    <p
      v-if="error"
      class="rt-error"
      role="alert"
    >
      <span aria-hidden="true">!</span> {{ error }}
    </p>

    <input
      ref="fileInput"
      type="file"
      class="visually-hidden"
      :accept="accept"
      @change="onPickImage"
    >
  </div>
</template>

<style scoped>
.rich-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-block-end: var(--space-3);
}

.rt-label {
  font-weight: var(--weight-semibold);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  border-block-end: none;
  background-color: var(--color-surface-sunken);
}

.tool {
  display: inline-grid;
  place-items: center;
  inline-size: 2rem;
  block-size: 2rem;
  min-block-size: auto;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: var(--color-text-soft);
  cursor: pointer;
  transition:
    background-color var(--motion-fast) var(--motion-ease),
    color var(--motion-fast) var(--motion-ease);
}
.tool svg {
  inline-size: 1.05rem;
  block-size: 1.05rem;
}
.tool:hover:not(:disabled) {
  color: var(--color-accent);
  background-color: var(--color-primary-soft);
}
.tool:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.uploading-note {
  margin-inline-start: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.surface-wrap {
  border: 1px solid var(--color-border-strong);
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  background-color: var(--color-surface);
}

.surface {
  min-block-size: 12rem;
  padding: var(--space-3);
  color: var(--color-text);
  outline: none;
  overflow-wrap: anywhere;
}
.surface.empty::before {
  content: attr(data-placeholder);
  color: var(--color-text-muted);
  pointer-events: none;
}

/* Author-facing rendering of the allowed body tags. */
.surface :deep(h2) {
  font-size: var(--text-xl);
  margin-block: var(--space-4) var(--space-2);
}
.surface :deep(h3) {
  font-size: var(--text-lg);
  margin-block: var(--space-3) var(--space-2);
}
.surface :deep(blockquote) {
  margin-inline: 0;
  padding-inline-start: var(--space-3);
  border-inline-start: 3px solid var(--color-primary);
  color: var(--color-text-soft);
}
.surface :deep(pre) {
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-sunken);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  overflow-x: auto;
}
.surface :deep(a) {
  color: var(--color-accent);
}
.surface :deep(img) {
  max-inline-size: 100%;
  block-size: auto;
  border-radius: var(--radius-sm);
}
.surface :deep(ul),
.surface :deep(ol) {
  padding-inline-start: var(--space-5);
}

.rt-error {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-danger-text);
}
</style>
