<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '../api.ts';
import {
  uploadImage,
  UploadRejected,
  IMAGE_ACCEPT,
  MAX_UPLOAD_BYTES
} from '../composables/useMediaApi.ts';

/**
 * Upload center: a reusable image field. Pick or drop an image, it uploads to the
 * media API, publishes, and emits the resulting `/media/<id>` URL. Used for
 * avatars, tournament/game posters, and content cover images.
 *
 * The value is the public URL string (or null when cleared); the parent stores it
 * on whatever resource it owns. Shape only changes the preview frame.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string | null;
    label: string;
    hint?: string | undefined;
    shape?: 'rect' | 'square' | 'circle';
    disabled?: boolean;
  }>(),
  { hint: undefined, shape: 'rect', disabled: false }
);

const emit = defineEmits<{ 'update:modelValue': [string | null] }>();

const { t } = useI18n();
const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const dragging = ref(false);
const error = ref<string | undefined>(undefined);
// Alt text describes the image for screen readers and search engines; it is stored
// on the media record and used as the preview's alt.
const altText = ref('');

const accept = IMAGE_ACCEPT;
const hasImage = computed(() => props.modelValue !== null && props.modelValue !== '');
const maxLabel = computed(() => `${Math.floor(MAX_UPLOAD_BYTES / 1_000_000)} MB`);

function localizeError(caught: unknown): string {
  if (caught instanceof UploadRejected) return t(`upload.error.${caught.code}`);
  // The server re-validates; surface its field code when it rejects.
  if (caught instanceof ApiRequestError) {
    const field = caught.body.fieldErrors[0];
    if (field?.code === 'MEDIA_TOO_LARGE') return t('upload.error.MEDIA_TOO_LARGE');
    if (field?.code === 'UNSUPPORTED_MEDIA_TYPE') return t('upload.error.UNSUPPORTED_MEDIA_TYPE');
    if (caught.status === 403) return t('upload.error.FORBIDDEN');
    return caught.body.message || t('upload.error.FAILED');
  }
  return t('upload.error.FAILED');
}

async function handleFile(file: File | undefined): Promise<void> {
  if (file === undefined || uploading.value || props.disabled) return;
  uploading.value = true;
  error.value = undefined;
  try {
    const alt = altText.value.trim();
    // Same alt for both locales unless the author refines it later in the media library.
    const media = await uploadImage(file, alt === '' ? undefined : { fa: alt, en: alt });
    emit('update:modelValue', media.url);
  } catch (caught) {
    error.value = localizeError(caught);
  } finally {
    uploading.value = false;
    if (input.value) input.value.value = '';
  }
}

function onChange(event: Event): void {
  void handleFile((event.target as HTMLInputElement).files?.[0]);
}

function onDrop(event: DragEvent): void {
  dragging.value = false;
  void handleFile(event.dataTransfer?.files?.[0]);
}

function clear(): void {
  error.value = undefined;
  emit('update:modelValue', null);
}
</script>

<template>
  <div class="image-picker">
    <span class="picker-label">{{ props.label }}</span>

    <div
      :class="['dropzone', `shape-${props.shape}`, { dragging, 'has-image': hasImage }]"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <img
        v-if="hasImage"
        :src="props.modelValue ?? ''"
        :alt="altText.trim() === '' ? props.label : altText"
        class="preview"
      >
      <span
        v-else
        class="placeholder"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="2"
          />
          <circle
            cx="8.5"
            cy="8.5"
            r="1.5"
          />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </span>

      <div
        v-if="uploading"
        class="uploading"
        role="status"
      >
        <span
          class="spinner"
          aria-hidden="true"
        />
        <span>{{ t('upload.uploading') }}</span>
      </div>
    </div>

    <label class="alt-field">
      <span>{{ t('upload.altLabel') }}</span>
      <input
        v-model="altText"
        type="text"
        class="alt-input"
        :placeholder="t('upload.altPlaceholder')"
        :disabled="props.disabled"
        maxlength="300"
      >
    </label>

    <div class="controls">
      <button
        type="button"
        class="btn btn-neutral btn-sm"
        :disabled="props.disabled || uploading"
        @click="input?.click()"
      >
        {{ hasImage ? t('upload.replace') : t('upload.choose') }}
      </button>
      <button
        v-if="hasImage"
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="props.disabled || uploading"
        @click="clear"
      >
        {{ t('upload.remove') }}
      </button>
      <input
        ref="input"
        type="file"
        class="visually-hidden"
        :accept="accept"
        :disabled="props.disabled"
        @change="onChange"
      >
    </div>

    <p
      v-if="error"
      class="picker-error"
      role="alert"
    >
      <span aria-hidden="true">!</span> {{ error }}
    </p>
    <p
      v-else-if="props.hint"
      class="picker-hint"
    >
      {{ props.hint }}
    </p>
    <p class="picker-hint">
      {{ t('upload.accepted', { max: maxLabel }) }}
    </p>
  </div>
</template>

<style scoped>
.image-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-block-end: var(--space-3);
}

.picker-label {
  font-weight: var(--weight-semibold);
}

.dropzone {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  inline-size: 100%;
  aspect-ratio: 16 / 9;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface-sunken);
  color: var(--color-text-muted);
}
.dropzone.shape-square {
  inline-size: 9rem;
  aspect-ratio: 1;
}
.dropzone.shape-circle {
  inline-size: 7rem;
  aspect-ratio: 1;
  border-radius: var(--radius-full);
}
.dropzone.dragging {
  border-style: solid;
  border-color: var(--color-primary);
  background-color: var(--color-primary-soft);
}
.dropzone.has-image {
  border-style: solid;
  border-color: var(--color-border);
}

.preview {
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
}

.placeholder svg {
  inline-size: 2.5rem;
  block-size: 2.5rem;
}

.uploading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  gap: var(--space-2);
  grid-auto-flow: row;
  background-color: var(--color-overlay);
  color: var(--color-text);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}
.spinner {
  inline-size: 1.5rem;
  block-size: 1.5rem;
  border: 2px solid currentColor;
  border-inline-end-color: transparent;
  border-radius: var(--radius-full);
  animation: picker-spin 0.6s linear infinite;
}
@keyframes picker-spin {
  to {
    transform: rotate(360deg);
  }
}

.alt-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.alt-field > span {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}
.alt-input {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}
.alt-input::placeholder {
  color: var(--color-text-muted);
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.btn-sm {
  padding-block: var(--space-2);
  padding-inline: var(--space-3);
  font-size: var(--text-sm);
  min-block-size: auto;
}

.picker-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.picker-error {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-danger-text);
}
</style>
