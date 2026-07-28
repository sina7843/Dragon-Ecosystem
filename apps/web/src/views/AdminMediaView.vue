<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSearch from '../components/AppSearch.vue';
import StateBlock from '../components/StateBlock.vue';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { deleteMedia, listMedia, publishMedia, setMediaAlt, type MediaAsset } from '../composables/useAdminConsolesApi.ts';
import { formatDateTime, formatNumber, formatRelativeTime, viewerTimeZone } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Media library (FEATURE-005). Upload, publish, alt-text editing and deletion all
 * existed server-side with no screen: assets were only reachable through the per-field
 * picker that created them, so nothing could be reviewed, reused, or cleaned up.
 *
 * Gated on `content.publish` — the server enforces it and returns 403 either way; the
 * forbidden state here only avoids showing an operator controls they cannot use.
 */
const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();

const STATES = ['', 'staged', 'published'] as const;

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const loading = ref(true);
const error = ref<string | undefined>(undefined);
const assets = ref<MediaAsset[]>([]);
const nextCursor = ref<string | null>(null);
const stateFilter = ref<(typeof STATES)[number]>('');
const search = ref('');
const busy = ref('');

/** Alt-text drafts, keyed by asset id, so several rows can be edited before saving. */
const altDrafts = ref<Map<string, { fa: string; en: string }>>(new Map());

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return assets.value;
  return assets.value.filter((a) => `${a.alt.fa} ${a.alt.en} ${a.contentType} ${a.id}`.toLowerCase().includes(q));
});

function draftFor(asset: MediaAsset): { fa: string; en: string } {
  const existing = altDrafts.value.get(asset.id);
  if (existing !== undefined) return existing;
  const draft = { fa: asset.alt.fa, en: asset.alt.en };
  altDrafts.value.set(asset.id, draft);
  return draft;
}

/** Human byte size; media caps are in the megabyte range so one decimal is enough. */
function sizeLabel(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 1024
    ? `${formatNumber(Math.round(kb), activeLocale.value)} ${t('admin.media.kb')}`
    : `${formatNumber(Math.round((kb / 1024) * 10) / 10, activeLocale.value)} ${t('admin.media.mb')}`;
}

async function load(cursor?: string): Promise<void> {
  loading.value = true;
  try {
    const page = await listMedia({ ...(stateFilter.value === '' ? {} : { state: stateFilter.value }), ...(cursor === undefined ? {} : { cursor }) });
    assets.value = cursor === undefined ? page.items : [...assets.value, ...page.items];
    nextCursor.value = page.nextCursor;
    error.value = undefined;
  } catch (caught) {
    error.value = messageFor(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await refreshCaps();
  await load();
});

function onFilterChange(): void {
  altDrafts.value = new Map();
  void load();
}

/** Replaces one asset in place so a save never reorders or reloads the whole list. */
function replace(updated: MediaAsset): void {
  assets.value = assets.value.map((a) => (a.id === updated.id ? updated : a));
  altDrafts.value.set(updated.id, { fa: updated.alt.fa, en: updated.alt.en });
}

async function onPublish(asset: MediaAsset): Promise<void> {
  if (busy.value !== '') return;
  busy.value = asset.id;
  try {
    replace(await publishMedia(asset.id, asset.version));
    push('success', t('admin.media.published'));
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = '';
  }
}

async function onSaveAlt(asset: MediaAsset): Promise<void> {
  if (busy.value !== '') return;
  busy.value = asset.id;
  try {
    replace(await setMediaAlt(asset.id, draftFor(asset), asset.version));
    push('success', t('admin.media.altSaved'));
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = '';
  }
}

/**
 * Deletion is refused by the server while anything still references the asset, which is
 * the real guard. The confirm here only prevents an accidental click.
 */
async function onDelete(asset: MediaAsset): Promise<void> {
  if (busy.value !== '' || !globalThis.confirm(t('admin.media.confirmDelete'))) return;
  busy.value = asset.id;
  try {
    await deleteMedia(asset.id);
    assets.value = assets.value.filter((a) => a.id !== asset.id);
    push('success', t('admin.media.deleted'));
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('admin.media.heading') }}</h1>
        <p class="page-lead">
          {{ t('admin.media.intro') }}
        </p>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="media-forbidden"
    />
    <template v-else>
      <div class="toolbar">
        <label
          class="filter-label"
          for="media-state-filter"
        >{{ t('admin.media.stateFilter') }}</label>
        <select
          id="media-state-filter"
          v-model="stateFilter"
          data-testid="media-state-filter"
          @change="onFilterChange"
        >
          <option
            v-for="s in STATES"
            :key="s"
            :value="s"
          >
            {{ s === '' ? t('content.hub.all') : t(`admin.media.state.${s}`) }}
          </option>
        </select>
      </div>

      <StateBlock
        v-if="loading && assets.length === 0"
        variant="loading"
      />
      <StateBlock
        v-else-if="error"
        variant="error"
        :message="error"
      />
      <template v-else>
        <AppSearch
          v-model="search"
          input-id="admin-media-search"
        />
        <StateBlock
          v-if="filtered.length === 0"
          variant="empty"
          :message="search.trim() === '' ? t('admin.media.empty') : t('search.noResults')"
        />
        <ul
          v-else
          class="library"
          data-testid="media-list"
        >
          <li
            v-for="asset in filtered"
            :key="asset.id"
            class="card asset"
            :data-testid="`media-${asset.id}`"
          >
            <!-- The asset itself is the primary information; alt text describes it, so
                 the preview stays decorative here to avoid reading it twice. -->
            <img
              class="preview"
              :src="asset.url"
              alt=""
            >
            <div class="meta">
              <div class="meta-head">
                <span
                  class="status-pill"
                  :class="asset.state === 'published' ? 'status-pill-success' : 'status-pill-neutral'"
                  :data-testid="`media-state-${asset.id}`"
                >{{ t(`admin.media.state.${asset.state}`) }}</span>
                <span class="muted">{{ asset.contentType }} · {{ sizeLabel(asset.byteSize) }}</span>
                <time
                  class="muted"
                  :datetime="asset.createdAt"
                  :title="formatDateTime(asset.createdAt, activeLocale, viewerTimeZone())"
                >{{ formatRelativeTime(asset.createdAt, activeLocale) }}</time>
              </div>

              <!-- Alt text is the reason this screen matters: it is the only place an
                   operator can review or correct what was written at upload time. -->
              <div class="alt-fields">
                <label :for="`alt-fa-${asset.id}`">
                  <span>{{ t('admin.media.altFa') }}</span>
                  <input
                    :id="`alt-fa-${asset.id}`"
                    v-model="draftFor(asset).fa"
                    type="text"
                    :data-testid="`alt-fa-${asset.id}`"
                    :placeholder="t('admin.media.altDecorative')"
                  >
                </label>
                <label :for="`alt-en-${asset.id}`">
                  <span>{{ t('admin.media.altEn') }}</span>
                  <input
                    :id="`alt-en-${asset.id}`"
                    v-model="draftFor(asset).en"
                    type="text"
                    :data-testid="`alt-en-${asset.id}`"
                    :placeholder="t('admin.media.altDecorative')"
                  >
                </label>
              </div>

              <div class="actions">
                <button
                  type="button"
                  class="btn btn-primary"
                  :disabled="busy !== ''"
                  :data-testid="`save-alt-${asset.id}`"
                  @click="onSaveAlt(asset)"
                >
                  {{ t('admin.media.saveAlt') }}
                </button>
                <button
                  v-if="asset.state === 'staged'"
                  type="button"
                  class="btn btn-secondary"
                  :disabled="busy !== ''"
                  :data-testid="`publish-${asset.id}`"
                  @click="onPublish(asset)"
                >
                  {{ t('admin.media.publish') }}
                </button>
                <a
                  class="btn btn-ghost"
                  :href="asset.url"
                  target="_blank"
                  rel="noopener"
                >{{ t('admin.media.open') }}</a>
                <button
                  type="button"
                  class="btn btn-ghost danger"
                  :disabled="busy !== ''"
                  :data-testid="`delete-${asset.id}`"
                  @click="onDelete(asset)"
                >
                  {{ t('admin.media.delete') }}
                </button>
              </div>
            </div>
          </li>
        </ul>

        <button
          v-if="nextCursor"
          type="button"
          class="btn btn-neutral more"
          data-testid="load-more"
          @click="load(nextCursor ?? undefined)"
        >
          {{ t('admin.media.loadMore') }}
        </button>
      </template>
    </template>
  </section>
</template>

<style scoped>
.filter-label {
  font-weight: var(--weight-semibold);
  font-size: var(--text-sm);
}

select,
input[type='text'] {
  padding: var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.library {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.asset {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: flex-start;
}

.preview {
  flex: none;
  inline-size: 8rem;
  block-size: 4.5rem;
  object-fit: cover;
  border-radius: var(--radius-md);
  background-color: var(--color-surface-sunken);
}

.meta {
  flex: 1;
  min-inline-size: 14rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.meta-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.muted {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.alt-fields {
  display: grid;
  gap: var(--space-2);
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}

.alt-fields label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-sm);
}

.alt-fields input {
  inline-size: 100%;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.danger {
  color: var(--color-danger);
}

.more {
  margin-block-start: var(--space-4);
}
</style>
