<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { isLocale } from '../i18n/locale.ts';

/**
 * "همراهان و حامیان" (partners and supporters). A logo-only wall that auto-scrolls in a
 * seamless loop (pauses on hover, static under reduced motion). Logos are served from the
 * app's own /partners assets (CSP img-src 'self'). Tiles use the theme surface, so no stark
 * white card appears in dark mode. Two densities: a home section and a compact footer row.
 */
const props = withDefaults(defineProps<{ variant?: 'section' | 'footer' }>(), { variant: 'section' });

const { locale } = useI18n();
const fa = computed(() => (isLocale(locale.value) ? locale.value : 'fa') === 'fa');

// Partner logos brought over from qesb.ir's "همراهان و حامیان" section.
const partners = [
  { src: '/partners/ministry-sport.png', fa: 'وزارت ورزش و جوانان', en: 'Ministry of Sport and Youth' },
  { src: '/partners/prestige.png', fa: 'پرستیژ', en: 'Prestige' },
  { src: '/partners/skadi.png', fa: 'اسکادی', en: 'Skadi' },
  { src: '/partners/elay.jpg', fa: 'ایلای', en: 'Elay' },
  { src: '/partners/partner-1.png', fa: 'فدراسیون ورزش‌های همگانی', en: 'Public Sports Federation' }
];

// The home section auto-scrolls, so its list is doubled for a seamless loop (the clones are
// decorative, aria-hidden). The footer is a plain static row: no animation, no duplicates.
const animated = computed(() => props.variant !== 'footer');
const loop = computed(() =>
  animated.value
    ? [
        ...partners.map((p, i) => ({ p, clone: false, key: `a${i}` })),
        ...partners.map((p, i) => ({ p, clone: true, key: `b${i}` }))
      ]
    : partners.map((p, i) => ({ p, clone: false, key: `a${i}` }))
);

const alt = (p: { fa: string; en: string }): string => (fa.value ? p.fa : p.en);
</script>

<template>
  <div
    :class="['partners-marquee', props.variant]"
    role="group"
    aria-label="partners"
  >
    <ul class="track reset-list">
      <li
        v-for="entry in loop"
        :key="entry.key"
        class="partner"
        :aria-hidden="entry.clone || undefined"
      >
        <img
          :src="entry.p.src"
          :alt="entry.clone ? '' : alt(entry.p)"
          loading="lazy"
          decoding="async"
        >
      </li>
    </ul>
  </div>
</template>

<style scoped>
.reset-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.partners-marquee {
  overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent);
}

.track {
  display: flex;
  inline-size: max-content;
  gap: var(--space-4);
  padding-block: var(--space-1);
  /* Travel follows the writing direction (see the featured rail): negative in LTR,
     positive in RTL, where the track is laid out from the right edge. */
  --marquee-end: -50%;
  animation: partners-scroll 32s linear infinite;
  will-change: transform;
}
[dir='rtl'] .track {
  --marquee-end: 50%;
}
.partners-marquee:hover .track,
.partners-marquee:focus-within .track {
  animation-play-state: paused;
}
@keyframes partners-scroll {
  to {
    /* One full copy; the doubled second copy makes the loop seamless. */
    transform: translateX(var(--marquee-end));
  }
}

.partner {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  inline-size: 10rem;
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface-raised);
  box-shadow: var(--shadow-sm);
}
.partner img {
  inline-size: 100%;
  max-block-size: 4rem;
  object-fit: contain;
}

/* Compact footer row: a static wrapping grid, deliberately not animated. */
.partners-marquee.footer {
  overflow: visible;
  -webkit-mask-image: none;
  mask-image: none;
}
.partners-marquee.footer .track {
  inline-size: auto;
  flex-wrap: wrap;
  gap: var(--space-3);
  animation: none;
  will-change: auto;
}
.partners-marquee.footer .partner {
  inline-size: 7rem;
  padding: var(--space-3);
}
.partners-marquee.footer .partner img {
  max-block-size: 2.75rem;
}

/* Reduced motion: no auto-scroll; fall back to a manual horizontal scroll. */
@media (prefers-reduced-motion: reduce) {
  .partners-marquee {
    overflow-x: auto;
    -webkit-mask-image: none;
    mask-image: none;
  }
  .track {
    animation: none;
  }
}
</style>
