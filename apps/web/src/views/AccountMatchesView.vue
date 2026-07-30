<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { listMyMatches, type MyMatch } from '../composables/useRegistrationsApi.ts';

/**
 * The participant's own match schedule (PAGE-018).
 *
 * Times arrive as UTC and are formatted in the viewer's own zone (TOURN-019), so the same
 * fixture reads correctly wherever the participant is. A fixture whose time has moved is
 * marked and shows what it was — but never the operator's reason, which is staff-facing
 * (TOURN-020) and is not part of this response.
 *
 * Upcoming and completed are separated because they answer different questions: one is
 * "where do I need to be", the other is "how did it go".
 */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = () => `/${activeLocale()}`;

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const matches = ref<MyMatch[]>([]);
const truncated = ref(false);

const upcoming = computed(() => matches.value.filter((m) => m.state !== 'completed'));
const completed = computed(() => matches.value.filter((m) => m.state === 'completed'));

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = undefined;
  try {
    const page = await listMyMatches();
    matches.value = page.items;
    truncated.value = page.truncated;
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
}

function when(value: string): string {
  return formatDateTime(value, activeLocale(), viewerTimeZone());
}

/** The result from this participant's side; null while the fixture is undecided. */
function outcome(match: MyMatch): string | null {
  if (match.state !== 'completed' || match.won === null) return null;
  return match.won ? t('matches.mine.won') : t('matches.mine.lost');
}

onMounted(load);
</script>

<template>
  <section class="stack">
    <h1>{{ t('matches.mine.title') }}</h1>
    <p class="muted">
      {{ t('matches.mine.intro', { zone: viewerTimeZone() }) }}
    </p>
    <p
      v-if="truncated"
      class="muted"
      role="note"
      data-testid="my-matches-truncated"
    >
      {{ t('matches.mine.truncated') }}
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
      v-else-if="matches.length === 0"
      variant="empty"
      :message="t('matches.mine.empty')"
    />

    <template v-else>
      <section
        v-for="group in [
          { key: 'upcoming', rows: upcoming, testid: 'my-matches-upcoming' },
          { key: 'completed', rows: completed, testid: 'my-matches-completed' }
        ]"
        :key="group.key"
      >
        <h2>{{ t(`matches.mine.${group.key}`) }}</h2>
        <p
          v-if="group.rows.length === 0"
          class="muted"
        >
          {{ t(`matches.mine.no${group.key === 'upcoming' ? 'Upcoming' : 'Completed'}`) }}
        </p>
        <ul
          v-else
          class="matches"
          :data-testid="group.testid"
        >
          <li
            v-for="match in group.rows"
            :key="match.id"
            class="match"
            data-testid="my-match"
          >
            <div class="match-head">
              <p class="opponent">
                {{ t('matches.mine.opponent') }}:
                <!-- dir="auto" so a Persian display name inside the English page, or the
                     reverse, keeps its own direction. -->
                <bdi
                  v-if="match.opponent && match.opponent.name"
                  dir="auto"
                  data-testid="match-opponent"
                >{{ match.opponent.name }}</bdi>
                <span
                  v-else-if="match.opponent"
                  class="muted"
                  data-testid="match-opponent-unavailable"
                >{{ t('matches.mine.opponentUnavailable') }}</span>
                <span
                  v-else
                  class="muted"
                  data-testid="match-opponent-pending"
                >{{ t('matches.mine.opponentPending') }}</span>
              </p>
              <p
                v-if="outcome(match)"
                class="outcome"
                data-testid="match-outcome"
              >
                {{ outcome(match) }}
              </p>
            </div>

            <p
              class="time"
              data-testid="match-time"
            >
              <template v-if="match.scheduledAt">
                <time :datetime="match.scheduledAt">{{ when(match.scheduledAt) }}</time>
              </template>
              <span
                v-else
                class="muted"
                data-testid="match-unscheduled"
              >{{ t('matches.mine.notScheduled') }}</span>
            </p>

            <p
              v-if="match.rescheduled"
              class="rescheduled"
              data-testid="match-rescheduled"
            >
              {{ t('matches.mine.rescheduled') }}
              <span
                v-if="match.previousScheduledAt"
                class="muted"
              >
                ({{ t('matches.mine.previously') }}
                <time :datetime="match.previousScheduledAt">{{ when(match.previousScheduledAt) }}</time>)
              </span>
            </p>

            <p class="tournament">
              <RouterLink
                v-if="match.tournament"
                :to="`${prefix()}/tournaments/${match.tournament.slug}`"
                data-testid="match-tournament"
              >{{ match.tournament.slug }}</RouterLink>
              <span
                v-else
                class="muted"
                data-testid="match-tournament-unavailable"
              >{{ t('matches.mine.tournamentUnavailable') }}</span>
            </p>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.matches {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.match {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-raised);
}
.match-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.opponent,
.time,
.rescheduled,
.tournament,
.outcome {
  margin: 0;
  overflow-wrap: anywhere;
}
.outcome {
  font-weight: var(--weight-bold);
}
.rescheduled {
  font-size: var(--text-sm);
  /* A non-colour cue as well: the label itself states the change. */
  border-inline-start: 3px solid var(--color-accent);
  padding-inline-start: var(--space-2);
}
h2 {
  font-size: var(--text-md);
  margin-block: var(--space-4) var(--space-2);
}
</style>
