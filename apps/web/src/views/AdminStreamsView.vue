<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppField from '../components/AppField.vue';
import StateBlock from '../components/StateBlock.vue';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import {
  confirmStreamRights,
  createStream,
  getStreamingConfig,
  listAdminStreams,
  provisionStream,
  reconcileStream,
  setStreamState,
  type AdminStream,
  type StreamState,
  type StreamingConfigView
} from '../composables/useStreamsApi.ts';

/**
 * Stream operations console (PAGE-052).
 *
 * The operator's job here is provider linkage, schedule, monitoring, and recovery. Every
 * control is offered from the stream's own stored state, and every refusal comes from the
 * server — hiding a button is never the boundary (section 9.4).
 *
 * A provider failure surfaces its correlation id, because that is the only thing that
 * connects what the operator sees to the API log (STREAM-008).
 */

const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor, fieldMessage } = useApiErrors();
const { push } = useToasts();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const loading = ref(true);
const listError = ref<string | undefined>(undefined);
const streams = ref<AdminStream[]>([]);
const config = ref<StreamingConfigView | null>(null);
const busy = ref('');
const formError = ref<string | undefined>(undefined);
const slugError = ref<string | undefined>(undefined);
const creating = ref(false);

const form = reactive({
  slug: '',
  accessMode: 'public' as 'public' | 'authenticated',
  scheduledStartAt: '',
  faTitle: '',
  enTitle: ''
});

/** Which lifecycle moves an operator may attempt from here (section 12.9). */
const NEXT_STATES: Readonly<Record<string, readonly StreamState[]>> = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['live', 'cancelled'],
  live: ['ended'],
  ended: ['archived'],
  failed: ['scheduled', 'live', 'ended'],
  cancelled: [],
  archived: []
};

function syncTone(state: string): string {
  if (state === 'ready') return 'success';
  if (state === 'failed') return 'danger';
  return 'neutral';
}

async function loadList(): Promise<void> {
  loading.value = true;
  try {
    const [page, streamingConfig] = await Promise.all([listAdminStreams(), getStreamingConfig()]);
    streams.value = page.items;
    config.value = streamingConfig;
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

/** Runs one operator action, keeping the row's spinner and the error handling in one place. */
async function run(id: string, action: () => Promise<AdminStream>, successKey: string): Promise<void> {
  if (busy.value !== '') return;
  busy.value = id;
  try {
    await action();
    push('success', t(successKey));
    await loadList();
  } catch (caught) {
    push('danger', messageFor(caught));
  } finally {
    busy.value = '';
  }
}

async function create(): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  formError.value = undefined;
  slugError.value = undefined;
  try {
    await createStream({
      ...(form.slug.trim() === '' ? {} : { slug: form.slug.trim() }),
      accessMode: form.accessMode,
      ...(form.scheduledStartAt === '' ? {} : { scheduledStartAt: new Date(form.scheduledStartAt).toISOString() }),
      translations: { fa: { title: form.faTitle }, en: { title: form.enTitle } }
    });
    push('success', t('adminStreams.created'));
    Object.assign(form, { slug: '', accessMode: 'public', scheduledStartAt: '', faTitle: '', enTitle: '' });
    await loadList();
  } catch (caught) {
    slugError.value = fieldMessage(caught, 'slug');
    if (slugError.value === undefined) formError.value = messageFor(caught);
  } finally {
    creating.value = false;
  }
}

/** Draft rights reference per row, so the approval is typed in place rather than guessed. */
const rightsDraft = reactive<Record<string, string>>({});

function confirmRights(stream: AdminStream): void {
  const reference = (rightsDraft[stream.id] ?? '').trim();
  if (reference === '') return;
  void run(stream.id, () => confirmStreamRights(stream.id, { expectedVersion: stream.version, reference }), 'adminStreams.rightsConfirmed');
}

function move(stream: AdminStream, state: StreamState): void {
  void run(
    stream.id,
    () => setStreamState(stream.id, { state, expectedVersion: stream.version, reason: t('adminStreams.stateReason', { state: t(`streams.state.${state}`) }) }),
    'adminStreams.stateChanged'
  );
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('adminStreams.heading') }}</h1>
        <p class="page-lead">
          {{ t('adminStreams.intro') }}
        </p>
      </div>
      <div
        v-if="config"
        class="page-header-actions"
      >
        <span
          class="badge badge-neutral"
          data-testid="streams-provider"
        >{{ t('adminStreams.provider', { provider: config.provider }) }}</span>
        <!-- OD-014: the console states plainly that archive and takedown are gated, so an
             operator is not left guessing why the control refuses. -->
        <span
          v-if="!config.rightsPolicyApproved"
          class="badge badge-warning"
          data-testid="streams-rights-gate"
        >{{ t('adminStreams.rightsPolicyGated') }}</span>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="streams-forbidden"
    />

    <template v-else>
      <form
        class="create-form data-panel"
        data-testid="stream-create-form"
        @submit.prevent="create"
      >
        <h2>{{ t('adminStreams.createHeading') }}</h2>
        <div class="fields">
          <AppField
            id="stream-en-title"
            v-model="form.enTitle"
            :label="t('adminStreams.field.titleEn')"
            required
          />
          <AppField
            id="stream-fa-title"
            v-model="form.faTitle"
            :label="t('adminStreams.field.titleFa')"
            required
          />
          <AppField
            id="stream-slug"
            v-model="form.slug"
            :label="t('adminStreams.field.slug')"
            :error="slugError"
          />
          <AppField
            id="stream-start"
            v-model="form.scheduledStartAt"
            type="datetime-local"
            :label="t('streams.field.scheduledStartAt')"
          />
          <label class="access-field">
            <span class="field-label">{{ t('adminStreams.field.accessMode') }}</span>
            <select
              v-model="form.accessMode"
              data-testid="stream-access-mode-select"
            >
              <option value="public">{{ t('streams.access.public') }}</option>
              <option value="authenticated">{{ t('streams.access.authenticated') }}</option>
            </select>
          </label>
        </div>
        <p
          v-if="formError"
          class="form-error"
          role="alert"
        >
          {{ formError }}
        </p>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="creating"
          data-testid="stream-create-submit"
        >
          {{ t('adminStreams.create') }}
        </button>
      </form>

      <StateBlock
        v-if="loading"
        variant="loading"
      />
      <StateBlock
        v-else-if="listError"
        variant="error"
        :message="listError"
      />
      <StateBlock
        v-else-if="streams.length === 0"
        variant="empty"
        :message="t('adminStreams.empty')"
      />

      <ul
        v-else
        class="stream-rows"
        data-testid="admin-stream-list"
      >
        <li
          v-for="stream in streams"
          :key="stream.id"
          class="card stream-row"
          :data-testid="`admin-stream-${stream.slug}`"
        >
          <div class="row-head">
            <h2 class="card-title">
              {{ stream.translations[activeLocale()].title || stream.slug }}
            </h2>
            <span
              class="status-pill status-pill-neutral"
              :data-testid="`admin-stream-state-${stream.slug}`"
            >{{ t(`streams.state.${stream.state}`) }}</span>
            <span
              class="badge"
              :class="`badge-${syncTone(stream.provider.syncState)}`"
              :data-testid="`admin-stream-sync-${stream.slug}`"
            >{{ t(`adminStreams.sync.${stream.provider.syncState}`) }}</span>
            <span
              v-if="!stream.rights.confirmed"
              class="badge badge-warning"
              :data-testid="`admin-stream-rights-${stream.slug}`"
            >{{ t('adminStreams.rightsMissing') }}</span>
          </div>

          <dl class="meta">
            <div v-if="stream.scheduledStartAt">
              <dt>{{ t('streams.field.scheduledStartAt') }}</dt>
              <dd>{{ formatDateTime(stream.scheduledStartAt, activeLocale(), viewerTimeZone()) }}</dd>
            </div>
            <div>
              <dt>{{ t('adminStreams.field.accessMode') }}</dt>
              <dd>{{ t(`streams.access.${stream.accessMode}`) }}</dd>
            </div>
            <div>
              <dt>{{ t('adminStreams.field.attempts') }}</dt>
              <dd>{{ stream.provider.attempts }}</dd>
            </div>
          </dl>

          <!-- The correlation id is the only handle that ties this failure to the API log. -->
          <p
            v-if="stream.provider.lastError"
            class="provider-error"
            role="alert"
            :data-testid="`admin-stream-error-${stream.slug}`"
          >
            {{ t('adminStreams.providerFailed') }}
            <code class="latin-value">{{ stream.provider.lastError.correlationId }}</code>
          </p>

          <!-- Rights confirmation records which approval was relied on, so the reference
               is typed here rather than implied by pressing a button. -->
          <div
            v-if="!stream.rights.confirmed"
            class="rights-field"
          >
            <!-- Explicit model binding: an unseeded row reads as undefined under
                 noUncheckedIndexedAccess, and the field takes a string. -->
            <AppField
              :id="`rights-${stream.id}`"
              :model-value="rightsDraft[stream.id] ?? ''"
              :label="t('adminStreams.field.rightsReference')"
              :hint="t('adminStreams.rightsHint')"
              @update:model-value="rightsDraft[stream.id] = $event"
            />
          </div>

          <div class="row-actions">
            <button
              v-if="!stream.rights.confirmed"
              type="button"
              class="btn btn-neutral"
              :disabled="busy === stream.id || (rightsDraft[stream.id] ?? '').trim() === ''"
              :data-testid="`confirm-rights-${stream.slug}`"
              @click="confirmRights(stream)"
            >
              {{ t('adminStreams.confirmRights') }}
            </button>
            <button
              v-if="stream.provider.syncState !== 'ready'"
              type="button"
              class="btn btn-neutral"
              :disabled="busy === stream.id"
              :data-testid="`provision-${stream.slug}`"
              @click="run(stream.id, () => provisionStream(stream.id), 'adminStreams.provisioned')"
            >
              {{ t('adminStreams.provision') }}
            </button>
            <button
              v-if="stream.provider.streamId"
              type="button"
              class="btn btn-ghost"
              :disabled="busy === stream.id"
              :data-testid="`reconcile-${stream.slug}`"
              @click="run(stream.id, () => reconcileStream(stream.id), 'adminStreams.reconciled')"
            >
              {{ t('adminStreams.reconcile') }}
            </button>
            <button
              v-for="next in NEXT_STATES[stream.state] ?? []"
              :key="next"
              type="button"
              class="btn btn-neutral"
              :disabled="busy === stream.id"
              :data-testid="`move-${stream.slug}-${next}`"
              @click="move(stream, next)"
            >
              {{ t('adminStreams.moveTo', { state: t(`streams.state.${next}`) }) }}
            </button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.create-form {
  margin-block-end: var(--space-5);
  padding: var(--space-4);
}
.create-form h2 {
  margin-block: 0 var(--space-3);
  font-size: var(--text-lg);
}
.fields {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  margin-block-end: var(--space-3);
}

.access-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.field-label {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-eyebrow);
  color: var(--color-text-muted);
}
[lang='fa'] .field-label {
  font-family: var(--font-sans);
  text-transform: none;
  letter-spacing: normal;
  font-size: var(--text-sm);
}
.access-field select {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.form-error {
  margin-block: 0 var(--space-3);
  color: var(--color-danger-text);
}

.stream-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}

.stream-row {
  padding: var(--space-4);
}

.row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-block-end: var(--space-3);
}
.card-title {
  margin: 0;
  margin-inline-end: auto;
  font-size: var(--text-lg);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
}
.meta dt {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-eyebrow);
}
[lang='fa'] .meta dt {
  font-family: var(--font-sans);
  text-transform: none;
  letter-spacing: normal;
  font-size: var(--text-sm);
}
.meta dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.provider-error {
  margin-block: 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-inline-start: 4px solid var(--color-danger-text);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.rights-field {
  max-inline-size: 28rem;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
