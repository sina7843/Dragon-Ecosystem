<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import {
  createPost,
  feed,
  getSocialConfig,
  react,
  unreact,
  type PostView,
  type PostVisibility,
  type SocialConfig
} from '../composables/useSocialApi.ts';

/**
 * The community feed and composer (PAGE-034, SOCIAL-003, SOCIAL-004).
 *
 * The audience selector defaults to followers, matching the server default, so publishing
 * to everyone is always a deliberate act. The gate notice is rendered from the server's
 * reported configuration rather than a build-time constant, so it cannot claim a
 * capability is off while the API has it on.
 */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const posts = ref<PostView[]>([]);
const nextCursor = ref<string | null>(null);
const config = ref<SocialConfig | null>(null);

const draft = ref('');
const visibility = ref<PostVisibility>('followers');
const posting = ref(false);
const composerError = ref<string | undefined>(undefined);

async function load(cursor?: string): Promise<void> {
  loading.value = true;
  errorMessage.value = undefined;
  try {
    const page = await feed(cursor);
    posts.value = cursor === undefined ? page.items : [...posts.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  // The gate notice is informational; a failure to read it must not hide the feed.
  try {
    config.value = await getSocialConfig();
  } catch {
    config.value = null;
  }
  await load();
});

async function submit(): Promise<void> {
  if (draft.value.trim() === '' || posting.value) return;
  posting.value = true;
  composerError.value = undefined;
  try {
    await createPost({ body: draft.value, visibility: visibility.value });
    draft.value = '';
    await load();
  } catch (error) {
    composerError.value = messageFor(error);
  } finally {
    posting.value = false;
  }
}

async function toggleReaction(post: PostView): Promise<void> {
  try {
    if (post.viewerReacted) {
      await unreact('post', post.id);
      post.viewerReacted = false;
      post.reactionCount = Math.max(0, post.reactionCount - 1);
    } else {
      await react('post', post.id);
      post.viewerReacted = true;
      post.reactionCount += 1;
    }
  } catch (error) {
    errorMessage.value = messageFor(error);
  }
}

function when(value: string): string {
  return formatDateTime(value, activeLocale(), viewerTimeZone());
}
</script>

<template>
  <section class="stack">
    <h1>{{ t('community.feed.title') }}</h1>
    <p class="muted">
      {{ t('community.feed.intro') }}
    </p>

    <p
      v-if="config && !config.blockingEnabled"
      class="notice"
      role="note"
    >
      {{ t('community.gate.blocking') }}
    </p>

    <form
      class="composer stack"
      novalidate
      @submit.prevent="submit"
    >
      <label for="community-body">{{ t('community.composer.body') }}</label>
      <textarea
        id="community-body"
        v-model="draft"
        data-testid="community-composer-body"
        dir="auto"
        rows="3"
        maxlength="2000"
        :aria-describedby="composerError ? 'community-composer-error' : undefined"
      />

      <label for="community-visibility">{{ t('community.composer.visibility') }}</label>
      <select
        id="community-visibility"
        v-model="visibility"
        data-testid="community-composer-visibility"
      >
        <!-- Followers first and preselected: privacy by default (SOCIAL-004). -->
        <option value="followers">
          {{ t('community.visibility.followers') }}
        </option>
        <option value="public">
          {{ t('community.visibility.public') }}
        </option>
      </select>

      <p
        v-if="composerError"
        id="community-composer-error"
        class="error"
        role="alert"
      >
        {{ composerError }}
      </p>

      <button
        type="submit"
        data-testid="community-composer-submit"
        :disabled="posting || draft.trim() === ''"
      >
        {{ posting ? t('community.composer.posting') : t('community.composer.submit') }}
      </button>
    </form>

    <StateBlock
      v-if="loading && posts.length === 0"
      variant="loading"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />
    <StateBlock
      v-else-if="posts.length === 0"
      variant="empty"
      :message="t('community.feed.empty')"
    />

    <ul
      v-else
      class="feed"
      data-testid="community-feed"
    >
      <li
        v-for="post in posts"
        :key="post.id"
        class="post"
        data-testid="community-post"
      >
        <!-- dir="auto" so a Persian post inside the English feed (or the reverse) keeps
             its own base direction, matching the chat surface (SOCIAL-004, CHAT-007). -->
        <p
          class="post-body"
          dir="auto"
        >
          {{ post.body }}
        </p>
        <p class="muted">
          <time :datetime="post.createdAt">{{ when(post.createdAt) }}</time>
          <span> · </span>
          <span data-testid="community-post-visibility">{{ t(`community.visibility.${post.visibility}`) }}</span>
        </p>
        <div class="actions">
          <button
            type="button"
            data-testid="community-post-react"
            :aria-pressed="post.viewerReacted"
            @click="toggleReaction(post)"
          >
            {{ t('community.post.react') }} ({{ post.reactionCount }})
          </button>
          <RouterLink :to="`${prefix}/community/posts/${post.id}`">
            {{ t('community.post.open') }} ({{ post.commentCount }})
          </RouterLink>
        </div>
      </li>
    </ul>

    <button
      v-if="nextCursor"
      type="button"
      data-testid="community-feed-more"
      @click="load(nextCursor ?? undefined)"
    >
      {{ t('community.feed.more') }}
    </button>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.composer {
  border: 1px solid var(--color-border, #444);
  border-radius: 0.5rem;
  padding: 1rem;
}
.feed {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.post {
  border: 1px solid var(--color-border, #444);
  border-radius: 0.5rem;
  padding: 1rem;
}
.post-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 1rem;
  align-items: center;
}
.notice {
  border-inline-start: 4px solid var(--color-accent, #888);
  padding-inline-start: 0.75rem;
}
</style>
