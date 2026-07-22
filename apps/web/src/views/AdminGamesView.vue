<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppField from '../components/AppField.vue';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';

/** Games administration (CONTENT-010). Gated on games.manage; the server enforces it. */
interface Game {
  id: string;
  slug: string;
  status: string;
  version: number;
  translations: Record<'fa' | 'en', { name: string; description: string }>;
}

const { t } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor, fieldMessage } = useApiErrors();
const { push } = useToasts();

const loading = ref(true);
const listError = ref<string | undefined>(undefined);
const games = ref<Game[]>([]);
const editing = ref<Game | null>(null);
const saving = ref(false);
const formError = ref<string | undefined>(undefined);
const slugError = ref<string | undefined>(undefined);

const form = reactive({
  slug: '',
  fa: { name: '', description: '' },
  en: { name: '', description: '' }
});

async function loadList(): Promise<void> {
  loading.value = true;
  try {
    games.value = (await apiFetch<{ items: Game[] }>('/admin/games')).items;
    listError.value = undefined;
  } catch (caught) {
    listError.value = messageFor(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await refreshCaps();
  await loadList();
});

function resetForm(): void {
  editing.value = null;
  Object.assign(form, { slug: '', fa: { name: '', description: '' }, en: { name: '', description: '' } });
  formError.value = undefined;
  slugError.value = undefined;
}

function edit(game: Game): void {
  editing.value = game;
  Object.assign(form, { slug: game.slug, fa: { ...game.translations.fa }, en: { ...game.translations.en } });
  formError.value = undefined;
  slugError.value = undefined;
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  formError.value = undefined;
  slugError.value = undefined;
  const payload = { slug: form.slug, translations: { fa: form.fa, en: form.en } };
  try {
    if (editing.value === null) {
      editing.value = await apiFetch<Game>('/admin/games', { method: 'POST', body: JSON.stringify(payload) });
      push('success', t('adminGames.created'));
    } else {
      editing.value = await apiFetch<Game>(`/admin/games/${editing.value.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...payload, expectedVersion: editing.value.version })
      });
      push('success', t('adminGames.saved'));
    }
    await loadList();
  } catch (caught) {
    slugError.value = fieldMessage(caught, 'slug');
    if (slugError.value === undefined) formError.value = messageFor(caught);
  } finally {
    saving.value = false;
  }
}

async function setStatus(status: string): Promise<void> {
  if (editing.value === null) return;
  const reason = globalThis.prompt(t('adminGames.reasonPrompt')) ?? '';
  if (reason.trim() === '') return;
  try {
    editing.value = await apiFetch<Game>(`/admin/games/${editing.value.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, reason })
    });
    push('success', t('adminGames.statusChanged'));
    await loadList();
  } catch (caught) {
    push('danger', messageFor(caught));
  }
}
</script>

<template>
  <section>
    <h1>{{ t('adminGames.heading') }}</h1>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="games-forbidden"
    />

    <template v-else>
      <div class="layout">
        <div>
          <button
            type="button"
            class="new"
            data-testid="new-game"
            @click="resetForm"
          >
            {{ t('adminGames.new') }}
          </button>
          <StateBlock
            v-if="loading"
            variant="loading"
          />
          <StateBlock
            v-else-if="listError"
            variant="error"
            :message="listError"
          />
          <ul
            v-else
            class="items"
          >
            <li
              v-for="game in games"
              :key="game.id"
            >
              <button
                type="button"
                :data-testid="`edit-${game.id}`"
                @click="edit(game)"
              >
                <span>{{ game.translations.en.name || game.translations.fa.name || '—' }}</span>
                <span class="state">{{ t(`adminGames.status.${game.status}`) }}</span>
              </button>
            </li>
            <li
              v-if="games.length === 0"
              class="empty"
            >
              {{ t('adminGames.empty') }}
            </li>
          </ul>
        </div>

        <form
          class="editor"
          novalidate
          data-testid="game-form"
          @submit.prevent="save"
        >
          <h2>{{ editing ? t('adminGames.editing') : t('adminGames.creating') }}</h2>
          <p
            v-if="formError"
            class="summary"
            role="alert"
            data-testid="game-error"
          >
            {{ formError }}
          </p>

          <fieldset
            v-for="loc in (['fa', 'en'] as const)"
            :key="loc"
            class="locale"
          >
            <legend>{{ t(`locale.name.${loc}`) }}</legend>
            <AppField
              :id="`name-${loc}`"
              v-model="form[loc].name"
              :label="t('adminGames.field.name')"
            />
            <AppField
              :id="`desc-${loc}`"
              v-model="form[loc].description"
              :label="t('adminGames.field.description')"
            />
          </fieldset>

          <AppField
            id="game-slug"
            v-model="form.slug"
            :label="t('adminGames.field.slug')"
            :error="slugError"
            latin
          />

          <div class="actions">
            <button
              type="submit"
              class="primary"
              data-testid="save-game"
              :disabled="saving"
            >
              {{ saving ? t('adminGames.saving') : t('adminGames.save') }}
            </button>
            <template v-if="editing">
              <button
                v-if="editing.status !== 'published'"
                type="button"
                data-testid="publish-game"
                @click="setStatus('published')"
              >
                {{ t('adminGames.publish') }}
              </button>
              <button
                v-if="editing.status === 'published'"
                type="button"
                data-testid="archive-game"
                @click="setStatus('archived')"
              >
                {{ t('adminGames.archive') }}
              </button>
            </template>
          </div>
        </form>
      </div>
    </template>
  </section>
</template>

<style scoped>
.layout {
  display: grid;
  gap: var(--space-5);
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 60rem) {
  .layout {
    grid-template-columns: 18rem minmax(0, 1fr);
  }
}

.new {
  inline-size: 100%;
  margin-block-end: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
  cursor: pointer;
}

.items {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.items button {
  inline-size: 100%;
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
  text-align: start;
}

.state {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.locale {
  display: block;
  margin-block-end: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.summary {
  padding: var(--space-3);
  border: 1px solid var(--color-danger-text);
  border-radius: var(--radius-md);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.actions button {
  padding-inline: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}

.actions .primary {
  border-color: var(--color-accent);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
}
</style>
