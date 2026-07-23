import { createApp } from 'vue';
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

createApp(App).use(i18n).use(router).mount('#app');
