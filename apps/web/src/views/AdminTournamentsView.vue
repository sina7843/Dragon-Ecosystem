<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppField from '../components/AppField.vue';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { isLocale, type Locale } from '../i18n/locale.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';

/**
 * Tournament administration (TOURN-001..002). Gated on tournament.manage; the
 * server enforces it and re-runs every validation. No payment is executed here.
 */

interface GameCard { id: string; name: string }
interface Money { assetCode: 'IRR' | 'DRC'; amountInteger: number }
interface Tournament {
  id: string;
  slug: string;
  state: string;
  version: number;
  gameId: string;
  participantType: 'individual' | 'team';
  format: string;
  capacity: number;
  approvalMode: 'automatic' | 'manual';
  waitlistMode: 'enabled' | 'disabled';
  translations: Record<Locale, { name: string; summary: string; description: string }>;
  ruleProfile: { text: Record<Locale, string> };
  registration: { opensAt: string | null; closesAt: string | null };
  schedule: { startAt: string | null; endAt: string | null };
  fee: { kind: 'free' | 'toman' | 'dragon_coin' | 'mixed'; components: Money[] };
  prizes: { version: number; placements: Array<{ rank: number; rewards: Money[] }> };
}

const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor, fieldMessage } = useApiErrors();
const { push } = useToasts();

const prefix = computed(() => `/${isLocale(locale.value) ? locale.value : 'fa'}`);

const loading = ref(true);
const listError = ref<string | undefined>(undefined);
const list = ref<Tournament[]>([]);
const games = ref<GameCard[]>([]);
const editing = ref<Tournament | null>(null);
const saving = ref(false);
const formError = ref<string | undefined>(undefined);
const fieldErrors = ref<Record<string, string | undefined>>({});

function emptyForm() {
  return {
    gameId: '',
    participantType: 'individual' as 'individual' | 'team',
    format: 'single_elimination',
    capacity: '16',
    approvalMode: 'manual' as 'automatic' | 'manual',
    waitlistMode: 'disabled' as 'enabled' | 'disabled',
    fa: { name: '', summary: '', rules: '' },
    en: { name: '', summary: '', rules: '' },
    opensAt: '',
    closesAt: '',
    startAt: '',
    endAt: '',
    feeKind: 'free' as 'free' | 'toman' | 'dragon_coin' | 'mixed',
    tomanAmount: '',
    dragonCoinAmount: '',
    prizeToman: '',
    prizeCoin: ''
  };
}
const form = reactive(emptyForm());

async function loadList(): Promise<void> {
  loading.value = true;
  try {
    const [tours, gameList] = await Promise.all([
      apiFetch<{ items: Tournament[] }>('/admin/tournaments'),
      apiFetch<{ items: GameCard[] }>(`/games?locale=${isLocale(locale.value) ? locale.value : 'fa'}&limit=100`)
    ]);
    list.value = tours.items;
    games.value = gameList.items;
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

const dt = (iso: string | null): string => (iso === null ? '' : iso.slice(0, 16));

function resetForm(): void {
  editing.value = null;
  Object.assign(form, emptyForm());
  formError.value = undefined;
  fieldErrors.value = {};
}

function edit(tour: Tournament): void {
  editing.value = tour;
  const toman = tour.fee.components.find((c) => c.assetCode === 'IRR');
  const coin = tour.fee.components.find((c) => c.assetCode === 'DRC');
  const prize = tour.prizes.placements[0];
  Object.assign(form, {
    gameId: tour.gameId,
    participantType: tour.participantType,
    format: tour.format,
    capacity: String(tour.capacity),
    approvalMode: tour.approvalMode,
    waitlistMode: tour.waitlistMode,
    fa: { name: tour.translations.fa.name, summary: tour.translations.fa.summary, rules: tour.ruleProfile.text.fa },
    en: { name: tour.translations.en.name, summary: tour.translations.en.summary, rules: tour.ruleProfile.text.en },
    opensAt: dt(tour.registration.opensAt),
    closesAt: dt(tour.registration.closesAt),
    startAt: dt(tour.schedule.startAt),
    endAt: dt(tour.schedule.endAt),
    feeKind: tour.fee.kind,
    tomanAmount: toman ? String(toman.amountInteger / 10) : '',
    dragonCoinAmount: coin ? String(coin.amountInteger) : '',
    prizeToman: prize?.rewards.find((r) => r.assetCode === 'IRR') ? String((prize.rewards.find((r) => r.assetCode === 'IRR') as Money).amountInteger / 10) : '',
    prizeCoin: prize?.rewards.find((r) => r.assetCode === 'DRC') ? String((prize.rewards.find((r) => r.assetCode === 'DRC') as Money).amountInteger) : ''
  });
  formError.value = undefined;
  fieldErrors.value = {};
}

function buildPayload(): Record<string, unknown> {
  const fee: Record<string, unknown> = { kind: form.feeKind };
  if (form.feeKind === 'toman' || form.feeKind === 'mixed') fee['tomanAmount'] = Number(form.tomanAmount);
  if (form.feeKind === 'dragon_coin' || form.feeKind === 'mixed') fee['dragonCoinAmount'] = Number(form.dragonCoinAmount);

  const payload: Record<string, unknown> = {
    gameId: form.gameId,
    participantType: form.participantType,
    format: form.format,
    capacity: Number(form.capacity),
    approvalMode: form.approvalMode,
    waitlistMode: form.waitlistMode,
    translations: {
      fa: { name: form.fa.name, summary: form.fa.summary },
      en: { name: form.en.name, summary: form.en.summary }
    },
    ruleProfile: { text: { fa: form.fa.rules, en: form.en.rules } },
    registration: { opensAt: form.opensAt || null, closesAt: form.closesAt || null },
    schedule: { startAt: form.startAt || null, endAt: form.endAt || null },
    fee
  };

  if (form.prizeToman !== '' || form.prizeCoin !== '') {
    const placement: Record<string, unknown> = { rank: 1 };
    if (form.prizeToman !== '') placement['tomanAmount'] = Number(form.prizeToman);
    if (form.prizeCoin !== '') placement['dragonCoinAmount'] = Number(form.prizeCoin);
    payload['prizes'] = { placements: [placement] };
  }
  return payload;
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  formError.value = undefined;
  fieldErrors.value = {};
  try {
    const payload = buildPayload();
    if (editing.value === null) {
      editing.value = await apiFetch<Tournament>('/admin/tournaments', { method: 'POST', body: JSON.stringify(payload) });
      push('success', t('adminTournaments.created'));
    } else {
      editing.value = await apiFetch<Tournament>(`/admin/tournaments/${editing.value.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...payload, expectedVersion: editing.value.version })
      });
      push('success', t('adminTournaments.saved'));
    }
    await loadList();
    if (editing.value !== null) edit(editing.value);
  } catch (caught) {
    for (const field of ['gameId', 'capacity', 'slug', 'fee.tomanAmount', 'schedule.startAt', 'schedule.endAt', 'registration.closesAt']) {
      fieldErrors.value[field] = fieldMessage(caught, field);
    }
    if (Object.values(fieldErrors.value).every((v) => v === undefined)) formError.value = messageFor(caught);
  } finally {
    saving.value = false;
  }
}

async function transition(to: string): Promise<void> {
  if (editing.value === null) return;
  const reason = globalThis.prompt(t('adminTournaments.reasonPrompt')) ?? '';
  if (reason.trim() === '') return;
  try {
    editing.value = await apiFetch<Tournament>(`/admin/tournaments/${editing.value.id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ to, reason })
    });
    push('success', t('adminTournaments.transitioned'));
    await loadList();
  } catch (caught) {
    push('danger', messageFor(caught));
  }
}

async function clone(): Promise<void> {
  if (editing.value === null) return;
  try {
    const created = await apiFetch<Tournament>(`/admin/tournaments/${editing.value.id}/clone`, { method: 'POST' });
    push('success', t('adminTournaments.cloned'));
    await loadList();
    edit(created);
  } catch (caught) {
    push('danger', messageFor(caught));
  }
}
</script>

<template>
  <section>
    <h1>{{ t('adminTournaments.heading') }}</h1>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="tournaments-forbidden"
    />

    <template v-else>
      <div class="layout">
        <div>
          <button
            type="button"
            class="new"
            data-testid="new-tournament"
            @click="resetForm"
          >
            {{ t('adminTournaments.new') }}
          </button>
          <StateBlock
            v-if="loading"
            variant="loading"
          />
          <StateBlock
            v-else-if="listError"
            variant="error"
            :message="listError"
          />
          <ul
            v-else
            class="items"
          >
            <li
              v-for="tour in list"
              :key="tour.id"
            >
              <button
                type="button"
                :data-testid="`edit-${tour.id}`"
                @click="edit(tour)"
              >
                <span>{{ tour.translations.en.name || tour.translations.fa.name || '—' }}</span>
                <span class="state">{{ t(`tournaments.state.${tour.state}`) }}</span>
              </button>
            </li>
            <li
              v-if="list.length === 0"
              class="empty"
            >
              {{ t('adminTournaments.empty') }}
            </li>
          </ul>
        </div>

        <form
          class="editor"
          novalidate
          data-testid="tournament-form"
          @submit.prevent="save"
        >
          <h2>{{ editing ? t('adminTournaments.editing') : t('adminTournaments.creating') }}</h2>
          <p
            v-if="editing"
            class="state-line"
            data-testid="tournament-state"
          >
            {{ t(`tournaments.state.${editing.state}`) }}
          </p>
          <p
            v-if="formError"
            class="summary"
            role="alert"
            data-testid="tournament-error"
          >
            {{ formError }}
          </p>

          <div class="field">
            <label for="tour-game">{{ t('tournaments.field.game') }}</label>
            <select
              id="tour-game"
              v-model="form.gameId"
              :disabled="editing !== null && editing.state !== 'draft'"
            >
              <option
                value=""
                disabled
              >
                {{ t('tournaments.field.gamePlaceholder') }}
              </option>
              <option
                v-for="game in games"
                :key="game.id"
                :value="game.id"
              >
                {{ game.name }}
              </option>
            </select>
            <p
              v-if="fieldErrors['gameId']"
              class="field-error"
            >
              {{ fieldErrors['gameId'] }}
            </p>
          </div>

          <fieldset
            v-for="loc in (['fa', 'en'] as const)"
            :key="loc"
            class="locale"
          >
            <legend>{{ t(`locale.name.${loc}`) }}</legend>
            <AppField
              :id="`name-${loc}`"
              v-model="form[loc].name"
              :label="t('tournaments.field.name')"
            />
            <AppField
              :id="`summary-${loc}`"
              v-model="form[loc].summary"
              :label="t('tournaments.field.summary')"
            />
            <AppField
              :id="`rules-${loc}`"
              v-model="form[loc].rules"
              :label="t('tournaments.field.rules')"
            />
          </fieldset>

          <div class="grid">
            <div class="field">
              <label for="tour-type">{{ t('tournaments.field.participantType') }}</label>
              <select
                id="tour-type"
                v-model="form.participantType"
              >
                <option value="individual">
                  {{ t('tournaments.participant.individual') }}
                </option>
                <option value="team">
                  {{ t('tournaments.participant.team') }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="tour-format">{{ t('tournaments.field.format') }}</label>
              <select
                id="tour-format"
                v-model="form.format"
              >
                <option
                  v-for="f in ['single_elimination', 'double_elimination', 'round_robin', 'swiss', 'custom']"
                  :key="f"
                  :value="f"
                >
                  {{ t(`tournaments.format.${f}`) }}
                </option>
              </select>
            </div>
            <AppField
              id="tour-capacity"
              v-model="form.capacity"
              type="number"
              :label="t('tournaments.field.capacity')"
              :error="fieldErrors['capacity']"
              latin
            />
          </div>

          <div class="grid">
            <AppField
              id="tour-opens"
              v-model="form.opensAt"
              type="datetime-local"
              :label="t('tournaments.field.registrationOpens')"
              latin
            />
            <AppField
              id="tour-closes"
              v-model="form.closesAt"
              type="datetime-local"
              :label="t('tournaments.field.registrationCloses')"
              :error="fieldErrors['registration.closesAt']"
              latin
            />
            <AppField
              id="tour-start"
              v-model="form.startAt"
              type="datetime-local"
              :label="t('tournaments.field.startAt')"
              :error="fieldErrors['schedule.startAt']"
              latin
            />
            <AppField
              id="tour-end"
              v-model="form.endAt"
              type="datetime-local"
              :label="t('tournaments.field.endAt')"
              :error="fieldErrors['schedule.endAt']"
              latin
            />
          </div>

          <fieldset class="locale">
            <legend>{{ t('tournaments.field.fee') }}</legend>
            <div class="field">
              <label for="tour-fee-kind">{{ t('tournaments.field.feeKind') }}</label>
              <select
                id="tour-fee-kind"
                v-model="form.feeKind"
              >
                <option
                  v-for="k in ['free', 'toman', 'dragon_coin', 'mixed']"
                  :key="k"
                  :value="k"
                >
                  {{ t(`tournaments.feeKind.${k}`) }}
                </option>
              </select>
            </div>
            <AppField
              v-if="form.feeKind === 'toman' || form.feeKind === 'mixed'"
              id="tour-fee-toman"
              v-model="form.tomanAmount"
              type="number"
              :label="t('tournaments.field.feeToman')"
              :error="fieldErrors['fee.tomanAmount']"
              latin
            />
            <AppField
              v-if="form.feeKind === 'dragon_coin' || form.feeKind === 'mixed'"
              id="tour-fee-coin"
              v-model="form.dragonCoinAmount"
              type="number"
              :label="t('tournaments.field.feeCoin')"
              latin
            />
          </fieldset>

          <fieldset class="locale">
            <legend>{{ t('tournaments.field.prizes') }} ({{ t('tournaments.detail.rank', { rank: 1 }) }})</legend>
            <AppField
              id="tour-prize-toman"
              v-model="form.prizeToman"
              type="number"
              :label="t('tournaments.field.feeToman')"
              latin
            />
            <AppField
              id="tour-prize-coin"
              v-model="form.prizeCoin"
              type="number"
              :label="t('tournaments.field.feeCoin')"
              latin
            />
          </fieldset>

          <div class="actions">
            <button
              type="submit"
              class="primary"
              data-testid="save-tournament"
              :disabled="saving || (editing !== null && editing.state !== 'draft')"
            >
              {{ saving ? t('adminTournaments.saving') : t('adminTournaments.save') }}
            </button>
            <template v-if="editing">
              <RouterLink
                :to="`${prefix}/tournaments/${editing.slug}`"
                target="_blank"
                data-testid="preview-tournament"
              >
                {{ t('adminTournaments.preview') }}
              </RouterLink>
              <RouterLink
                :to="`${prefix}/admin/tournaments/${editing.id}/registrations`"
                data-testid="manage-registrations"
              >
                {{ t('adminTournaments.registrations') }}
              </RouterLink>
              <RouterLink
                :to="`${prefix}/admin/tournaments/${editing.id}/competition`"
                data-testid="manage-competition"
              >
                {{ t('adminTournaments.competition') }}
              </RouterLink>
              <button
                v-if="editing.state === 'draft'"
                type="button"
                data-testid="publish-tournament"
                @click="transition('published')"
              >
                {{ t('adminTournaments.publish') }}
              </button>
              <button
                v-if="editing.state === 'published'"
                type="button"
                data-testid="cancel-tournament"
                @click="transition('cancelled')"
              >
                {{ t('adminTournaments.cancel') }}
              </button>
              <button
                v-if="editing.state === 'cancelled' || editing.state === 'draft'"
                type="button"
                data-testid="archive-tournament"
                @click="transition('archived')"
              >
                {{ t('adminTournaments.archive') }}
              </button>
              <button
                type="button"
                data-testid="clone-tournament"
                @click="clone"
              >
                {{ t('adminTournaments.clone') }}
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
  gap: var(--space-5);
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 60rem) {
  .layout {
    grid-template-columns: 18rem minmax(0, 1fr);
  }
}

.new {
  inline-size: 100%;
  margin-block-end: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
  cursor: pointer;
}

.items {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.items button {
  inline-size: 100%;
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
  text-align: start;
}

.state {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.state-line {
  color: var(--color-text-muted);
}

.locale {
  display: block;
  margin-block-end: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.grid {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  margin-block-end: var(--space-3);
}

.field label {
  display: block;
  margin-block-end: var(--space-1);
  font-weight: 600;
}

.field select {
  inline-size: 100%;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.field-error {
  margin-block: var(--space-1) 0;
  color: var(--color-danger-text);
  font-size: var(--text-sm);
}

.summary {
  padding: var(--space-3);
  border: 1px solid var(--color-danger-text);
  border-radius: var(--radius-md);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.actions button,
.actions a {
  padding-inline: var(--space-4);
  padding-block: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
  text-decoration: none;
}

.actions .primary {
  border-color: var(--color-accent);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
}
</style>
