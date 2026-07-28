<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppField from '../components/AppField.vue';
import AppSearch from '../components/AppSearch.vue';
import ImagePicker from '../components/ImagePicker.vue';
import RichTextEditor from '../components/RichTextEditor.vue';
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
  coverImageUrl: string | null;
  translations: Record<'fa' | 'en', { name: string; description: string; body: string }>;
}

const { t } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();

// Presentation-only mapping to a status-pill tone; the text label always carries the state.
function gameTone(status: string): string {
  if (status === 'published') return 'success';
  return 'neutral';
}
const { messageFor, fieldMessage } = useApiErrors();
const { push } = useToasts();

const loading = ref(true);
const listError = ref<string | undefined>(undefined);
const games = ref<Game[]>([]);
const search = ref('');
const filteredGames = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return games.value;
  return games.value.filter((g) =>
    `${g.translations.en.name} ${g.translations.fa.name} ${g.slug}`.toLowerCase().includes(q)
  );
});
const editing = ref<Game | null>(null);
const saving = ref(false);
const formError = ref<string | undefined>(undefined);
const slugError = ref<string | undefined>(undefined);

const form = reactive({
  slug: '',
  coverImageUrl: null as string | null,
  fa: { name: '', description: '', body: '' },
  en: { name: '', description: '', body: '' }
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
  Object.assign(form, { slug: '', coverImageUrl: null, fa: { name: '', description: '', body: '' }, en: { name: '', description: '', body: '' } });
  formError.value = undefined;
  slugError.value = undefined;
}

function edit(game: Game): void {
  editing.value = game;
  Object.assign(form, {
    slug: game.slug,
    coverImageUrl: game.coverImageUrl,
    // Games created before the body field exists come back without it.
    fa: { ...game.translations.fa, body: game.translations.fa.body ?? '' },
    en: { ...game.translations.en, body: game.translations.en.body ?? '' }
  });
  formError.value = undefined;
  slugError.value = undefined;
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  formError.value = undefined;
  slugError.value = undefined;
  const payload = { slug: form.slug, coverImageUrl: form.coverImageUrl, translations: { fa: form.fa, en: form.en } };
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
    <div class="page-header">
      <div>
        <h1>{{ t('adminGames.heading') }}</h1>
      </div>
      <div class="page-header-actions">
        <button
          type="button"
          class="btn btn-primary"
          data-testid="new-game"
          @click="resetForm"
        >
          {{ t('adminGames.new') }}
        </button>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="games-forbidden"
    />

    <template v-else>
      <div class="layout">
        <div class="list-pane data-panel">
          <StateBlock
            v-if="loading"
            variant="loading"
          />
          <StateBlock
            v-else-if="listError"
            variant="error"
            :message="listError"
          />
          <template v-else>
            <AppSearch
              v-model="search"
              input-id="admin-games-search"
            />
            <ul class="items">
              <li
                v-for="game in filteredGames"
                :key="game.id"
              >
                <button
                  type="button"
                  class="item-row"
                  :data-testid="`edit-${game.id}`"
                  @click="edit(game)"
                >
                  <span class="title">{{ game.translations.en.name || game.translations.fa.name || '—' }}</span>
                  <span
                    class="status-pill"
                    :class="`status-pill-${gameTone(game.status)}`"
                    :data-state="game.status"
                  >{{ t(`adminGames.status.${game.status}`) }}</span>
                </button>
              </li>
              <li
                v-if="filteredGames.length === 0"
                class="empty"
              >
                {{ search.trim() === '' ? t('adminGames.empty') : t('search.noResults') }}
              </li>
            </ul>
          </template>
        </div>

        <form
          class="editor data-panel"
          novalidate
          data-testid="game-form"
          @submit.prevent="save"
        >
          <h2>{{ editing ? t('adminGames.editing') : t('adminGames.creating') }}</h2>
          <p
            v-if="formError"
            class="form-alert"
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
            <RichTextEditor
              v-model="form[loc].body"
              :editor-id="`game-body-${loc}`"
              :label="t('adminGames.field.body')"
              :dir="loc === 'fa' ? 'rtl' : 'ltr'"
            />
          </fieldset>

          <AppField
            id="game-slug"
            v-model="form.slug"
            :label="t('adminGames.field.slug')"
            :error="slugError"
            latin
          />

          <ImagePicker
            v-model="form.coverImageUrl"
            :label="t('adminGames.field.cover')"
            :hint="t('adminGames.field.coverHint')"
            shape="square"
          />

          <div class="actions">
            <button
              type="submit"
              class="btn btn-primary"
              data-testid="save-game"
              :disabled="saving"
            >
              {{ saving ? t('adminGames.saving') : t('adminGames.save') }}
            </button>
            <template v-if="editing">
              <button
                v-if="editing.status !== 'published'"
                type="button"
                class="btn btn-secondary"
                data-testid="publish-game"
                @click="setStatus('published')"
              >
                {{ t('adminGames.publish') }}
              </button>
              <button
                v-if="editing.status === 'published'"
                type="button"
                class="btn btn-danger"
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
  gap: var(--space-4);
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}

@media (min-width: 60rem) {
  .layout {
    grid-template-columns: 18rem minmax(0, 1fr);
  }
}

.list-pane {
  padding: var(--space-3);
}

.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.item-row {
  inline-size: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  text-align: start;
  transition: background-color var(--motion-fast) var(--motion-ease), border-color var(--motion-fast) var(--motion-ease);
}
.item-row:hover {
  background-color: var(--color-surface-raised);
  border-color: var(--color-border-strong);
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  padding: var(--space-3);
  color: var(--color-text-muted);
  text-align: center;
}

.editor h2 {
  margin-block-start: 0;
}

.locale {
  display: block;
  margin-block-end: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.locale legend {
  padding-inline: var(--space-1);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-text-muted);
}

.form-alert {
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
  margin-block-start: var(--space-4);
}
</style>
