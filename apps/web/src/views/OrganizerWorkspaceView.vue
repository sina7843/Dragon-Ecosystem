<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSearch from '../components/AppSearch.vue';
import AppThumb from '../components/AppThumb.vue';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { formatDateTime, formatNumber, formatRelativeTime, viewerTimeZone } from '../i18n/format.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';

/**
 * Organizer workspace (FEATURE-013).
 *
 * Running an event meant moving between three screens — the tournament list, its
 * registration queue, and its competition controls — with no view of what actually needed
 * attention. This is the one place that answers "what is waiting on me": each of the
 * organizer's own events with its seat usage, the number of entries awaiting review, and
 * a direct route into whichever screen owns the next action.
 *
 * It is a lens, not a new capability: every link lands on an existing, permission-gated
 * screen, and the list is the admin list narrowed to the caller's own events by the server.
 */
interface OrganizerTournament {
  id: string;
  slug: string;
  state: string;
  format: string;
  capacity: number;
  coverImageUrl: string | null;
  registration: { opensAt: string | null; closesAt: string | null };
  schedule: { startAt: string | null; endAt: string | null };
  translations: Record<'fa' | 'en', { name: string }>;
  updatedAt: string;
}

const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();

const activeLocale = computed<Locale>(() => (isLocale(locale.value) ? locale.value : 'fa'));
const prefix = computed(() => `/${activeLocale.value}`);

const loading = ref(true);
const error = ref<string | undefined>(undefined);
const tournaments = ref<OrganizerTournament[]>([]);
const counts = ref<Record<string, Record<string, number>>>({});
const search = ref('');

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return tournaments.value;
  return tournaments.value.filter((tour) =>
    `${tour.translations.en.name} ${tour.translations.fa.name} ${tour.slug}`.toLowerCase().includes(q)
  );
});

function nameOf(tour: OrganizerTournament): string {
  return tour.translations[activeLocale.value].name || tour.slug;
}
function countFor(tour: OrganizerTournament, state: string): number {
  return counts.value[tour.id]?.[state] ?? 0;
}

/** Entries an organizer still has to decide on — the workspace's whole reason to exist. */
const pendingTotal = computed(() => tournaments.value.reduce((n, tour) => n + countFor(tour, 'pending'), 0));

/** Seats taken out of capacity, so a nearly-full event is obvious at a glance. */
function seatLabel(tour: OrganizerTournament): string {
  return `${formatNumber(countFor(tour, 'approved'), activeLocale.value)} / ${formatNumber(tour.capacity, activeLocale.value)}`;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const page = await apiFetch<{ items: OrganizerTournament[] }>('/admin/tournaments?mine=true&limit=50');
    tournaments.value = page.items;
    counts.value = page.items.length === 0
      ? {}
      : (await apiFetch<{ counts: Record<string, Record<string, number>> }>('/admin/registration-counts', {
          method: 'POST',
          body: JSON.stringify({ tournamentIds: page.items.map((tour) => tour.id) })
        })).counts;
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
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('admin.organizer.heading') }}</h1>
        <p class="page-lead">
          {{ t('admin.organizer.intro') }}
        </p>
      </div>
      <div class="page-header-actions">
        <RouterLink
          class="btn btn-secondary"
          :to="`${prefix}/admin/tournaments`"
        >
          {{ t('admin.organizer.allTournaments') }}
        </RouterLink>
      </div>
    </div>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="organizer-forbidden"
    />
    <template v-else>
      <StateBlock
        v-if="loading && tournaments.length === 0"
        variant="loading"
      />
      <StateBlock
        v-else-if="error"
        variant="error"
        :message="error"
      />
      <template v-else>
        <p
          v-if="pendingTotal > 0"
          class="pending-banner"
          role="status"
          data-testid="pending-banner"
        >
          {{ t('admin.organizer.pendingTotal', { count: formatNumber(pendingTotal, activeLocale) }) }}
        </p>

        <AppSearch
          v-model="search"
          input-id="organizer-search"
        />

        <StateBlock
          v-if="filtered.length === 0"
          variant="empty"
          :message="search.trim() === '' ? t('admin.organizer.empty') : t('search.noResults')"
        />
        <ul
          v-else
          class="events"
          data-testid="organizer-list"
        >
          <li
            v-for="tour in filtered"
            :key="tour.id"
            class="card event"
            :data-testid="`organizer-${tour.slug}`"
          >
            <!-- Same 21/9 as every other tournament cover. -->
            <AppThumb
              class="event-thumb"
              :src="tour.coverImageUrl"
              :label="nameOf(tour)"
              :ratio="21 / 9"
            />
            <div class="event-body">
              <div class="event-head">
                <strong class="event-name">{{ nameOf(tour) }}</strong>
                <span
                  class="status-pill"
                  :class="tour.state === 'published' ? 'status-pill-success' : tour.state === 'cancelled' ? 'status-pill-danger' : 'status-pill-neutral'"
                  :data-testid="`state-${tour.slug}`"
                >{{ t(`tournaments.state.${tour.state}`) }}</span>
                <span class="badge badge-neutral">{{ t(`tournaments.format.${tour.format}`, tour.format) }}</span>
              </div>

              <dl class="stats">
                <div>
                  <dt>{{ t('admin.organizer.seats') }}</dt>
                  <dd class="numeric">
                    {{ seatLabel(tour) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ t('admin.organizer.pending') }}</dt>
                  <dd
                    class="numeric"
                    :class="{ attention: countFor(tour, 'pending') > 0 }"
                    :data-testid="`pending-${tour.slug}`"
                  >
                    {{ formatNumber(countFor(tour, 'pending'), activeLocale) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ t('admin.organizer.waitlisted') }}</dt>
                  <dd class="numeric">
                    {{ formatNumber(countFor(tour, 'waitlisted'), activeLocale) }}
                  </dd>
                </div>
                <div v-if="tour.schedule.startAt">
                  <dt>{{ t('admin.organizer.starts') }}</dt>
                  <dd>
                    <time
                      :datetime="tour.schedule.startAt"
                      :title="formatDateTime(tour.schedule.startAt, activeLocale, viewerTimeZone())"
                    >{{ formatRelativeTime(tour.schedule.startAt, activeLocale) }}</time>
                  </dd>
                </div>
              </dl>

              <!-- Straight into the screen that owns the next action, rather than making
                   an organizer navigate the admin tree to find it. -->
              <div class="actions">
                <RouterLink
                  class="btn btn-primary"
                  :to="`${prefix}/admin/tournaments/${tour.id}/registrations`"
                  :data-testid="`registrations-${tour.slug}`"
                >
                  {{ t('admin.organizer.reviewEntries') }}
                </RouterLink>
                <RouterLink
                  class="btn btn-secondary"
                  :to="`${prefix}/admin/tournaments/${tour.id}/competition`"
                  :data-testid="`competition-${tour.slug}`"
                >
                  {{ t('admin.organizer.competition') }}
                </RouterLink>
                <RouterLink
                  v-if="tour.state !== 'draft'"
                  class="btn btn-ghost"
                  :to="`${prefix}/tournaments/${encodeURIComponent(tour.slug)}`"
                  :data-testid="`public-${tour.slug}`"
                >
                  {{ t('admin.organizer.viewPublic') }}
                </RouterLink>
              </div>
            </div>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>

<style scoped>
.pending-banner {
  margin-block-end: var(--space-4);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-warning-text);
  border-radius: var(--radius-md);
  background-color: var(--color-warning-surface);
  color: var(--color-warning-text);
  inline-size: fit-content;
  max-inline-size: 100%;
}

.events {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.event {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: flex-start;
}

.event-thumb {
  flex: none;
  inline-size: 10rem;
}

.event-body {
  flex: 1;
  min-inline-size: 14rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.event-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.event-name {
  font-size: var(--text-lg);
}

.stats {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  margin: 0;
}
.stats dt {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  color: var(--color-text-muted);
}
[lang='fa'] .stats dt {
  letter-spacing: normal;
  text-transform: none;
}
.stats dd {
  margin: 0;
  font-weight: var(--weight-semibold);
}

/* A non-zero queue is the one number an organizer must not miss. */
.attention {
  color: var(--color-accent);
  font-weight: var(--weight-black);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
