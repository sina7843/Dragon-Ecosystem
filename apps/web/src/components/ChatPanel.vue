<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '../api.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useAuth } from '../composables/useAuth.ts';
import { useToasts } from '../composables/useToasts.ts';
import {
  getChatMessages,
  mergeMessages,
  newClientMessageId,
  reportChatMessage,
  sendChatMessage,
  type ChatMessage
} from '../composables/useChatApi.ts';

/**
 * Live chat for a stream watch page (CHAT-001..008).
 *
 * Delivery is at-least-once, so the panel polls from the highest sequence it holds and
 * folds each page in by message id (`mergeMessages`) — a re-delivered message is rendered
 * once, and a removal replaces an already-rendered message with a tombstone (CHAT-006).
 *
 * Bodies are plain text: the server strips markup on write, and Vue interpolation escapes
 * on render, so there is no path by which chat content executes. Each body carries
 * `dir="auto"` so a Persian message inside an English room (or the reverse) reads
 * correctly without the panel guessing (CHAT-007).
 */

const props = defineProps<{ streamId: string }>();

const { t } = useI18n();
const { messageFor } = useApiErrors();
const { authenticated, loaded } = useAuth();
const { push } = useToasts();

/** Poll interval. Chat is a bounded poll, not a socket: see DECISIONS.md for why. */
const POLL_MS = 4000;
/**
 * How far back each poll re-reads.
 *
 * Polling strictly after the held cursor would only ever surface *new* messages, so a
 * moderator removing a message already on screen would never reach this client — the body
 * would stay rendered indefinitely, which is precisely what CHAT-002 forbids. Re-reading a
 * trailing window makes state changes to recent messages propagate; the merge folds the
 * overlap in by id, so the re-delivery costs nothing on screen (CHAT-006).
 */
const REFRESH_WINDOW = 50;

const messages = ref<ChatMessage[]>([]);
const lastSequence = ref(0);
const roomState = ref<'open' | 'closed' | null>(null);
/** Null while loading; false once we know the stream has no room to show. */
const available = ref<boolean | null>(null);
const loadError = ref<string | undefined>(undefined);

const draft = ref('');
const sending = ref(false);
const sendError = ref<string | undefined>(undefined);

let timer: ReturnType<typeof setInterval> | undefined;
/** Guards against overlapping polls when a response is slower than the interval. */
let polling = false;

async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const feed = await getChatMessages(props.streamId, Math.max(0, lastSequence.value - REFRESH_WINDOW));
    // Deduplicated by id, so the deliberate overlap renders once and a removal replaces
    // the message already on screen with its tombstone.
    messages.value = mergeMessages(messages.value, feed.items);
    lastSequence.value = Math.max(lastSequence.value, feed.lastSequence);
    roomState.value = feed.roomState;
    available.value = true;
    loadError.value = undefined;
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 0;
    // 404 = this stream has no room; 403 = the stream is sign-in only. Neither is an
    // error to shout about, so the panel just explains itself and stops polling.
    if (status === 404 || status === 403) {
      available.value = false;
      loadError.value = status === 403 ? t('chat.signInToRead') : t('chat.unavailable');
      stopPolling();
      return;
    }
    loadError.value = messageFor(error);
  } finally {
    polling = false;
  }
}

function stopPolling(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

onMounted(async () => {
  await poll();
  if (available.value === true) timer = setInterval(() => void poll(), POLL_MS);
});
onUnmounted(stopPolling);

async function send(): Promise<void> {
  const body = draft.value.trim();
  if (body === '' || sending.value) return;
  sending.value = true;
  sendError.value = undefined;
  try {
    const sent = await sendChatMessage(props.streamId, { body, clientMessageId: newClientMessageId() });
    messages.value = mergeMessages(messages.value, [sent]);
    lastSequence.value = Math.max(lastSequence.value, sent.sequence);
    draft.value = '';
  } catch (error) {
    // Every refusal here is the server's: a timeout, a ban, a closed room, or the rate
    // limit. The message it returns is what the sender needs to see.
    sendError.value = messageFor(error);
  } finally {
    sending.value = false;
  }
}

async function report(message: ChatMessage): Promise<void> {
  try {
    await reportChatMessage(message.id, { reason: t('chat.reportReason') });
    push('success', t('chat.reported'));
  } catch (error) {
    push('danger', messageFor(error));
  }
}

const canSend = computed(() => loaded.value && authenticated.value && roomState.value === 'open');
/** Short, stable label for a sender. Chat shows no profile data it was not given. */
function senderLabel(message: ChatMessage): string {
  return message.senderId.slice(0, 6);
}
</script>

<template>
  <section
    class="chat"
    :aria-label="t('chat.region')"
    data-testid="chat-panel"
  >
    <h2 class="chat-heading">
      {{ t('chat.heading') }}
    </h2>

    <p
      v-if="available === false"
      class="chat-note"
      data-testid="chat-unavailable"
    >
      {{ loadError }}
    </p>

    <template v-else>
      <!-- Polite: new messages arriving must not interrupt what a screen-reader user is
           doing, and the log role is the right shape for an append-only transcript. -->
      <ol
        class="chat-log"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        data-testid="chat-log"
      >
        <li
          v-for="message in messages"
          :key="message.id"
          class="chat-message"
          :data-testid="`chat-message-${message.id}`"
        >
          <span class="chat-sender">{{ senderLabel(message) }}</span>
          <span
            v-if="message.state === 'removed'"
            class="chat-removed"
            :data-testid="`chat-removed-${message.id}`"
          >{{ t('chat.removed') }}</span>
          <!-- dir="auto" so a mixed-script message keeps its own direction (CHAT-007). -->
          <span
            v-else
            class="chat-body"
            dir="auto"
          >{{ message.body }}</span>
          <button
            v-if="message.state === 'visible' && authenticated"
            type="button"
            class="chat-report"
            :aria-label="t('chat.report')"
            :data-testid="`chat-report-${message.id}`"
            @click="report(message)"
          >
            {{ t('chat.report') }}
          </button>
        </li>
      </ol>

      <p
        v-if="messages.length === 0"
        class="chat-note"
        data-testid="chat-empty"
      >
        {{ t('chat.empty') }}
      </p>

      <p
        v-if="roomState === 'closed'"
        class="chat-note"
        data-testid="chat-closed"
      >
        {{ t('chat.closed') }}
      </p>

      <form
        v-if="canSend"
        class="chat-form"
        @submit.prevent="send"
      >
        <label
          class="chat-field"
          for="chat-draft"
        >
          <span class="visually-hidden">{{ t('chat.inputLabel') }}</span>
          <input
            id="chat-draft"
            v-model="draft"
            type="text"
            maxlength="500"
            dir="auto"
            :placeholder="t('chat.placeholder')"
            data-testid="chat-input"
          >
        </label>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="sending"
          data-testid="chat-send"
        >
          {{ t('chat.send') }}
        </button>
      </form>

      <p
        v-else-if="loaded && !authenticated"
        class="chat-note"
        data-testid="chat-sign-in"
      >
        {{ t('chat.signInToSend') }}
      </p>

      <p
        v-if="sendError"
        class="chat-error"
        role="alert"
        data-testid="chat-send-error"
      >
        {{ sendError }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-sunken);
}

.chat-heading {
  margin: 0;
  font-size: var(--text-lg);
}

.chat-log {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  /* Bounded height so a busy room scrolls inside the panel instead of the page. */
  max-block-size: 22rem;
  overflow-y: auto;
}

.chat-message {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.chat-sender {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  /* An opaque id fragment is code-like: keep it LTR inside Persian text. */
  unicode-bidi: isolate;
  direction: ltr;
}

.chat-body {
  flex: 1;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.chat-removed {
  flex: 1;
  color: var(--color-text-muted);
  font-style: italic;
}

.chat-report {
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  text-decoration: underline;
  cursor: pointer;
}

.chat-form {
  display: flex;
  gap: var(--space-2);
}
.chat-field {
  flex: 1;
  min-inline-size: 0;
}
.chat-field input {
  inline-size: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.chat-note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.chat-error {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-inline-start: 4px solid var(--color-danger-text);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-size: var(--text-sm);
}
</style>
