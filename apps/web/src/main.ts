import { createApp } from 'vue';
import App from './App.vue';
import { applyDocumentLocale, i18n } from './i18n/index.ts';
import { isLocale } from './i18n/locale.ts';
import { router } from './router.ts';

const startupLocale = i18n.global.locale.value;
applyDocumentLocale(isLocale(startupLocale) ? startupLocale : 'fa');

createApp(App).use(i18n).use(router).mount('#app');
