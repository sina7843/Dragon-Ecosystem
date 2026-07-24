<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * Image-forward thumbnail for portal cards.
 *
 * Renders the same-origin cover image when one is available; otherwise a
 * deterministic inline-SVG tile derived from the label. Both paths are CSP-safe
 * (img-src 'self' data:) — no external hosts, no network. The label doubles as
 * alt text so every card carries accessible, SEO-friendly image semantics.
 */
const props = defineProps<{
  src?: string | null;
  label: string;
  /** aspect-ratio as width/height, e.g. 16/9. Default 16/9. */
  ratio?: number;
}>();

const failed = ref(false);
const showImage = computed(() => Boolean(props.src) && !failed.value);
const ratio = computed(() => props.ratio ?? 16 / 9);

// Deterministic hue from the label so a given game/tournament keeps its colour.
const hue = computed(() => {
  let h = 0;
  for (const ch of props.label) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
});
const initial = computed(() => (props.label.trim()[0] ?? '?').toUpperCase());
</script>

<template>
  <div
    class="thumb"
    :style="{ aspectRatio: String(ratio) }"
  >
    <img
      v-if="showImage"
      class="thumb-img"
      :src="props.src ?? ''"
      :alt="props.label"
      loading="lazy"
      decoding="async"
      @error="failed = true"
    >
    <div
      v-else
      class="thumb-fallback"
      role="img"
      :aria-label="props.label"
      :style="{
        '--h': hue,
        backgroundImage:
          `radial-gradient(120% 120% at 100% 0%, hsl(var(--h) 55% 30%), hsl(calc(var(--h) + 30) 45% 14%))`
      }"
    >
      <span
        class="thumb-initial"
        aria-hidden="true"
      >{{ initial }}</span>
    </div>
  </div>
</template>

<style scoped>
.thumb {
  position: relative;
  inline-size: 100%;
  overflow: hidden;
  border-radius: var(--radius-md);
  background-color: var(--color-surface-sunken);
}

.thumb-img,
.thumb-fallback {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
}

.thumb-img {
  object-fit: cover;
}

.thumb-fallback {
  display: grid;
  place-items: center;
}

.thumb-initial {
  font-family: var(--font-display);
  font-size: clamp(2rem, 6vw, 3.5rem);
  font-weight: var(--weight-bold);
  color: rgb(255 255 255 / 80%);
  letter-spacing: var(--tracking-tight);
}
</style>

