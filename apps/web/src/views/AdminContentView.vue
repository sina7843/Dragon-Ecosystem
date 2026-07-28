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

/**
 * Content administration (CONTENT-001). Authors and editors draft and edit; only
 * a publisher sees the publish/archive controls. The server enforces the same,
 * so hiding a control is convenience, not the boundary (section 9.4).
 */
const CONTENT_TYPES = ['news', 'article', 'announcement', 'guide', 'rules', 'page'] as const;

interface ContentItem {
  id: string;
  type: string;
  state: string;
  version: number;
  slugs: { fa: string; en: string };
  coverImageUrl: string | null;
  /** Optional game this item belongs to; drives the "content for this game" list. */
  gameId: string | null;
  translations: Record<'fa' | 'en', { title: string; summary: string; body: string }>;
}

interface GameOption { id: string; name: string }

const { t } = useI18n();
const { forbidden, has, refresh: refreshCaps } = useAdmin();
const { messageFor, fieldMessage } = useApiErrors();
const { push } = useToasts();

const canPublish = computed(() => has('content.publish'));

// Presentation-only mapping to a status-pill tone; the text label always carries the state.
function contentTone(state: string): string {
  if (state === 'published') return 'success';
  if (state === 'in_review') return 'warning';
  return 'neutral';
}

const loading = ref(true);
const listError = ref<string | undefined>(undefined);
const items = ref<ContentItem[]>([]);
const search = ref('');
const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return items.value;
  return items.value.filter((it) =>
    `${it.translations.en.title} ${it.translations.fa.title} ${it.slugs.en} ${it.slugs.fa}`.toLowerCase().includes(q)
  );
});
const editing = ref<ContentItem | null>(null);
const saving = ref(false);
const formError = ref<string | undefined>(undefined);
const fieldErrors = reactive<Record<string, string | undefined>>({});

const form = reactive({
  type: 'article',
  slugFa: '',
  slugEn: '',
  coverImageUrl: null as string | null,
  gameId: '',
  fa: { title: '', summary: '', body: '' },
  en: { title: '', summary: '', body: '' }
});

// Published games, offered so an item can be attached to one (drives the game page's
// "articles and guides" list). Optional: content may stay unattached.
const games = ref<GameOption[]>([]);

async function loadList(): Promise<void> {
  loading.value = true;
  try {
    const page = await apiFetch<{ items: ContentItem[] }>('/admin/content');
    items.value = page.items;
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
  try {
    games.value = (await apiFetch<{ items: GameOption[] }>('/games?limit=100')).items;
  } catch {
    games.value = []; // the selector simply stays empty; content can still be saved
  }
});

function resetForm(): void {
  editing.value = null;
  Object.assign(form, {
    type: 'article',
    slugFa: '',
    slugEn: '',
    coverImageUrl: null,
    gameId: '',
    fa: { title: '', summary: '', body: '' },
    en: { title: '', summary: '', body: '' }
  });
  formError.value = undefined;
}

function edit(item: ContentItem): void {
  editing.value = item;
  Object.assign(form, {
    type: item.type,
    slugFa: item.slugs.fa,
    slugEn: item.slugs.en,
    coverImageUrl: item.coverImageUrl,
    gameId: item.gameId ?? '',
    fa: { ...item.translations.fa },
    en: { ...item.translations.en }
  });
  formError.value = undefined;
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  formError.value = undefined;
  for (const key of Object.keys(fieldErrors)) fieldErrors[key] = undefined;

  const payload = {
    type: form.type,
    slugs: { fa: form.slugFa, en: form.slugEn },
    coverImageUrl: form.coverImageUrl,
    // Empty means "not attached to a game"; the server stores null.
    gameId: form.gameId === '' ? null : form.gameId,
    translations: { fa: form.fa, en: form.en }
  };

  try {
    if (editing.value === null) {
      const created = await apiFetch<ContentItem>('/admin/content', { method: 'POST', body: JSON.stringify(payload) });
      push('success', t('adminContent.created'));
      editing.value = created;
    } else {
      const updated = await apiFetch<ContentItem>(`/admin/content/${editing.value.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...payload, expectedVersion: editing.value.version })
      });
      editing.value = updated;
      push('success', t('adminContent.saved'));
    }
    await loadList();
  } catch (caught) {
    for (const field of ['slugs.fa', 'slugs.en', 'slug']) fieldErrors[field] = fieldMessage(caught, field);
    if (Object.values(fieldErrors).every((v) => v === undefined)) formError.value = messageFor(caught);
  } finally {
    saving.value = false;
  }
}

async function transition(to: string): Promise<void> {
  if (editing.value === null) return;
  const reason = globalThis.prompt(t('adminContent.reasonPrompt')) ?? '';
  if (reason.trim() === '') return;
  try {
    const updated = await apiFetch<ContentItem>(`/admin/content/${editing.value.id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ to, reason })
    });
    editing.value = updated;
    push('success', t('adminContent.transitioned'));
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
        <h1>{{ t('adminContent.heading') }}</h1>
      </div>
      <div class="page-header-actions">
        <button
          type="button"
          class="btn btn-primary"
          data-testid="new-content"
          @click="resetForm"
        >
          {{ t('adminContent.new') }}
        </button>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="content-forbidden"
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
              input-id="admin-content-search"
            />
            <ul class="items">
              <li
                v-for="item in filteredItems"
                :key="item.id"
              >
              <button
                type="button"
                class="item-row"
                :data-testid="`edit-${item.id}`"
                @click="edit(item)"
              >
                <span class="title">{{ item.translations.en.title || item.translations.fa.title || '—' }}</span>
                <span
                  class="status-pill"
                  :class="`status-pill-${contentTone(item.state)}`"
                  :data-state="item.state"
                >{{ t(`adminContent.state.${item.state}`) }}</span>
              </button>
              </li>
              <li
                v-if="filteredItems.length === 0"
                class="empty"
              >
                {{ search.trim() === '' ? t('adminContent.empty') : t('search.noResults') }}
              </li>
            </ul>
          </template>
        </div>

        <form
          class="editor data-panel"
          novalidate
          data-testid="content-form"
          @submit.prevent="save"
        >
          <h2>{{ editing ? t('adminContent.editing') : t('adminContent.creating') }}</h2>

          <p
            v-if="formError"
            class="form-alert"
            role="alert"
            data-testid="content-error"
          >
            {{ formError }}
          </p>

          <label class="type-field">
            <span>{{ t('adminContent.field.type') }}</span>
            <select
              id="field-type"
              v-model="form.type"
              :disabled="editing !== null"
              data-testid="field-type"
            >
              <option
                v-for="type in CONTENT_TYPES"
                :key="type"
                :value="type"
              >
                {{ t(`content.type.${type}`) }}
              </option>
            </select>
          </label>

          <label class="type-field">
            <span>{{ t('adminContent.field.game') }}</span>
            <select
              id="field-game"
              v-model="form.gameId"
              data-testid="field-game"
            >
              <option value="">
                {{ t('adminContent.field.gameNone') }}
              </option>
              <option
                v-for="g in games"
                :key="g.id"
                :value="g.id"
              >
                {{ g.name }}
              </option>
            </select>
          </label>

          <ImagePicker
            v-model="form.coverImageUrl"
            :label="t('adminContent.field.cover')"
            :hint="t('adminContent.field.coverHint')"
          />

          <fieldset
            v-for="loc in (['fa', 'en'] as const)"
            :key="loc"
            class="locale"
          >
            <legend>{{ t(`locale.name.${loc}`) }}</legend>
            <AppField
              :id="`title-${loc}`"
              v-model="form[loc].title"
              :label="t('adminContent.field.title')"
            />
            <AppField
              :id="`summary-${loc}`"
              v-model="form[loc].summary"
              :label="t('adminContent.field.summary')"
            />
            <RichTextEditor
              v-model="form[loc].body"
              :editor-id="`body-${loc}`"
              :label="t('adminContent.field.body')"
              :dir="loc === 'fa' ? 'rtl' : 'ltr'"
            />
          </fieldset>

          <AppField
            id="slug-fa"
            v-model="form.slugFa"
            :label="t('adminContent.field.slugFa')"
            :error="fieldErrors['slugs.fa']"
            latin
          />
          <AppField
            id="slug-en"
            v-model="form.slugEn"
            :label="t('adminContent.field.slugEn')"
            :error="fieldErrors['slugs.en']"
            latin
          />

          <div class="actions">
            <button
              type="submit"
              class="btn btn-primary"
              data-testid="save-content"
              :disabled="saving"
            >
              {{ saving ? t('adminContent.saving') : t('adminContent.save') }}
            </button>

            <template v-if="editing">
              <button
                v-if="editing.state === 'draft'"
                type="button"
                class="btn btn-secondary"
                data-testid="submit-review"
                @click="transition('in_review')"
              >
                {{ t('adminContent.submitReview') }}
              </button>
              <button
                v-if="canPublish && editing.state === 'in_review'"
                type="button"
                class="btn btn-secondary"
                data-testid="publish"
                @click="transition('published')"
              >
                {{ t('adminContent.publish') }}
              </button>
              <button
                v-if="canPublish && editing.state === 'published'"
                type="button"
                class="btn btn-danger"
                data-testid="archive"
                @click="transition('archived')"
              >
                {{ t('adminContent.archive') }}
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
    grid-template-columns: 20rem minmax(0, 1fr);
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

.form-alert {
  padding: var(--space-3);
  border: 1px solid var(--color-danger-text);
  border-radius: var(--radius-md);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.locale,
.type-field,
.body-field {
  display: block;
  margin-block-end: var(--space-3);
}

.locale {
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

.type-field > span,
.body-field > span {
  display: block;
  margin-block-end: var(--space-1);
  font-weight: var(--weight-semibold);
}

select,
textarea {
  inline-size: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-block-start: var(--space-4);
}
</style>
