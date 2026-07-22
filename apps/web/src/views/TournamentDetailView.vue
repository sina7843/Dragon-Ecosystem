<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { formatDateTime, formatNumber, formatTomanValue, viewerTimeZone } from '../i18n/format.ts';
import { getTournament, type MoneyView, type TournamentDetail } from '../composables/useTournamentsApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';

/** Public tournament detail. A draft, cancelled, or archived tournament is a real 404. */

const { t, locale } = useI18n();
const { messageFor } = useApiErrors();
const route = useRoute();

const activeLocale = (): Locale => (isLocale(locale.value) ? locale.value : 'fa');

const loading = ref(true);
const notFound = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const tour = ref<TournamentDetail | null>(null);

function moneyLabel(m: MoneyView): string {
  return m.assetCode === 'IRR'
    ? `${formatTomanValue(m.amountInteger, activeLocale())} ${t('money.tomanUnit')}`
    : `${formatNumber(m.amountInteger, activeLocale())} ${t('money.dragonCoinUnit')}`;
}

onMounted(async () => {
  try {
    tour.value = await getTournament(String(route.params['slug']), activeLocale());
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound.value = true;
    else errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section>
    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="notFound"
      variant="notFound"
      data-testid="tournament-not-found"
      :message="t('tournaments.detail.notFound')"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />

    <template v-else-if="tour">
      <h1 data-testid="tournament-title">
        {{ tour.name }}
      </h1>
      <p class="summary">
        {{ tour.summary }}
      </p>
      <p
        v-if="tour.description"
        data-testid="tournament-description"
      >
        {{ tour.description }}
      </p>

      <dl class="facts">
        <div>
          <dt>{{ t('tournaments.field.participantType') }}</dt>
          <dd>{{ t(`tournaments.participant.${tour.participantType}`) }}</dd>
        </div>
        <div>
          <dt>{{ t('tournaments.field.format') }}</dt>
          <dd>{{ t(`tournaments.format.${tour.format}`) }}</dd>
        </div>
        <div>
          <dt>{{ t('tournaments.field.capacity') }}</dt>
          <dd>{{ formatNumber(tour.capacity, activeLocale()) }}</dd>
        </div>
        <div v-if="tour.registration.opensAt">
          <dt>{{ t('tournaments.field.registrationOpens') }}</dt>
          <dd>{{ formatDateTime(tour.registration.opensAt, activeLocale(), viewerTimeZone()) }}</dd>
        </div>
        <div v-if="tour.registration.closesAt">
          <dt>{{ t('tournaments.field.registrationCloses') }}</dt>
          <dd>{{ formatDateTime(tour.registration.closesAt, activeLocale(), viewerTimeZone()) }}</dd>
        </div>
        <div v-if="tour.startAt">
          <dt>{{ t('tournaments.field.startAt') }}</dt>
          <dd>{{ formatDateTime(tour.startAt, activeLocale(), viewerTimeZone()) }}</dd>
        </div>
        <div v-if="tour.endAt">
          <dt>{{ t('tournaments.field.endAt') }}</dt>
          <dd>{{ formatDateTime(tour.endAt, activeLocale(), viewerTimeZone()) }}</dd>
        </div>
      </dl>

      <section class="block">
        <h2>{{ t('tournaments.field.fee') }}</h2>
        <p
          v-if="tour.fee.kind === 'free'"
          data-testid="fee"
        >
          {{ t('tournaments.feeKind.free') }}
        </p>
        <ul
          v-else
          data-testid="fee"
        >
          <li
            v-for="(component, i) in tour.fee.components"
            :key="i"
          >
            {{ moneyLabel(component) }}
          </li>
        </ul>
      </section>

      <section
        v-if="tour.prizes.placements.length > 0"
        class="block"
      >
        <h2>{{ t('tournaments.field.prizes') }}</h2>
        <ul data-testid="prizes">
          <li
            v-for="placement in tour.prizes.placements"
            :key="placement.rank"
          >
            {{ t('tournaments.detail.rank', { rank: formatNumber(placement.rank, activeLocale()) }) }}:
            {{ placement.rewards.map(moneyLabel).join(' + ') }}
          </li>
        </ul>
      </section>

      <section
        v-if="tour.rules"
        class="block"
      >
        <h2>{{ t('tournaments.field.rules') }}</h2>
        <p class="rules">
          {{ tour.rules }}
        </p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.summary {
  color: var(--color-text-muted);
  font-size: var(--text-lg);
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: var(--space-4) 0;
}

.facts dt {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.facts dd {
  margin: 0;
  font-weight: 600;
}

.block {
  margin-block: var(--space-5);
}

.rules {
  white-space: pre-wrap;
}
</style>
