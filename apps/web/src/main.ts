import { createApp, type Directive } from 'vue';
import App from './App.vue';
import { applyDocumentLocale, i18n } from './i18n/index.ts';
import { isLocale } from './i18n/locale.ts';
import { initTheme } from './composables/useTheme.ts';
import { router } from './router.ts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

const startupLocale = i18n.global.locale.value;
applyDocumentLocale(isLocale(startupLocale) ? startupLocale : 'fa');
// Applied before mount so the first paint already has the correct theme.
initTheme();

/**
 * `v-reveal`: fade + rise an element in once it scrolls into view. Uses an
 * IntersectionObserver (never a scroll listener). When the observer is missing or
 * the viewer prefers reduced motion, the element is shown immediately with no motion.
 */
const REVEAL_STORE = new WeakMap<HTMLElement, IntersectionObserver>();
const reveal: Directive<HTMLElement> = {
  mounted(el) {
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-visible');
      return;
    }
    el.classList.add('reveal');
    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            obs.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    observer.observe(el);
    REVEAL_STORE.set(el, observer);
  },
  unmounted(el) {
    REVEAL_STORE.get(el)?.disconnect();
    REVEAL_STORE.delete(el);
  }
};

const app = createApp(App);
app.directive('reveal', reveal);
app.use(i18n).use(router).mount('#app');
