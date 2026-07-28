<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError, apiFetch } from '../api.ts';
import { isLocale } from '../i18n/locale.ts';
import { useAdmin } from '../composables/useAdmin.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useToasts } from '../composables/useToasts.ts';
import {
  correctMatchResult,
  generateCompetition,
  generateSwissRound,
  getAdminCompetition,
  listBracketVersions,
  newCorrectionKey,
  previewRegenerate,
  recordMatchResult,
  regenerateBracket,
  rollbackBracket,
  setCompetitionLock,
  type AdminCompetition,
  type AdminMatch,
  type BracketVersion,
  type RegeneratePreview
} from '../composables/useCompetitionsApi.ts';

/**
 * Operator console (DRAGON-10). Runs one tournament's competition through its whole
 * lifecycle — result entry/correction, Swiss progression, lock/finalize, and
 * bracket regeneration/rollback with immutable version history — for every format.
 * Every destructive or result-changing action is confirmed, reasoned, and
 * optimistically guarded server-side; this view only shapes requests.
 */

const { t, locale } = useI18n();
const { forbidden, refresh: refreshCaps } = useAdmin();
const { messageFor } = useApiErrors();
const { push } = useToasts();
const route = useRoute();

const prefix = computed(() => `/${isLocale(locale.value) ? locale.value : 'fa'}`);
const tournamentId = computed(() => String(route.params['id']));

const loading = ref(true);
const loadError = ref<string | undefined>(undefined);
const notGenerated = ref(false);
const competition = ref<AdminCompetition | null>(null);
const matches = ref<AdminMatch[]>([]);
const versions = ref<BracketVersion[]>([]);

// Seed number is a participant's public identity (index in seed order + 1).
const seedByRegistration = computed(() => {
  const map = new Map<string, number>();
  competition.value?.participants.forEach((p, i) => map.set(p.registrationId, i + 1));
  return map;
});
function seedOf(ref: { registrationId: string } | null): string {
  if (ref === null) return '—';
  return String(seedByRegistration.value.get(ref.registrationId) ?? '—');
}

// The operator queue: playable matches first, then the rest in (round, index) order.
const orderedMatches = computed(() =>
  [...matches.value].sort((a, b) => {
    const rank = (m: AdminMatch): number => (m.state === 'ready' ? 0 : m.state === 'pending' ? 1 : 2);
    return rank(a) - rank(b) || a.round - b.round || a.index - b.index;
  })
);
const readyCount = computed(() => matches.value.filter((m) => m.state === 'ready').length);
const swissCanAdvance = computed(() => {
  const c = competition.value;
  if (c === null || c.swiss === null) return false;
  if (c.swiss.currentRound >= c.swiss.targetRounds) return false;
  return matches.value.filter((m) => m.round === c.swiss?.currentRound).every((m) => m.state === 'completed' || m.state === 'bye');
});

/**
 * The tournament this console is operating on.
 *
 * A competition can only be generated for a *published* tournament, and the server
 * answers a draft with a plain 404. Without knowing the state, this screen showed
 * "no competition generated yet" plus a Generate button that could only ever fail with
 * "That item could not be found" — which reads as a broken button rather than as
 * "publish the tournament first".
 */
const tournamentState = ref<string | null>(null);
const canGenerate = computed(() => tournamentState.value === 'published');

async function loadTournament(): Promise<void> {
  try {
    const record = await apiFetch<{ state: string }>(`/admin/tournaments/${tournamentId.value}`);
    tournamentState.value = record.state;
  } catch {
    tournamentState.value = null; // Unknown: the generate control stays hidden.
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    await loadTournament();
    const view = await getAdminCompetition(tournamentId.value);
    competition.value = view.competition;
    matches.value = view.matches;
    notGenerated.value = false;
    versions.value = (await listBracketVersions(tournamentId.value)).versions;
    loadError.value = undefined;
  } catch (caught) {
    if (caught instanceof ApiRequestError && caught.status === 404) {
      notGenerated.value = true;
      competition.value = null;
    } else {
      loadError.value = messageFor(caught);
    }
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await refreshCaps();
  if (!forbidden.value) await load();
  else loading.value = false;
});

async function run(action: () => Promise<unknown>, successKey: string): Promise<void> {
  try {
    await action();
    push('success', t(successKey));
    await load();
  } catch (caught) {
    push('danger', messageFor(caught));
  }
}

// --- Result entry / correction ---
const scoreDraft = ref<Record<string, { a: string; b: string }>>({});
function draft(id: string): { a: string; b: string } {
  return (scoreDraft.value[id] ??= { a: '', b: '' });
}
function scores(id: string): { scoreA?: number; scoreB?: number } {
  const d = draft(id);
  const out: { scoreA?: number; scoreB?: number } = {};
  if (d.a.trim() !== '') out.scoreA = Number(d.a);
  if (d.b.trim() !== '') out.scoreB = Number(d.b);
  return out;
}
function record(match: AdminMatch, winnerSlot: 'a' | 'b'): void {
  void run(() => recordMatchResult(tournamentId.value, match.id, { winnerSlot, ...scores(match.id) }), 'competitionOps.resultRecorded');
}

const correcting = ref<string | null>(null);
const correctReason = ref('');
function openCorrect(match: AdminMatch): void {
  correcting.value = match.id;
  correctReason.value = '';
}
function submitCorrect(match: AdminMatch, winnerSlot: 'a' | 'b'): void {
  if (correctReason.value.trim() === '') {
    push('danger', t('competitionOps.reasonRequired'));
    return;
  }
  void run(
    () => correctMatchResult(tournamentId.value, match.id, { expectedVersion: match.version, winnerSlot, reason: correctReason.value.trim(), idempotencyKey: newCorrectionKey(), ...scores(match.id) }),
    'competitionOps.resultCorrected'
  ).then(() => (correcting.value = null));
}

// --- Lifecycle: generate, swiss round, lock ---
function generate(): void {
  void run(() => generateCompetition(tournamentId.value), 'competitionOps.generated');
}
function nextSwissRound(): void {
  void run(() => generateSwissRound(tournamentId.value), 'competitionOps.swissRoundGenerated');
}
const lockChoice = ref<'open' | 'correction_limited' | 'locked'>('locked');
function applyLock(): void {
  const c = competition.value;
  if (c === null) return;
  void run(() => setCompetitionLock(tournamentId.value, lockChoice.value, c.lockVersion), 'competitionOps.lockChanged');
}

// --- Regeneration (destructive, previewed + confirmed + reasoned) ---
const regenPreview = ref<RegeneratePreview | null>(null);
const regenReason = ref('');
const regenConfirm = ref(false);
async function openRegenerate(): Promise<void> {
  regenReason.value = '';
  regenConfirm.value = false;
  try {
    regenPreview.value = await previewRegenerate(tournamentId.value);
  } catch (caught) {
    push('danger', messageFor(caught));
  }
}
function confirmRegenerate(): void {
  const c = competition.value;
  if (c === null) return;
  if (regenReason.value.trim() === '' || !regenConfirm.value) {
    push('danger', t('competitionOps.confirmRequired'));
    return;
  }
  void run(() => regenerateBracket(tournamentId.value, { expectedVersion: c.version, reason: regenReason.value.trim(), confirm: true }), 'competitionOps.regenerated').then(() => (regenPreview.value = null));
}

// --- Rollback (destructive, confirmed + reasoned) ---
const rollbackTarget = ref<number | null>(null);
const rollbackReason = ref('');
function openRollback(version: BracketVersion): void {
  rollbackTarget.value = version.versionNumber;
  rollbackReason.value = '';
}
function confirmRollback(): void {
  const c = competition.value;
  if (c === null || rollbackTarget.value === null) return;
  if (rollbackReason.value.trim() === '') {
    push('danger', t('competitionOps.reasonRequired'));
    return;
  }
  void run(() => rollbackBracket(tournamentId.value, { expectedVersion: c.version, targetVersion: rollbackTarget.value as number, reason: rollbackReason.value.trim(), confirm: true }), 'competitionOps.rolledBack').then(
    () => (rollbackTarget.value = null)
  );
}
</script>

<template>
  <section>
    <p>
      <RouterLink :to="`${prefix}/admin/tournaments`">
        {{ t('competitionOps.back') }}
      </RouterLink>
    </p>
    <h1>{{ t('competitionOps.heading') }}</h1>

    <StateBlock
      v-if="forbidden"
      variant="forbidden"
      data-testid="competition-forbidden"
    />
    <StateBlock
      v-else-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="loadError"
      variant="error"
      :message="loadError"
    />

    <template v-else-if="notGenerated">
      <StateBlock
        variant="empty"
        :message="canGenerate ? t('competitionOps.notGenerated') : t('competitionOps.publishFirst')"
        data-testid="competition-empty"
      />
      <!-- Offered only when it can actually succeed: generating for an unpublished
           tournament is refused by the server. -->
      <button
        v-if="canGenerate"
        type="button"
        class="primary"
        data-testid="generate"
        @click="generate"
      >
        {{ t('competitionOps.generate') }}
      </button>
      <RouterLink
        v-else
        class="btn btn-secondary"
        :to="`${prefix}/admin/tournaments`"
        data-testid="back-to-publish"
      >
        {{ t('competitionOps.goPublish') }}
      </RouterLink>
    </template>

    <template v-else-if="competition">
      <dl
        class="facts"
        data-testid="competition-summary"
      >
        <div>
          <dt>{{ t('competitionOps.format') }}</dt>
          <dd>{{ t(`tournaments.format.${competition.format}`) }}</dd>
        </div>
        <div>
          <dt>{{ t('competitionOps.state') }}</dt>
          <dd :data-state="competition.state">
            {{ t(`competitionOps.stateLabel.${competition.state}`) }}
          </dd>
        </div>
        <div>
          <dt>{{ t('competitionOps.activeVersion') }}</dt>
          <dd data-testid="active-version">
            {{ competition.activeVersion }}
          </dd>
        </div>
        <div>
          <dt>{{ t('competitionOps.lock') }}</dt>
          <dd
            :data-lock="competition.lockState"
            data-testid="lock-state"
          >
            {{ t(`competitionOps.lockLabel.${competition.lockState}`) }}
          </dd>
        </div>
      </dl>

      <!-- Swiss progression -->
      <button
        v-if="swissCanAdvance"
        type="button"
        class="secondary"
        data-testid="swiss-round"
        @click="nextSwissRound"
      >
        {{ t('competitionOps.generateSwissRound') }}
      </button>

      <!-- Operator match queue -->
      <h2>{{ t('competitionOps.queue') }} <span class="muted">({{ t('competitionOps.readyCount', { n: readyCount }) }})</span></h2>
      <div class="scroll">
        <table data-testid="match-queue">
          <caption class="sr-only">
            {{ t('competitionOps.queue') }}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                {{ t('competitionOps.matchRound') }}
              </th>
              <th scope="col">
                {{ t('competitionOps.matchup') }}
              </th>
              <th scope="col">
                {{ t('competitionOps.matchState') }}
              </th>
              <th scope="col">
                {{ t('competitionOps.actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in orderedMatches"
              :key="m.id"
              :data-testid="`match-${m.key}`"
              :data-state="m.state"
            >
              <td>{{ m.round }}</td>
              <td>{{ t('competitionOps.seedVs', { a: seedOf(m.slotA), b: seedOf(m.slotB) }) }}</td>
              <td>
                {{ t(`standings.matchState.${m.state}`) }}
                <span v-if="m.winner !== null">· {{ t('competitionOps.wonBy', { n: seedOf(m.winner) }) }}</span>
              </td>
              <td class="actions">
                <template v-if="m.state === 'ready'">
                  <input
                    v-model="draft(m.id).a"
                    class="score"
                    inputmode="numeric"
                    :aria-label="t('competitionOps.scoreA')"
                    :placeholder="t('competitionOps.scoreA')"
                  >
                  <input
                    v-model="draft(m.id).b"
                    class="score"
                    inputmode="numeric"
                    :aria-label="t('competitionOps.scoreB')"
                    :placeholder="t('competitionOps.scoreB')"
                  >
                  <button
                    type="button"
                    data-testid="win-a"
                    @click="record(m, 'a')"
                  >
                    {{ t('competitionOps.winA', { n: seedOf(m.slotA) }) }}
                  </button>
                  <button
                    type="button"
                    data-testid="win-b"
                    @click="record(m, 'b')"
                  >
                    {{ t('competitionOps.winB', { n: seedOf(m.slotB) }) }}
                  </button>
                </template>
                <template v-else-if="m.state === 'completed' && competition.lockState !== 'locked'">
                  <button
                    v-if="correcting !== m.id"
                    type="button"
                    data-testid="open-correct"
                    @click="openCorrect(m)"
                  >
                    {{ t('competitionOps.correct') }}
                  </button>
                  <template v-else>
                    <input
                      v-model="correctReason"
                      class="reason"
                      data-testid="correct-reason"
                      :placeholder="t('competitionOps.reason')"
                    >
                    <button
                      type="button"
                      data-testid="correct-a"
                      @click="submitCorrect(m, 'a')"
                    >
                      {{ t('competitionOps.winA', { n: seedOf(m.slotA) }) }}
                    </button>
                    <button
                      type="button"
                      data-testid="correct-b"
                      @click="submitCorrect(m, 'b')"
                    >
                      {{ t('competitionOps.winB', { n: seedOf(m.slotB) }) }}
                    </button>
                  </template>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Lock / finalize -->
      <section class="block">
        <h2>{{ t('competitionOps.lockHeading') }}</h2>
        <div class="row">
          <label>
            {{ t('competitionOps.lock') }}
            <select
              v-model="lockChoice"
              data-testid="lock-choice"
            >
              <option value="open">
                {{ t('competitionOps.lockLabel.open') }}
              </option>
              <option value="correction_limited">
                {{ t('competitionOps.lockLabel.correction_limited') }}
              </option>
              <option value="locked">
                {{ t('competitionOps.lockLabel.locked') }}
              </option>
            </select>
          </label>
          <button
            type="button"
            class="secondary"
            data-testid="apply-lock"
            @click="applyLock"
          >
            {{ t('competitionOps.applyLock') }}
          </button>
        </div>
      </section>

      <!-- Regeneration -->
      <section class="block">
        <h2>{{ t('competitionOps.regenerateHeading') }}</h2>
        <button
          v-if="regenPreview === null"
          type="button"
          class="danger"
          data-testid="open-regenerate"
          :disabled="competition.lockState === 'locked'"
          @click="openRegenerate"
        >
          {{ t('competitionOps.regenerate') }}
        </button>
        <div
          v-else
          class="confirm"
          data-testid="regenerate-panel"
        >
          <p
            class="warn"
            data-testid="regenerate-impact"
          >
            {{ t('competitionOps.regenerateImpact', { n: regenPreview.currentCompletedResults, v: regenPreview.nextVersion }) }}
          </p>
          <input
            v-model="regenReason"
            class="reason"
            data-testid="regenerate-reason"
            :placeholder="t('competitionOps.reason')"
          >
          <label class="check">
            <input
              v-model="regenConfirm"
              type="checkbox"
              data-testid="regenerate-confirm"
            >
            {{ t('competitionOps.confirmDestructive') }}
          </label>
          <div class="row">
            <button
              type="button"
              class="danger"
              data-testid="confirm-regenerate"
              @click="confirmRegenerate"
            >
              {{ t('competitionOps.regenerate') }}
            </button>
            <button
              type="button"
              class="secondary"
              @click="regenPreview = null"
            >
              {{ t('competitionOps.cancel') }}
            </button>
          </div>
        </div>
      </section>

      <!-- Immutable version history + rollback -->
      <section class="block">
        <h2>{{ t('competitionOps.versionsHeading') }}</h2>
        <div class="scroll">
          <table data-testid="version-history">
            <caption class="sr-only">
              {{ t('competitionOps.versionsHeading') }}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  {{ t('competitionOps.version') }}
                </th>
                <th scope="col">
                  {{ t('competitionOps.origin') }}
                </th>
                <th scope="col">
                  {{ t('competitionOps.versionState') }}
                </th>
                <th scope="col">
                  {{ t('competitionOps.results') }}
                </th>
                <th scope="col">
                  {{ t('competitionOps.reason') }}
                </th>
                <th scope="col">
                  {{ t('competitionOps.actions') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="v in versions"
                :key="v.id"
                :data-testid="`version-${v.versionNumber}`"
                :data-state="v.state"
              >
                <td>{{ v.versionNumber }}</td>
                <td>{{ t(`competitionOps.originLabel.${v.origin}`) }}<span v-if="v.rolledBackFrom !== null"> (#{{ v.rolledBackFrom }})</span></td>
                <td>{{ t(`competitionOps.versionStateLabel.${v.state}`) }}</td>
                <td>{{ v.completedResultCount }}</td>
                <td>{{ v.reason ?? '—' }}</td>
                <td>
                  <button
                    v-if="v.state === 'superseded' && competition.lockState !== 'locked'"
                    type="button"
                    :data-testid="`rollback-${v.versionNumber}`"
                    @click="openRollback(v)"
                  >
                    {{ t('competitionOps.rollback') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="rollbackTarget !== null"
          class="confirm"
          data-testid="rollback-panel"
        >
          <p class="warn">
            {{ t('competitionOps.rollbackImpact', { v: rollbackTarget }) }}
          </p>
          <input
            v-model="rollbackReason"
            class="reason"
            data-testid="rollback-reason"
            :placeholder="t('competitionOps.reason')"
          >
          <div class="row">
            <button
              type="button"
              class="danger"
              data-testid="confirm-rollback"
              @click="confirmRollback"
            >
              {{ t('competitionOps.rollback') }}
            </button>
            <button
              type="button"
              class="secondary"
              @click="rollbackTarget = null"
            >
              {{ t('competitionOps.cancel') }}
            </button>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-block: var(--space-4);
}

.facts dt {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.facts dd {
  margin: 0;
  font-weight: 700;
}

.muted {
  color: var(--color-text-muted);
  font-weight: 400;
}

.scroll {
  overflow-x: auto;
}

table {
  inline-size: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: var(--space-2) var(--space-3);
  border-block-end: 1px solid var(--color-border);
  text-align: start;
  vertical-align: top;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.actions button,
.row button {
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}

.score {
  inline-size: 3rem;
}

.reason {
  min-inline-size: 12rem;
}

.score,
.reason,
select {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
}

.block {
  margin-block: var(--space-5);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
}

.confirm {
  padding: var(--space-4);
  border: 1px solid var(--color-danger-text);
  border-radius: var(--radius-md);
  background-color: var(--color-danger-surface);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-inline-size: 32rem;
}

.warn {
  color: var(--color-danger-text);
  font-weight: 700;
  margin: 0;
}

.check {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.primary,
.danger {
  padding-inline: var(--space-4);
  padding-block: var(--space-2);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.primary {
  border: 1px solid var(--color-accent);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
}

.danger {
  border: 1px solid var(--color-danger-text);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-weight: 700;
}

.danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary {
  padding-inline: var(--space-4);
  padding-block: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
