<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import {
  getMyRegistration,
  listMyRegistrations,
  type MyRegistration,
  type MyRegistrationDetail
} from '../composables/useRegistrationsApi.ts';

/**
 * The participant's own tournament registrations and their status history (PAGE-017).
 *
 * The page shows what the participant is entitled to see and nothing more: the server
 * projection carries no staff reason, no deciding administrator, and no submitted answers,
 * so there is nothing here to accidentally render. A registration whose tournament has since
 * been removed stays listed with an explicit unavailable reference rather than a dead link —
 * the entry is part of the participant's own record and does not disappear with the event.
 */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = () => `/${activeLocale()}`;

const loading = ref(true);
const loadingMore = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const items = ref<MyRegistration[]>([]);
const nextCursor = ref<string | null>(null);
const detail = ref<MyRegistrationDetail | null>(null);
const detailError = ref<string | undefined>(undefined);
const openId = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = undefined;
  try {
    const page = await listMyRegistrations();
    items.value = page.items;
    nextCursor.value = page.nextCursor;
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (nextCursor.value === null || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const page = await listMyRegistrations(nextCursor.value);
    items.value = [...items.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    loadingMore.value = false;
  }
}

/** Opens one registration's history, or closes it when it is already open. */
async function toggle(registrationId: string): Promise<void> {
  if (openId.value === registrationId) {
    openId.value = null;
    detail.value = null;
    return;
  }
  openId.value = registrationId;
  detail.value = null;
  detailError.value = undefined;
  try {
    detail.value = await getMyRegistration(registrationId);
  } catch (error) {
    detailError.value = messageFor(error);
  }
}

function when(value: string): string {
  return formatDateTime(value, activeLocale(), viewerTimeZone());
}

onMounted(load);
</script>

<template>
  <section class="stack">
    <h1>{{ t('registrations.mine.title') }}</h1>
    <p class="muted">
      {{ t('registrations.mine.intro') }}
    </p>

    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />
    <StateBlock
      v-else-if="items.length === 0"
      variant="empty"
      :message="t('registrations.mine.empty')"
    />

    <ul
      v-else
      class="entries"
      data-testid="my-registrations"
    >
      <li
        v-for="registration in items"
        :key="registration.id"
        class="entry"
        data-testid="my-registration"
      >
        <div class="entry-head">
          <p class="tournament">
            <!-- A removed tournament keeps the registration readable and says so, rather
                 than rendering a link that resolves to nothing. -->
            <RouterLink
              v-if="registration.tournament"
              :to="`${prefix()}/tournaments/${registration.tournament.slug}`"
              data-testid="registration-tournament"
            >{{ registration.tournament.slug }}</RouterLink>
            <span
              v-else
              class="unavailable"
              data-testid="registration-tournament-unavailable"
            >{{ t('registrations.mine.tournamentUnavailable') }}</span>
          </p>
          <p
            class="status"
            data-testid="registration-state"
            :data-state="registration.state"
          >
            {{ t(`registration.state.${registration.state}`) }}
          </p>
        </div>

        <dl class="facts">
          <div>
            <dt>{{ t('registrations.mine.participantType') }}</dt>
            <dd>{{ t(`registrations.mine.type.${registration.participantType}`) }}</dd>
          </div>
          <div>
            <dt>{{ t('registrations.mine.submitted') }}</dt>
            <dd>
              <time :datetime="registration.createdAt">{{ when(registration.createdAt) }}</time>
            </dd>
          </div>
          <div v-if="registration.waitlistSeq !== null">
            <dt>{{ t('registrations.mine.waitlistPosition') }}</dt>
            <dd>{{ registration.waitlistSeq }}</dd>
          </div>
        </dl>

        <button
          type="button"
          class="secondary"
          :aria-expanded="openId === registration.id"
          data-testid="registration-history-toggle"
          @click="toggle(registration.id)"
        >
          {{ openId === registration.id ? t('registrations.mine.hideHistory') : t('registrations.mine.showHistory') }}
        </button>

        <div v-if="openId === registration.id">
          <p
            v-if="detailError"
            class="error"
            role="alert"
          >
            {{ detailError }}
          </p>
          <StateBlock
            v-else-if="detail === null"
            variant="loading"
          />
          <template v-else>
            <!-- An ordered list, because a status history is a sequence: assistive technology
                 announces the position, and the order is the meaning. -->
            <ol
              v-if="detail.history.length > 0"
              class="history"
              data-testid="registration-history"
            >
              <li
                v-for="entry in detail.history"
                :key="entry.revision"
                data-testid="registration-history-entry"
              >
                <span class="history-state">{{ t(`registration.state.${entry.toState}`) }}</span>
                <span class="muted">
                  <time :datetime="entry.occurredAt">{{ when(entry.occurredAt) }}</time>
                  ·
                  {{ t(`registrations.mine.actor.${entry.actor}`) }}
                </span>
              </li>
            </ol>
            <!-- Shown whenever the trail does not reach back to the registration itself,
                 including when some later entries exist: a partial list presented as complete
                 would be a quieter kind of wrong than an empty one. -->
            <p
              v-if="!detail.historyComplete"
              class="muted"
              data-testid="registration-history-unavailable"
            >
              {{ t('registrations.mine.historyUnavailable') }}
            </p>
          </template>
        </div>
      </li>
    </ul>

    <button
      v-if="nextCursor"
      type="button"
      :disabled="loadingMore"
      data-testid="my-registrations-more"
      @click="loadMore"
    >
      {{ loadingMore ? t('registrations.mine.loadingMore') : t('registrations.mine.more') }}
    </button>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-raised);
}
.entry-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.tournament {
  margin: 0;
  font-weight: var(--weight-bold);
  /* The slug is a Latin token inside possibly-Persian prose. */
  overflow-wrap: anywhere;
}
.status {
  margin: 0;
  font-weight: var(--weight-bold);
}
.unavailable {
  color: var(--color-text-muted);
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0;
}
.facts dt {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.facts dd {
  margin: 0;
  font-size: var(--text-sm);
}
.history {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  padding-inline-start: var(--space-5);
}
.history-state {
  font-weight: var(--weight-bold);
  margin-inline-end: var(--space-2);
}
button {
  align-self: flex-start;
  padding: var(--space-2) var(--space-4);
  min-block-size: var(--target-min);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-sunken);
  color: var(--color-text);
  cursor: pointer;
}
button:disabled {
  cursor: not-allowed;
  color: var(--color-text-muted);
}
</style>
