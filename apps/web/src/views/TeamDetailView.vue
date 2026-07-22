<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import AppField from '../components/AppField.vue';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { isLocale } from '../i18n/locale.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import {
  captureSnapshot,
  disbandTeam,
  getTeam,
  inviteMember,
  leaveTeam,
  removeMember,
  transferOwnership,
  updateTeam,
  type TeamDetail
} from '../composables/useTeamsApi.ts';

/** Team detail and owner/member operations (TEAM-003..010). Owner-only controls are also enforced server-side. */

const { t, locale } = useI18n();
const { messageFor, fieldMessage } = useApiErrors();
const { push } = useToasts();
const route = useRoute();
const router = useRouter();

const prefix = computed(() => `/${isLocale(locale.value) ? locale.value : 'fa'}`);
const teamId = computed(() => String(route.params['id']));

const loading = ref(true);
const notFound = ref(false);
const team = ref<TeamDetail | null>(null);
const inviteUsername = ref('');
const inviteError = ref<string | undefined>(undefined);
const isOwner = computed(() => team.value?.viewerRole === 'owner');

async function load(): Promise<void> {
  loading.value = true;
  try {
    team.value = await getTeam(teamId.value);
    notFound.value = false;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound.value = true;
    else push('danger', messageFor(error));
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function onInvite(): Promise<void> {
  inviteError.value = undefined;
  try {
    await inviteMember(teamId.value, inviteUsername.value);
    inviteUsername.value = '';
    push('success', t('teams.detail.invited'));
    await load();
  } catch (error) {
    inviteError.value = fieldMessage(error, 'username') ?? messageFor(error);
  }
}

async function onRemove(accountId: string): Promise<void> {
  const reason = window.prompt(t('teams.detail.reasonPrompt'));
  if (reason === null || reason.trim() === '') return;
  try {
    await removeMember(teamId.value, accountId, reason);
    push('success', t('teams.detail.memberRemoved'));
    await load();
  } catch (error) {
    push('danger', messageFor(error));
  }
}

async function onTransfer(accountId: string): Promise<void> {
  try {
    await transferOwnership(teamId.value, accountId);
    push('success', t('teams.detail.transferred'));
    await load();
  } catch (error) {
    push('danger', messageFor(error));
  }
}

async function onLeave(): Promise<void> {
  try {
    await leaveTeam(teamId.value);
    push('info', t('teams.detail.left'));
    await router.push(`${prefix.value}/account/teams`);
  } catch (error) {
    push('danger', messageFor(error));
  }
}

async function onDisband(): Promise<void> {
  const reason = window.prompt(t('teams.detail.reasonPrompt'));
  if (reason === null || reason.trim() === '') return;
  try {
    await disbandTeam(teamId.value, reason);
    push('info', t('teams.detail.disbanded'));
    await router.push(`${prefix.value}/account/teams`);
  } catch (error) {
    push('danger', messageFor(error));
  }
}

async function onSnapshot(): Promise<void> {
  try {
    await captureSnapshot(teamId.value, t('teams.detail.snapshotReason'));
    push('success', t('teams.detail.snapshotTaken'));
  } catch (error) {
    push('danger', messageFor(error));
  }
}

async function onToggleVisibility(): Promise<void> {
  if (team.value === null) return;
  const next = team.value.visibility === 'public' ? 'private' : 'public';
  try {
    team.value = await updateTeam(teamId.value, { visibility: next, expectedVersion: team.value.version });
    push('success', t('teams.detail.updated'));
  } catch (error) {
    push('danger', messageFor(error));
  }
}
</script>

<template>
  <section>
    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="notFound"
      variant="notFound"
      data-testid="team-not-found"
      :message="t('teams.detail.notFound')"
    />

    <template v-else-if="team">
      <p>
        <RouterLink :to="`${prefix}/account/teams`">
          {{ t('teams.detail.back') }}
        </RouterLink>
      </p>
      <h1 data-testid="team-title">
        {{ team.name }}
      </h1>
      <p class="meta">
        {{ t(`teams.role.${team.viewerRole}`) }} ·
        {{ t(`teams.visibility.${team.visibility}`) }}
      </p>
      <p
        v-if="team.description"
        data-testid="team-description"
      >
        {{ team.description }}
      </p>

      <h2>{{ t('teams.detail.roster') }}</h2>
      <ul
        class="roster"
        data-testid="roster"
      >
        <li
          v-for="member in team.members"
          :key="member.accountId"
          :data-testid="`member-${member.accountId}`"
        >
          <span>{{ member.displayName ?? member.username ?? member.accountId }}</span>
          <span class="role">{{ t(`teams.role.${member.role}`) }}</span>
          <span
            v-if="isOwner && member.role === 'member'"
            class="actions"
          >
            <button
              type="button"
              data-testid="transfer-member"
              @click="onTransfer(member.accountId)"
            >
              {{ t('teams.detail.makeOwner') }}
            </button>
            <button
              type="button"
              data-testid="remove-member"
              @click="onRemove(member.accountId)"
            >
              {{ t('teams.detail.remove') }}
            </button>
          </span>
        </li>
      </ul>

      <section
        v-if="isOwner"
        class="panel"
      >
        <h2>{{ t('teams.detail.invite') }}</h2>
        <form
          novalidate
          @submit.prevent="onInvite"
        >
          <AppField
            id="invite-username"
            v-model="inviteUsername"
            :label="t('teams.detail.inviteUsername')"
            :error="inviteError"
            latin
            required
          />
          <button
            type="submit"
            class="primary"
            data-testid="send-invite"
          >
            {{ t('teams.detail.sendInvite') }}
          </button>
        </form>
      </section>

      <div class="owner-actions">
        <button
          v-if="isOwner"
          type="button"
          data-testid="toggle-visibility"
          @click="onToggleVisibility"
        >
          {{ team.visibility === 'public' ? t('teams.detail.makePrivate') : t('teams.detail.makePublic') }}
        </button>
        <button
          v-if="isOwner"
          type="button"
          data-testid="capture-snapshot"
          @click="onSnapshot"
        >
          {{ t('teams.detail.snapshot') }}
        </button>
        <button
          v-if="isOwner"
          type="button"
          class="danger"
          data-testid="disband-team"
          @click="onDisband"
        >
          {{ t('teams.detail.disband') }}
        </button>
        <button
          v-else
          type="button"
          class="danger"
          data-testid="leave-team"
          @click="onLeave"
        >
          {{ t('teams.detail.leave') }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.meta {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.roster {
  list-style: none;
  margin: 0 0 var(--space-5);
  padding: 0;
}

.roster li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding-block: var(--space-2);
  border-block-end: 1px solid var(--color-border);
}

.role {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.actions {
  display: flex;
  gap: var(--space-2);
  margin-inline-start: auto;
}

.panel {
  margin-block: var(--space-5);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.owner-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-block-start: var(--space-5);
}

.owner-actions button,
.actions button {
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.primary {
  padding-inline: var(--space-4);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
  cursor: pointer;
}

.danger {
  border-color: var(--color-danger-text) !important;
  color: var(--color-danger-text) !important;
}
</style>
