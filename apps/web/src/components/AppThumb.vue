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

/**
 * Deterministic hue from the label so a given game/tournament keeps its colour,
 * constrained to the lapis band (212°–267°). An unconstrained hue produced tiles
 * in every colour of the wheel, which fought the palette on every grid.
 */
const hue = computed(() => {
  let h = 0;
  for (const ch of props.label) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return 212 + (h % 56);
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
          `radial-gradient(140% 140% at 88% 0%, hsl(var(--h) 48% 32%), hsl(calc(var(--h) - 14) 55% 12%))`
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
  border-radius: var(--radius-sm);
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

/**
 * Artwork is missing far more often than the design would like, so the fallback
 * has to hold a whole grid without shouting. It is a lapis plate with the same
 * diagonal hatch the page uses, and the initial sits behind it as a watermark
 * rather than a poster letter.
 */
.thumb-fallback {
  display: grid;
  place-items: center;
}

.thumb-fallback::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    115deg,
    rgb(255 255 255 / 6%) 0 1px,
    transparent 1px 14px
  );
}

.thumb-initial {
  font-family: var(--font-display);
  font-variation-settings: 'wdth' var(--display-width);
  font-size: clamp(3rem, 9vw, 6rem);
  font-weight: var(--weight-bold);
  color: rgb(255 255 255 / 20%);
  letter-spacing: var(--tracking-tight);
  line-height: 1;
}
</style>

