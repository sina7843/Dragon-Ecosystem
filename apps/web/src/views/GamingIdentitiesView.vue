<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppField from '../components/AppField.vue';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { listMyGamingIdentities, saveGamingIdentity, type GamingIdentity } from '../composables/useTeamsApi.ts';

/** Game-specific player identities, privacy-aware (visible publicly only when marked public). */

interface GameCard { id: string; name: string }

const { t, locale } = useI18n();
const { messageFor, fieldMessage } = useApiErrors();
const { push } = useToasts();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const loading = ref(true);
const identities = ref<GamingIdentity[]>([]);
const games = ref<GameCard[]>([]);
const gameName = computed(() => new Map(games.value.map((g) => [g.id, g.name])));

const submitting = ref(false);
const errors = ref<Record<string, string | undefined>>({});
const form = ref<{ gameId: string; inGameName: string; visibility: 'private' | 'public' }>({ gameId: '', inGameName: '', visibility: 'private' });

async function loadAll(): Promise<void> {
  const [mine, gameList] = await Promise.all([
    listMyGamingIdentities(),
    apiFetch<{ items: GameCard[] }>(`/games?locale=${activeLocale()}&limit=100`)
  ]);
  identities.value = mine.items;
  games.value = gameList.items;
}

onMounted(async () => {
  try {
    await loadAll();
  } finally {
    loading.value = false;
  }
});

async function onSave(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  errors.value = {};
  try {
    await saveGamingIdentity({ gameId: form.value.gameId, inGameName: form.value.inGameName, visibility: form.value.visibility });
    push('success', t('gamingIdentities.saved'));
    form.value.inGameName = '';
    await loadAll();
  } catch (error) {
    errors.value['gameId'] = fieldMessage(error, 'gameId');
    errors.value['inGameName'] = fieldMessage(error, 'inGameName');
    if (Object.values(errors.value).every((v) => v === undefined)) push('danger', messageFor(error));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('gamingIdentities.heading') }}</h1>
        <p class="page-lead">
          {{ t('gamingIdentities.intro') }}
        </p>
      </div>
    </div>

    <StateBlock
      v-if="loading"
      variant="loading"
    />

    <template v-else>
      <ul
        v-if="identities.length > 0"
        class="card-grid list"
        data-testid="gaming-identities"
      >
        <li
          v-for="identity in identities"
          :key="identity.gameId"
          class="card identity-card"
        >
          <span class="identity-game">{{ gameName.get(identity.gameId) ?? identity.gameId }}</span>
          <bdi class="latin-value identity-name">{{ identity.inGameName }}</bdi>
          <span
            class="status-pill"
            :class="identity.visibility === 'public' ? 'status-pill-info' : 'status-pill-neutral'"
          >{{ t(`teams.visibility.${identity.visibility}`) }}</span>
        </li>
      </ul>

      <form
        novalidate
        class="card form-panel"
        data-testid="gaming-identity-form"
        @submit.prevent="onSave"
      >
        <div class="field">
          <label for="gi-game">{{ t('gamingIdentities.game') }}</label>
          <select
            id="gi-game"
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

        <AppField
          id="gi-name"
          v-model="form.inGameName"
          :label="t('gamingIdentities.inGameName')"
          :error="errors.inGameName"
          required
          :disabled="submitting"
        />

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
          data-testid="save-gaming-identity"
          :disabled="submitting"
        >
          {{ submitting ? t('gamingIdentities.saving') : t('gamingIdentities.save') }}
        </button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0 0 var(--space-6);
  padding: 0;
}

.identity-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
}

.identity-game {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.identity-name {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
}

.form-panel {
  max-inline-size: 32rem;
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

</style>
