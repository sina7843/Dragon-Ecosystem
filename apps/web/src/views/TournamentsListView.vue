<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, viewerTimeZone } from '../i18n/format.ts';
import { listTournaments, type TournamentCard } from '../composables/useTournamentsApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';

/** Public tournament discovery list (upcoming first). Only published tournaments appear. */

interface GameCard { id: string; name: string }

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');
const prefix = computed(() => `/${activeLocale()}`);

const loading = ref(true);
const errorMessage = ref<string | undefined>(undefined);
const tournaments = ref<TournamentCard[]>([]);
const gameName = ref<Map<string, string>>(new Map());

onMounted(async () => {
  try {
    const [list, games] = await Promise.all([
      listTournaments({ locale: activeLocale() }),
      apiFetch<{ items: GameCard[] }>(`/games?locale=${activeLocale()}&limit=100`)
    ]);
    tournaments.value = list.items;
    gameName.value = new Map(games.items.map((g) => [g.id, g.name]));
  } catch (error) {
    errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section>
    <h1>{{ t('tournaments.hub.heading') }}</h1>
    <p>{{ t('tournaments.hub.intro') }}</p>
    <p>
      <RouterLink :to="`${prefix}/tournaments-calendar`">
        {{ t('tournaments.hub.calendarLink') }}
      </RouterLink>
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
      v-else-if="tournaments.length === 0"
      variant="empty"
      :message="t('tournaments.hub.empty')"
    />

    <ul
      v-else
      class="cards"
    >
      <li
        v-for="tour in tournaments"
        :key="tour.id"
        :data-testid="`tournament-card-${tour.id}`"
      >
        <RouterLink :to="`${prefix}/tournaments/${tour.slug}`">
          <h2>{{ tour.name }}</h2>
        </RouterLink>
        <p class="summary">
          {{ tour.summary }}
        </p>
        <dl class="meta">
          <div>
            <dt>{{ t('tournaments.field.game') }}</dt>
            <dd>{{ gameName.get(tour.gameId) ?? '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('tournaments.field.participantType') }}</dt>
            <dd>{{ t(`tournaments.participant.${tour.participantType}`) }}</dd>
          </div>
          <div v-if="tour.startAt">
            <dt>{{ t('tournaments.field.startAt') }}</dt>
            <dd>{{ formatDateTime(tour.startAt, activeLocale(), viewerTimeZone()) }}</dd>
          </div>
          <div>
            <dt>{{ t('tournaments.field.fee') }}</dt>
            <dd>{{ t(`tournaments.feeKind.${tour.feeKind}`) }}</dd>
          </div>
        </dl>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-4);
}

.cards li {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.cards h2 {
  margin: 0 0 var(--space-2);
}

.summary {
  color: var(--color-text-muted);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: var(--space-3) 0 0;
}

.meta dt {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.meta dd {
  margin: 0;
  font-weight: 600;
}
</style>
