<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationView } from '../composables/useNotificationsApi.ts';

/**
 * In-app notification inbox (DRAGON-13). Each item is localized from its template
 * key + params, with read state. No provider, delivery, or recipient detail is
 * shown. Bilingual (fa RTL / en LTR).
 */

const { t } = useI18n();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const loading = ref(true);
const loadError = ref<string | undefined>(undefined);
const items = ref<NotificationView[]>([]);
const busy = ref(false);

const unread = computed(() => items.value.filter((n) => !n.read).length);

/** Renders a notification body from its template key; unknown keys fall back to a generic line. */
function bodyOf(notification: NotificationView): string {
  const key = `notifications.template.${notification.templateKey}`;
  return t(key, notification.params as Record<string, unknown>);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    items.value = (await listNotifications()).items;
    loadError.value = undefined;
  } catch (caught) {
    loadError.value = messageFor(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function readOne(notification: NotificationView): Promise<void> {
  if (notification.read || busy.value) return;
  busy.value = true;
  try {
    await markNotificationRead(notification.id);
    notification.read = true;
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = false;
  }
}

async function readAll(): Promise<void> {
  if (busy.value || unread.value === 0) return;
  busy.value = true;
  try {
    await markAllNotificationsRead();
    items.value = items.value.map((n) => ({ ...n, read: true }));
    push('success', t('notifications.allRead'));
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section>
    <div class="head">
      <h1>{{ t('notifications.heading') }}</h1>
      <button
        v-if="unread > 0"
        type="button"
        class="secondary"
        data-testid="mark-all-read"
        :disabled="busy"
        @click="readAll"
      >
        {{ t('notifications.markAllRead') }}
      </button>
    </div>

    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="loadError"
      variant="error"
      :message="loadError"
    />
    <StateBlock
      v-else-if="items.length === 0"
      variant="empty"
      data-testid="no-notifications"
      :message="t('notifications.empty')"
    />

    <ul
      v-else
      class="inbox"
      data-testid="notification-list"
    >
      <li
        v-for="notification in items"
        :key="notification.id"
        :data-testid="`notification-${notification.id}`"
        :data-read="notification.read ? 'read' : 'unread'"
        :class="{ unread: !notification.read }"
      >
        <div class="body">
          <strong
            v-if="!notification.read"
            class="dot"
            aria-hidden="true"
          >•</strong>
          <span>{{ bodyOf(notification) }}</span>
        </div>
        <button
          v-if="!notification.read"
          type="button"
          class="link"
          :data-testid="`read-${notification.id}`"
          :disabled="busy"
          @click="readOne(notification)"
        >
          {{ t('notifications.markRead') }}
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
}

.inbox {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.inbox li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.inbox li.unread {
  border-color: var(--color-accent);
}

.body {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.dot {
  color: var(--color-accent);
}

.secondary {
  padding-inline: var(--space-4);
  padding-block: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.link {
  border: none;
  background: none;
  color: var(--color-accent);
  cursor: pointer;
  padding: 0;
}
</style>
