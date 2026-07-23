<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDate, formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { tournamentCalendar, type TournamentCard } from '../composables/useTournamentsApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';

/** Public tournament calendar: published tournaments grouped by start date (acceptance). */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const items = ref<TournamentCard[]>([]);

/** Groups the flat list by calendar day for a simple month-agenda view. */
const groups = computed<Array<{ day: string; label: string; entries: TournamentCard[] }>>(() => {
  const byDay = new Map<string, TournamentCard[]>();
  for (const item of items.value) {
    if (item.startAt === null) continue;
    const day = item.startAt.slice(0, 10);
    const bucket = byDay.get(day) ?? [];
    bucket.push(item);
    byDay.set(day, bucket);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, entries]) => ({ day, label: formatDate(`${day}T00:00:00.000Z`, activeLocale()), entries }));
});

onMounted(async () => {
  try {
    // A wide window so the agenda shows the season without a month picker (a fuller
    // calendar widget is later scope). The server caps the result set.
    const from = '2000-01-01T00:00:00.000Z';
    const to = '2100-01-01T00:00:00.000Z';
    items.value = (await tournamentCalendar({ locale: activeLocale(), from, to })).items;
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('tournaments.calendar.heading') }}</h1>
      </div>
      <div class="page-header-actions">
        <RouterLink
          class="btn btn-ghost"
          :to="`${prefix}/tournaments`"
        >
          {{ t('tournaments.calendar.listLink') }}
        </RouterLink>
      </div>
    </div>

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
      v-else-if="groups.length === 0"
      variant="empty"
      :message="t('tournaments.calendar.empty')"
    />

    <div
      v-else
      data-testid="calendar"
    >
      <section
        v-for="group in groups"
        :key="group.day"
        class="day"
      >
        <h2 class="day-heading">
          {{ group.label }}
        </h2>
        <ul class="reset-list">
          <li
            v-for="entry in group.entries"
            :key="entry.id"
            class="entry"
          >
            <RouterLink
              class="entry-link"
              :to="`${prefix}/tournaments/${entry.slug}`"
            >
              {{ entry.name }}
            </RouterLink>
            <span class="time numeric">{{ entry.startAt ? formatDateTime(entry.startAt, activeLocale(), viewerTimeZone()) : '' }}</span>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.day {
  margin-block: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.day-heading {
  margin-block: 0 var(--space-2);
  font-size: var(--text-lg);
}

.reset-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.entry {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-3);
  padding-block: var(--space-2);
  border-block-start: 1px solid var(--color-border);
}
.entry:first-child {
  border-block-start: none;
}

.entry-link {
  color: inherit;
  text-decoration: none;
}
.entry-link:hover {
  color: var(--color-accent);
}

.time {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
</style>
