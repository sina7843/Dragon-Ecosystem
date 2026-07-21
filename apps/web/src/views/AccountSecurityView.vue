<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppTable, { type TableColumn } from '../components/AppTable.vue';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { formatDateTime } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Sessions and security history (PAGE-014, AUTH-006, AUTH-013).
 * Revoking other sessions requires recent authentication, enforced server-side.
 */
interface SessionView {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent?: string;
  current: boolean;
}

interface SecurityEventView {
  type: string;
  occurredAt: string;
}

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const loading = ref(true);
const error = ref<string | undefined>(undefined);
const sessions = ref<SessionView[]>([]);
const events = ref<SecurityEventView[]>([]);

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));

const sessionColumns = computed<TableColumn[]>(() => [
  { key: 'createdAt', label: t('security.sessions.created') },
  { key: 'lastSeenAt', label: t('security.sessions.lastSeen') },
  { key: 'current', label: t('security.sessions.current') }
]);

const eventColumns = computed<TableColumn[]>(() => [
  { key: 'type', label: t('security.events.type') },
  { key: 'occurredAt', label: t('security.events.time') }
]);

const sessionRows = computed(() =>
  sessions.value.map((session) => ({
    createdAt: formatDateTime(session.createdAt, activeLocale.value, 'Asia/Tehran'),
    lastSeenAt: formatDateTime(session.lastSeenAt, activeLocale.value, 'Asia/Tehran'),
    current: session.current ? t('security.sessions.yes') : t('security.sessions.no')
  }))
);

const eventRows = computed(() =>
  events.value.map((event) => ({
    // Event codes use dots, which vue-i18n reads as path separators, so the key
    // uses underscores. Localized, never shown as a raw code (I18N-009).
    type: t(`security.eventType.${event.type.replaceAll('.', '_')}`),
    occurredAt: formatDateTime(event.occurredAt, activeLocale.value, 'Asia/Tehran')
  }))
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    [sessions.value, events.value] = await Promise.all([
      apiFetch<SessionView[]>('/account/sessions'),
      apiFetch<SecurityEventView[]>('/account/security-events')
    ]);
    error.value = undefined;
  } catch (caught) {
    error.value = messageFor(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function revokeOthers(): Promise<void> {
  try {
    const result = await apiFetch<{ revoked: number }>('/account/sessions/revoke-others', { method: 'POST' });
    push('success', t('security.sessions.revoked', { count: result.revoked }));
    await load();
  } catch (caught) {
    push('danger', messageFor(caught));
  }
}
</script>

<template>
  <section>
    <h1>{{ t('security.heading') }}</h1>
    <p>{{ t('security.intro') }}</p>

    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="error"
      variant="error"
      :message="error"
    />

    <template v-else>
      <h2>{{ t('security.sessions.heading') }}</h2>
      <AppTable
        :caption="t('security.sessions.caption')"
        :columns="sessionColumns"
        :rows="sessionRows"
        :empty-message="t('security.sessions.empty')"
      />
      <button
        type="button"
        class="revoke"
        data-testid="revoke-others"
        @click="revokeOthers"
      >
        {{ t('security.sessions.revokeOthers') }}
      </button>

      <h2>{{ t('security.events.heading') }}</h2>
      <AppTable
        :caption="t('security.events.caption')"
        :columns="eventColumns"
        :rows="eventRows"
        :empty-message="t('security.events.empty')"
        dense
      />
    </template>
  </section>
</template>

<style scoped>
.revoke {
  margin-block: var(--space-4) var(--space-6);
  padding-inline: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}
</style>
