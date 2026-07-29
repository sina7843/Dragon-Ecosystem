<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { listCommunityPosts, removeCommunityPost, type ModeratorPostView } from '../composables/useSocialApi.ts';

/**
 * Community moderation console (PAGE-055, MOD-008).
 *
 * A removed post stays on this list with its body intact: the reviewer needs the evidence
 * that justified the action, and the audit trail needs it to remain reproducible. A
 * removal always carries a reason — the field is required here as it is on the server.
 */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const forbidden = ref(false);
const posts = ref<ModeratorPostView[]>([]);
const reasons = ref<Record<string, string>>({});
const busyId = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = undefined;
  forbidden.value = false;
  try {
    posts.value = (await listCommunityPosts()).items;
  } catch (error) {
    if ((error as { status?: number }).status === 403) forbidden.value = true;
    else errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function remove(post: ModeratorPostView): Promise<void> {
  const reason = (reasons.value[post.id] ?? '').trim();
  if (reason === '' || busyId.value !== null) return;
  busyId.value = post.id;
  try {
    await removeCommunityPost(post.id, reason);
    reasons.value[post.id] = '';
    await load();
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    busyId.value = null;
  }
}

function when(value: string): string {
  return formatDateTime(value, activeLocale(), viewerTimeZone());
}
</script>

<template>
  <section class="stack">
    <h1>{{ t('admin.community.title') }}</h1>
    <p class="muted">
      {{ t('admin.community.intro') }}
    </p>
    <p
      class="notice"
      role="note"
    >
      {{ t('admin.community.appealsGate') }}
    </p>

    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="forbidden"
      variant="forbidden"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />
    <StateBlock
      v-else-if="posts.length === 0"
      variant="empty"
      :message="t('admin.community.empty')"
    />

    <ul
      v-else
      class="cases"
      data-testid="admin-community-posts"
    >
      <li
        v-for="post in posts"
        :key="post.id"
        class="case"
      >
        <p class="post-body">
          {{ post.body }}
        </p>
        <p class="muted">
          <time :datetime="post.createdAt">{{ when(post.createdAt) }}</time>
          <span> · </span>
          <span data-testid="admin-community-state">{{ t(`admin.community.state.${post.state}`) }}</span>
        </p>
        <p
          v-if="post.removedReason"
          class="muted"
          data-testid="admin-community-reason"
        >
          {{ t('admin.community.removedReason', { reason: post.removedReason }) }}
        </p>

        <form
          v-if="post.state === 'published'"
          class="row"
          novalidate
          @submit.prevent="remove(post)"
        >
          <label :for="`remove-reason-${post.id}`">{{ t('admin.community.reason') }}</label>
          <input
            :id="`remove-reason-${post.id}`"
            v-model="reasons[post.id]"
            type="text"
            maxlength="500"
            data-testid="admin-community-remove-reason"
          >
          <button
            type="submit"
            data-testid="admin-community-remove"
            :disabled="busyId !== null || (reasons[post.id] ?? '').trim() === ''"
          >
            {{ t('admin.community.remove') }}
          </button>
        </form>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.cases {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.case {
  border: 1px solid var(--color-border, #444);
  border-radius: 0.5rem;
  padding: 1rem;
}
.post-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.notice {
  border-inline-start: 4px solid var(--color-accent, #888);
  padding-inline-start: 0.75rem;
}
</style>
