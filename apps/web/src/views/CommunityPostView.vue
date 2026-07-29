<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { comment, getPost, report, type CommentView, type PostView } from '../composables/useSocialApi.ts';

/**
 * One community post with its thread (PAGE-036).
 *
 * A post the viewer may not read answers 404, so this page shows "not found" rather than
 * "forbidden" — telling the visitor a private post exists would defeat the point.
 */

const { t, locale } = useI18n();
const route = useRoute();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const postId = computed(() => String(route.params.id ?? ''));

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const post = ref<PostView | null>(null);
const comments = ref<CommentView[]>([]);

const draft = ref('');
const commenting = ref(false);
const commentError = ref<string | undefined>(undefined);

const reportReason = ref('');
const reportState = ref<'idle' | 'sent'>('idle');
const reportError = ref<string | undefined>(undefined);

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = undefined;
  try {
    const view = await getPost(postId.value);
    post.value = view.post;
    comments.value = view.comments;
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function submitComment(): Promise<void> {
  if (draft.value.trim() === '' || commenting.value) return;
  commenting.value = true;
  commentError.value = undefined;
  try {
    await comment(postId.value, draft.value);
    draft.value = '';
    await load();
  } catch (error) {
    commentError.value = messageFor(error);
  } finally {
    commenting.value = false;
  }
}

async function submitReport(): Promise<void> {
  if (reportReason.value.trim() === '') return;
  reportError.value = undefined;
  try {
    await report({ targetType: 'post', targetId: postId.value, reason: reportReason.value });
    reportState.value = 'sent';
    reportReason.value = '';
  } catch (error) {
    reportError.value = messageFor(error);
  }
}

function when(value: string): string {
  return formatDateTime(value, activeLocale(), viewerTimeZone());
}
</script>

<template>
  <section class="stack">
    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="errorMessage || post === null"
      variant="notFound"
      :heading-level="1"
    />

    <template v-else>
      <h1>{{ t('community.post.title') }}</h1>
      <article
        class="post"
        data-testid="community-post-detail"
      >
        <p class="post-body">
          {{ post.body }}
        </p>
        <p class="muted">
          <time :datetime="post.createdAt">{{ when(post.createdAt) }}</time>
          <span> · </span>
          <span>{{ t(`community.visibility.${post.visibility}`) }}</span>
        </p>
      </article>

      <h2>{{ t('community.comments.title') }} ({{ post.commentCount }})</h2>
      <ul
        v-if="comments.length > 0"
        class="thread"
        data-testid="community-comments"
      >
        <li
          v-for="entry in comments"
          :key="entry.id"
          class="comment"
        >
          <!-- A removed comment keeps its place so replies never dangle (SOCIAL-005). -->
          <p v-if="entry.body !== null">
            {{ entry.body }}
          </p>
          <p
            v-else
            class="muted"
            data-testid="community-comment-tombstone"
          >
            {{ t('community.comments.removed') }}
          </p>
          <p class="muted">
            <time :datetime="entry.createdAt">{{ when(entry.createdAt) }}</time>
          </p>
        </li>
      </ul>
      <StateBlock
        v-else
        variant="empty"
        :message="t('community.comments.empty')"
        :heading-level="3"
      />

      <form
        class="stack"
        novalidate
        @submit.prevent="submitComment"
      >
        <label for="community-comment">{{ t('community.comments.add') }}</label>
        <textarea
          id="community-comment"
          v-model="draft"
          data-testid="community-comment-body"
          rows="2"
          maxlength="2000"
          :aria-describedby="commentError ? 'community-comment-error' : undefined"
        />
        <p
          v-if="commentError"
          id="community-comment-error"
          class="error"
          role="alert"
        >
          {{ commentError }}
        </p>
        <button
          type="submit"
          data-testid="community-comment-submit"
          :disabled="commenting || draft.trim() === ''"
        >
          {{ t('community.comments.submit') }}
        </button>
      </form>

      <h2>{{ t('community.report.title') }}</h2>
      <p
        v-if="reportState === 'sent'"
        role="status"
        data-testid="community-report-sent"
      >
        {{ t('community.report.sent') }}
      </p>
      <form
        v-else
        class="stack"
        novalidate
        @submit.prevent="submitReport"
      >
        <label for="community-report-reason">{{ t('community.report.reason') }}</label>
        <input
          id="community-report-reason"
          v-model="reportReason"
          data-testid="community-report-reason"
          type="text"
          maxlength="500"
        >
        <p
          v-if="reportError"
          class="error"
          role="alert"
        >
          {{ reportError }}
        </p>
        <button
          type="submit"
          data-testid="community-report-submit"
          :disabled="reportReason.trim() === ''"
        >
          {{ t('community.report.submit') }}
        </button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.post,
.comment {
  border: 1px solid var(--color-border, #444);
  border-radius: 0.5rem;
  padding: 1rem;
}
.post-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.thread {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
</style>
