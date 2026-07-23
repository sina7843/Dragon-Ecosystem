<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppField from '../components/AppField.vue';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import {
  acceptInvitation,
  createTeam,
  declineInvitation,
  listMyInvitations,
  listMyTeams,
  type Invitation,
  type TeamSummary
} from '../composables/useTeamsApi.ts';

/** Team hub (TEAM-001..006): create a team, see the teams you belong to, and act on invitations. */

interface GameCard { id: string; name: string }

const { t, locale } = useI18n();
const { messageFor, fieldMessage } = useApiErrors();
const { push } = useToasts();
const router = useRouter();

const prefix = computed(() => `/${isLocale(locale.value) ? locale.value : 'fa'}`);
const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const loading = ref(true);
const teams = ref<TeamSummary[]>([]);
const invitations = ref<Invitation[]>([]);
const games = ref<GameCard[]>([]);

const submitting = ref(false);
const formError = ref<string | undefined>(undefined);
const errors = ref<Record<string, string | undefined>>({});
const form = ref<{ name: string; gameId: string; visibility: 'private' | 'public' }>({ name: '', gameId: '', visibility: 'private' });

async function loadAll(): Promise<void> {
  const [mine, invites, gameList] = await Promise.all([
    listMyTeams(),
    listMyInvitations(),
    apiFetch<{ items: GameCard[] }>(`/games?locale=${activeLocale()}&limit=100`)
  ]);
  teams.value = mine.items;
  invitations.value = invites.items;
  games.value = gameList.items;
}

onMounted(async () => {
  try {
    await loadAll();
  } catch (error) {
    formError.value = messageFor(error);
  } finally {
    loading.value = false;
  }
});

async function onCreate(): Promise<void> {
  if (submitting.value) return;
  formError.value = undefined;
  errors.value = {};
  submitting.value = true;
  try {
    const team = await createTeam({ name: form.value.name, gameId: form.value.gameId, visibility: form.value.visibility });
    push('success', t('teams.created'));
    await router.push(`${prefix.value}/account/teams/${team.id}`);
  } catch (error) {
    for (const field of ['name', 'gameId']) errors.value[field] = fieldMessage(error, field);
    if (Object.values(errors.value).every((v) => v === undefined)) formError.value = messageFor(error);
  } finally {
    submitting.value = false;
  }
}

async function onAccept(id: string): Promise<void> {
  try {
    await acceptInvitation(id);
    push('success', t('teams.invitationAccepted'));
    await loadAll();
  } catch (error) {
    push('danger', messageFor(error));
  }
}

async function onDecline(id: string): Promise<void> {
  try {
    await declineInvitation(id);
    push('info', t('teams.invitationDeclined'));
    await loadAll();
  } catch (error) {
    push('danger', messageFor(error));
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('teams.heading') }}</h1>
        <p class="page-lead">
          {{ t('teams.intro') }}
        </p>
      </div>
    </div>

    <StateBlock
      v-if="loading"
      variant="loading"
    />

    <template v-else>
      <section
        v-if="invitations.length > 0"
        class="card panel"
        data-testid="invitations"
      >
        <div class="section-header">
          <h2>{{ t('teams.invitations.heading') }}</h2>
        </div>
        <ul class="list">
          <li
            v-for="invite in invitations"
            :key="invite.id"
            :data-testid="`invitation-${invite.id}`"
          >
            <span class="invite-name">
              <span
                class="avatar"
                aria-hidden="true"
              >{{ invite.teamName.slice(0, 2).toUpperCase() }}</span>
              {{ invite.teamName }}
            </span>
            <span class="actions">
              <button
                type="button"
                class="btn btn-primary"
                data-testid="accept-invitation"
                @click="onAccept(invite.id)"
              >
                {{ t('teams.invitations.accept') }}
              </button>
              <button
                type="button"
                class="btn btn-neutral"
                data-testid="decline-invitation"
                @click="onDecline(invite.id)"
              >
                {{ t('teams.invitations.decline') }}
              </button>
            </span>
          </li>
        </ul>
      </section>

      <section class="card panel">
        <div class="section-header">
          <h2>{{ t('teams.mine.heading') }}</h2>
        </div>
        <StateBlock
          v-if="teams.length === 0"
          variant="empty"
          :message="t('teams.mine.empty')"
        />
        <ul
          v-else
          class="card-grid teams-grid"
        >
          <li
            v-for="team in teams"
            :key="team.id"
            :data-testid="`team-card-${team.id}`"
          >
            <RouterLink
              class="card card-interactive team-card"
              :to="`${prefix}/account/teams/${team.id}`"
            >
              <span
                class="avatar"
                aria-hidden="true"
              >{{ team.name.slice(0, 2).toUpperCase() }}</span>
              <span class="team-card-body">
                <span class="card-title">{{ team.name }}</span>
                <span
                  class="badge badge-accent"
                >{{ t(`teams.role.${team.role}`) }}</span>
              </span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="card panel">
        <div class="section-header">
          <h2>{{ t('teams.create.heading') }}</h2>
        </div>
        <form
          novalidate
          data-testid="team-form"
          @submit.prevent="onCreate"
        >
          <p
            v-if="formError"
            class="summary"
            role="alert"
            data-testid="team-error"
          >
            {{ formError }}
          </p>

          <AppField
            id="team-name"
            v-model="form.name"
            :label="t('teams.field.name')"
            :error="errors.name"
            required
            :disabled="submitting"
          />

          <div class="field">
            <label for="team-game">{{ t('teams.field.game') }}</label>
            <select
              id="team-game"
              v-model="form.gameId"
              required
              :disabled="submitting"
            >
              <option
                value=""
                disabled
              >
                {{ t('teams.field.gamePlaceholder') }}
              </option>
              <option
                v-for="game in games"
                :key="game.id"
                :value="game.id"
              >
                {{ game.name }}
              </option>
            </select>
            <p
              v-if="errors.gameId"
              class="field-error"
            >
              {{ errors.gameId }}
            </p>
          </div>

          <fieldset class="visibility">
            <legend>{{ t('teams.field.visibility') }}</legend>
            <label>
              <input
                v-model="form.visibility"
                type="radio"
                value="private"
              >
              {{ t('teams.visibility.private') }}
            </label>
            <label>
              <input
                v-model="form.visibility"
                type="radio"
                value="public"
              >
              {{ t('teams.visibility.public') }}
            </label>
          </fieldset>

          <button
            type="submit"
            class="btn btn-primary"
            data-testid="create-team"
            :disabled="submitting"
          >
            {{ submitting ? t('teams.create.creating') : t('teams.create.submit') }}
          </button>
        </form>
      </section>
    </template>
  </section>
</template>

<style scoped>
.panel {
  margin-block: var(--space-5);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-block: var(--space-3);
  border-block-end: 1px solid var(--color-border);
}

.list li:last-child {
  border-block-end: none;
}

.invite-name {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-weight: var(--weight-semibold);
}

.avatar {
  display: grid;
  place-items: center;
  inline-size: 2.5rem;
  block-size: 2.5rem;
  flex: none;
  border-radius: var(--radius-lg);
  background: var(--gradient-brand);
  color: var(--color-primary-text);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.actions {
  display: flex;
  gap: var(--space-2);
}

.teams-grid {
  list-style: none;
  margin: 0;
  padding: 0;
}

.team-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: inherit;
  text-decoration: none;
}

.team-card-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-inline-size: 0;
}

.field {
  margin-block-end: var(--space-4);
}

.field label {
  display: block;
  margin-block-end: var(--space-1);
  font-weight: 600;
}

.field select {
  inline-size: 100%;
  max-inline-size: 32rem;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.field-error {
  margin-block: var(--space-1) 0;
  color: var(--color-danger-text);
  font-size: var(--text-sm);
}

.visibility {
  margin-block-end: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.visibility label {
  display: block;
  padding-block: var(--space-1);
}

.summary {
  padding: var(--space-3);
  border: 1px solid var(--color-danger-text);
  border-radius: var(--radius-md);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-weight: 600;
}

</style>
