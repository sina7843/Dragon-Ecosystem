<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppField from '../components/AppField.vue';
import StateBlock from '../components/StateBlock.vue';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import {
  banChatUser,
  getModeratorFeed,
  liftChatRestriction,
  listChatRestrictions,
  listChatRooms,
  removeChatMessage,
  setChatRoomState,
  timeoutChatUser,
  type ChatMessage,
  type ChatRestriction,
  type ChatRoom
} from '../composables/useChatApi.ts';

/**
 * Chat moderation console (PAGE-053).
 *
 * The moderator feed keeps the retained body of a removed message, because that is the
 * evidence a case is reviewed against (CHAT-005) — the viewer feed deliberately does not.
 * Every action here is scope-limited server-side to the room it names (ROLE-013); hiding a
 * control is presentation, never the boundary.
 */

const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const DEFAULT_TIMEOUT_SECONDS = 600;

const loading = ref(true);
const listError = ref<string | undefined>(undefined);
const rooms = ref<ChatRoom[]>([]);
const selected = ref<ChatRoom | null>(null);
const messages = ref<ChatMessage[]>([]);
const restrictions = ref<ChatRestriction[]>([]);
const busy = ref('');

/** Per-row reason drafts, so an action always records why it was taken. */
const reasons = reactive<Record<string, string>>({});

async function loadRooms(): Promise<void> {
  loading.value = true;
  try {
    rooms.value = (await listChatRooms()).items;
    listError.value = undefined;
  } catch (caught) {
    listError.value = messageFor(caught);
  } finally {
    loading.value = false;
  }
}

async function selectRoom(room: ChatRoom): Promise<void> {
  selected.value = room;
  try {
    const [feed, limits] = await Promise.all([getModeratorFeed(room.id), listChatRestrictions(room.id)]);
    messages.value = feed.items;
    restrictions.value = limits.items;
  } catch (caught) {
    push('danger', messageFor(caught));
  }
}

onMounted(async () => {
  await refreshCaps();
  await loadRooms();
});

/** Runs one moderator action, keeping the busy state and error handling in one place. */
async function run(key: string, action: () => Promise<unknown>, successKey: string): Promise<void> {
  if (busy.value !== '') return;
  busy.value = key;
  try {
    await action();
    push('success', t(successKey));
    await loadRooms();
    if (selected.value !== null) {
      const refreshed = rooms.value.find((r) => r.id === selected.value?.id);
      await selectRoom(refreshed ?? selected.value);
    }
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = '';
  }
}

function reasonFor(key: string): string {
  return (reasons[key] ?? '').trim();
}

function remove(message: ChatMessage): void {
  const room = selected.value;
  if (room === null || reasonFor(message.id) === '') return;
  void run(message.id, () => removeChatMessage(room.id, message.id, reasonFor(message.id)), 'adminChat.removed');
}

function timeoutSender(message: ChatMessage): void {
  const room = selected.value;
  if (room === null || reasonFor(message.id) === '') return;
  void run(
    message.id,
    () => timeoutChatUser(message.senderId, { roomId: room.id, reason: reasonFor(message.id), durationSeconds: DEFAULT_TIMEOUT_SECONDS }),
    'adminChat.timedOut'
  );
}

function banSender(message: ChatMessage): void {
  const room = selected.value;
  if (room === null || reasonFor(message.id) === '') return;
  void run(message.id, () => banChatUser(message.senderId, { roomId: room.id, reason: reasonFor(message.id) }), 'adminChat.banned');
}

function lift(restriction: ChatRestriction): void {
  const room = selected.value;
  if (room === null) return;
  void run(restriction.id, () => liftChatRestriction(room.id, restriction.id, t('adminChat.liftReason')), 'adminChat.lifted');
}

function toggleRoom(room: ChatRoom): void {
  const next = room.state === 'open' ? 'closed' : 'open';
  void run(room.id, () => setChatRoomState(room.id, { state: next, expectedVersion: room.version }), 'adminChat.roomStateChanged');
}

const activeRestrictions = computed(() => restrictions.value.filter((r) => r.liftedAt === null));
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('adminChat.heading') }}</h1>
        <p class="page-lead">
          {{ t('adminChat.intro') }}
        </p>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="chat-forbidden"
    />

    <template v-else>
      <StateBlock
        v-if="loading"
        variant="loading"
      />
      <StateBlock
        v-else-if="listError"
        variant="error"
        :message="listError"
      />
      <StateBlock
        v-else-if="rooms.length === 0"
        variant="empty"
        :message="t('adminChat.noRooms')"
      />

      <template v-else>
        <ul
          class="room-list"
          data-testid="chat-room-list"
        >
          <li
            v-for="room in rooms"
            :key="room.id"
            class="card room-row"
            :data-testid="`chat-room-${room.id}`"
          >
            <div class="room-head">
              <button
                type="button"
                class="btn btn-ghost"
                :data-testid="`select-room-${room.id}`"
                @click="selectRoom(room)"
              >
                {{ t('adminChat.roomLabel', { id: room.id.slice(0, 8) }) }}
              </button>
              <span
                class="status-pill"
                :class="room.state === 'open' ? 'status-pill-success' : 'status-pill-neutral'"
              >{{ t(`adminChat.roomState.${room.state}`) }}</span>
              <span class="badge badge-neutral">{{ t('adminChat.messageCount', { count: room.messageCount }) }}</span>
              <button
                type="button"
                class="btn btn-neutral"
                :disabled="busy === room.id"
                :data-testid="`toggle-room-${room.id}`"
                @click="toggleRoom(room)"
              >
                {{ room.state === 'open' ? t('adminChat.closeRoom') : t('adminChat.openRoom') }}
              </button>
            </div>
          </li>
        </ul>

        <template v-if="selected">
          <h2 class="section-title">
            {{ t('adminChat.activeRestrictions') }}
          </h2>
          <StateBlock
            v-if="activeRestrictions.length === 0"
            variant="empty"
            :message="t('adminChat.noRestrictions')"
          />
          <ul
            v-else
            class="restriction-list"
            data-testid="chat-restriction-list"
          >
            <li
              v-for="restriction in activeRestrictions"
              :key="restriction.id"
              class="card restriction-row"
              :data-testid="`chat-restriction-${restriction.id}`"
            >
              <span class="badge badge-warning">{{ t(`adminChat.kind.${restriction.kind}`) }}</span>
              <code class="latin-value">{{ restriction.accountId.slice(0, 8) }}</code>
              <span class="reason">{{ restriction.reason }}</span>
              <span
                v-if="restriction.expiresAt"
                class="expiry"
              >{{ formatDateTime(restriction.expiresAt, activeLocale(), viewerTimeZone()) }}</span>
              <button
                type="button"
                class="btn btn-ghost"
                :disabled="busy === restriction.id"
                :data-testid="`lift-${restriction.id}`"
                @click="lift(restriction)"
              >
                {{ t('adminChat.lift') }}
              </button>
            </li>
          </ul>

          <h2 class="section-title">
            {{ t('adminChat.messages') }}
          </h2>
          <StateBlock
            v-if="messages.length === 0"
            variant="empty"
            :message="t('adminChat.noMessages')"
          />
          <ul
            v-else
            class="message-list"
            data-testid="chat-message-list"
          >
            <li
              v-for="message in messages"
              :key="message.id"
              class="card message-row"
              :data-testid="`mod-message-${message.id}`"
            >
              <div class="message-head">
                <code class="latin-value">{{ message.senderId.slice(0, 8) }}</code>
                <span
                  v-if="message.state === 'removed'"
                  class="badge badge-neutral"
                >{{ t('adminChat.messageRemoved') }}</span>
                <!-- The retained body is the case evidence, shown only here. -->
                <span
                  class="message-body"
                  dir="auto"
                >{{ message.body }}</span>
              </div>
              <AppField
                :id="`reason-${message.id}`"
                :model-value="reasons[message.id] ?? ''"
                :label="t('adminChat.reasonLabel')"
                :hint="t('adminChat.reasonHint')"
                @update:model-value="reasons[message.id] = $event"
              />
              <div class="message-actions">
                <button
                  v-if="message.state === 'visible'"
                  type="button"
                  class="btn btn-neutral"
                  :disabled="busy === message.id || reasonFor(message.id) === ''"
                  :data-testid="`remove-${message.id}`"
                  @click="remove(message)"
                >
                  {{ t('adminChat.remove') }}
                </button>
                <button
                  type="button"
                  class="btn btn-neutral"
                  :disabled="busy === message.id || reasonFor(message.id) === ''"
                  :data-testid="`timeout-${message.id}`"
                  @click="timeoutSender(message)"
                >
                  {{ t('adminChat.timeout') }}
                </button>
                <button
                  type="button"
                  class="btn btn-danger"
                  :disabled="busy === message.id || reasonFor(message.id) === ''"
                  :data-testid="`ban-${message.id}`"
                  @click="banSender(message)"
                >
                  {{ t('adminChat.ban') }}
                </button>
              </div>
            </li>
          </ul>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped>
.section-title {
  margin-block: var(--space-6) var(--space-3);
  font-size: var(--text-lg);
}

.room-list,
.restriction-list,
.message-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}

.room-row,
.restriction-row,
.message-row {
  padding: var(--space-3) var(--space-4);
}

.room-head,
.restriction-row,
.message-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.reason,
.message-body {
  flex: 1;
  min-inline-size: 8rem;
  overflow-wrap: anywhere;
}

.expiry {
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.message-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
