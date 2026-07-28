<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationView } from '../composables/useNotificationsApi.ts';
import { resolveTournamentSlugs } from '../composables/useTournamentsApi.ts';
import { formatDateTime, formatRelativeTime, viewerTimeZone } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * In-app notification inbox (DRAGON-13). Each item is localized from its template
 * key + params, with read state. No provider, delivery, or recipient detail is
 * shown. Bilingual (fa RTL / en LTR).
 */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const loading = ref(true);
const loadError = ref<string | undefined>(undefined);
const items = ref<NotificationView[]>([]);
const busy = ref(false);
/** Tournament id → public slug, so a notification can link to what it is about. */
const tournamentSlug = ref<Map<string, string>>(new Map());

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);
const unread = computed(() => items.value.filter((n) => !n.read).length);

/** Renders a notification body from its template key; unknown keys fall back to a generic line. */
function bodyOf(notification: NotificationView): string {
  const key = `notifications.template.${notification.templateKey}`;
  return t(key, notification.params as Record<string, unknown>);
}

/**
 * Where a notification points, when it points anywhere.
 *
 * Every current template is about a tournament and carries its id; the slug lookup below
 * turns that into a link. A notification whose tournament is gone (or was never public)
 * simply has no link rather than a dead one.
 */
function linkOf(notification: NotificationView): string | null {
  const id = notification.params['tournamentId'];
  if (typeof id !== 'string') return null;
  const slug = tournamentSlug.value.get(id);
  return slug === undefined ? null : `${prefix.value}/tournaments/${encodeURIComponent(slug)}`;
}

/** One batched lookup for every tournament the inbox references. */
async function loadLinks(): Promise<void> {
  const ids = [
    ...new Set(items.value.map((n) => n.params['tournamentId']).filter((id): id is string => typeof id === 'string'))
  ];
  if (ids.length === 0) return;
  try {
    const page = await resolveTournamentSlugs(ids, activeLocale.value);
    tournamentSlug.value = new Map(page.items.map((item) => [item.id, item.slug]));
  } catch {
    tournamentSlug.value = new Map(); // Links are a convenience; the inbox still reads fine.
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    items.value = (await listNotifications()).items;
    loadError.value = undefined;
    await loadLinks();
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
          <span class="text">
            <span>{{ bodyOf(notification) }}</span>
            <!-- Relative reads at a glance; the exact time stays in the title. -->
            <time
              class="when"
              :datetime="notification.createdAt"
              :title="formatDateTime(notification.createdAt, activeLocale, viewerTimeZone())"
              :data-testid="`when-${notification.id}`"
            >{{ formatRelativeTime(notification.createdAt, activeLocale) }}</time>
          </span>
        </div>
        <div class="actions">
          <!-- Straight to what the notification is about, so acting on it is one click. -->
          <RouterLink
            v-if="linkOf(notification)"
            class="link"
            :to="linkOf(notification) ?? ''"
            :data-testid="`open-${notification.id}`"
          >
            {{ t('notifications.open') }}
          </RouterLink>
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
        </div>
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
  align-items: baseline;
  min-inline-size: 0;
}

.text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-inline-size: 0;
}

.when {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
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
