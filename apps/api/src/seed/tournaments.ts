/**
 * Tournaments and their registrations/waitlists, through the real tournaments and
 * registrations services. The status enum is only draft/published/cancelled/completed;
 * "registration open / upcoming / active" are derived from the registration and schedule
 * windows, so those are seeded with now-relative dates. Free tournaments only (the paid
 * gate stays off by default); a paid example is left to the gated economy step.
 */
import type { CatalogRegistry } from './catalog.ts';
import type { SeedSummary } from './harness.ts';
import { demoRef, newIdemKey } from './harness.ts';
import type { UserRegistry } from './users.ts';
import type { DemoRegistry } from './registry.ts';
import { accountContext, ensureDemo, type Services } from './wiring.ts';

export interface DemoTournament {
  readonly key: string;
  readonly id: string;
  readonly participantType: 'individual' | 'team';
  readonly capacity: number;
}

export type TournamentRegistry = Map<string, DemoTournament>;

type Phase = 'reg_open' | 'upcoming' | 'active' | 'completed' | 'cancelled' | 'draft';

interface TournamentSpec {
  readonly slug: string;
  readonly nameFa: string;
  readonly nameEn: string;
  readonly game: string;
  readonly organizerKey: string;
  readonly participantType: 'individual' | 'team';
  readonly format: 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss';
  readonly capacity: number;
  readonly phase: Phase;
  readonly approvalMode: 'automatic' | 'manual';
}

const DAY = 86_400_000;

const SPECS: readonly TournamentSpec[] = [
  { slug: 'nova-open-cup', nameFa: 'جام باز نوا', nameEn: 'Nova Open Cup', game: 'nova-strike', organizerKey: 'organizer-01', participantType: 'individual', format: 'single_elimination', capacity: 16, phase: 'reg_open', approvalMode: 'automatic' },
  { slug: 'dragon-team-clash', nameFa: 'نبرد تیمی اژدها', nameEn: 'Dragon Team Clash', game: 'dragon-arena', organizerKey: 'organizer-02', participantType: 'team', format: 'single_elimination', capacity: 8, phase: 'reg_open', approvalMode: 'manual' },
  { slug: 'astro-grand-prix', nameFa: 'گرندپری فضایی', nameEn: 'Astro Grand Prix', game: 'astro-racers', organizerKey: 'organizer-03', participantType: 'individual', format: 'round_robin', capacity: 6, phase: 'upcoming', approvalMode: 'automatic' },
  { slug: 'rune-masters', nameFa: 'اساتید رون', nameEn: 'Rune Masters', game: 'rune-tactics', organizerKey: 'organizer-01', participantType: 'individual', format: 'swiss', capacity: 16, phase: 'active', approvalMode: 'automatic' },
  { slug: 'pixel-championship', nameFa: 'قهرمانی پیکسل', nameEn: 'Pixel Championship', game: 'pixel-league', organizerKey: 'organizer-02', participantType: 'individual', format: 'single_elimination', capacity: 8, phase: 'completed', approvalMode: 'automatic' },
  { slug: 'shadow-invitational', nameFa: 'دعوتی سایه', nameEn: 'Shadow Invitational', game: 'shadow-duel', organizerKey: 'organizer-03', participantType: 'individual', format: 'double_elimination', capacity: 8, phase: 'cancelled', approvalMode: 'automatic' },
  { slug: 'orbit-qualifier', nameFa: 'مقدماتی مداری', nameEn: 'Orbit Qualifier', game: 'orbit-blitz', organizerKey: 'organizer-01', participantType: 'individual', format: 'single_elimination', capacity: 4, phase: 'reg_open', approvalMode: 'manual' },
  { slug: 'nova-draft-cup', nameFa: 'جام پیش‌نویس نوا', nameEn: 'Nova Draft Cup', game: 'nova-strike', organizerKey: 'organizer-02', participantType: 'individual', format: 'single_elimination', capacity: 16, phase: 'draft', approvalMode: 'automatic' }
];

/** Registration + schedule windows (ISO) that render as each phase relative to now. */
function windows(phase: Phase, now: number): { registration: { opensAt: string; closesAt: string }; schedule: { startAt: string; endAt: string } } {
  const iso = (offsetDays: number): string => new Date(now + offsetDays * DAY).toISOString();
  switch (phase) {
    case 'reg_open':
      return { registration: { opensAt: iso(-2), closesAt: iso(5) }, schedule: { startAt: iso(7), endAt: iso(9) } };
    case 'upcoming':
      return { registration: { opensAt: iso(3), closesAt: iso(10) }, schedule: { startAt: iso(12), endAt: iso(14) } };
    case 'active':
      return { registration: { opensAt: iso(-10), closesAt: iso(-2) }, schedule: { startAt: iso(-1), endAt: iso(3) } };
    case 'completed':
    case 'cancelled':
      return { registration: { opensAt: iso(-30), closesAt: iso(-20) }, schedule: { startAt: iso(-18), endAt: iso(-15) } };
    case 'draft':
      return { registration: { opensAt: iso(5), closesAt: iso(12) }, schedule: { startAt: iso(14), endAt: iso(16) } };
  }
}

export async function seedTournaments(
  services: Services,
  registry: DemoRegistry,
  summary: SeedSummary,
  users: UserRegistry,
  catalog: CatalogRegistry
): Promise<TournamentRegistry> {
  const db = services.db;
  const tournamentRegistry: TournamentRegistry = new Map();
  const now = Date.now();
  let created = 0;
  let reused = 0;

  for (const s of SPECS) {
    const organizer = users.get(s.organizerKey);
    const gameId = catalog.publishedGames.get(s.game);
    if (organizer === undefined || gameId === undefined) continue;
    const ctx = () => accountContext(organizer.accountId, ['tournament_organizer', 'tournament_administrator']);
    const w = windows(s.phase, now);

    const { id, reused: wasReused } = await ensureDemo(
      registry,
      db,
      { demoSeedKey: demoRef('tournament', s.slug), domainType: 'tournament', collection: 'tournaments', resettable: false },
      async () => {
        const draft = await services.tournaments.createDraft(ctx(), {
          slug: s.slug,
          gameId,
          participantType: s.participantType,
          format: s.format,
          capacity: s.capacity,
          approvalMode: s.approvalMode,
          registration: w.registration,
          schedule: w.schedule,
          ruleProfile: { text: { fa: 'قوانین نمونه برای نمایش محلی.', en: 'Fictional demo rules.' } },
          translations: {
            fa: { name: s.nameFa, summary: `${s.nameFa} — رویداد نمونه.`, description: `توضیح کامل ${s.nameFa}.` },
            en: { name: s.nameEn, summary: `${s.nameEn} — a fictional demo event.`, description: `Full description of ${s.nameEn}.` }
          }
        });
        if (s.phase !== 'draft') {
          await services.tournaments.transition(ctx(), draft._id, 'published', 'demo seed publish');
        }
        if (s.phase === 'cancelled') {
          await services.tournaments.transition(ctx(), draft._id, 'cancelled', 'demo seed cancellation example');
        } else if (s.phase === 'completed') {
          await services.tournaments.transition(ctx(), draft._id, 'completed', 'demo seed completion example');
        }
        return draft._id;
      },
      { slug: s.slug }
    );
    if (wasReused) reused += 1;
    else created += 1;
    tournamentRegistry.set(s.slug, { key: s.slug, id, participantType: s.participantType, capacity: s.capacity });
  }
  summary.record('tournaments', created, reused);
  return tournamentRegistry;
}

/**
 * Registrations and waitlists for the open individual tournaments. Fills one small
 * tournament to capacity (plus a waitlisted entry), approves some, leaves some pending
 * (manual approval), and cancels one — exercising every registration state.
 */
export async function seedRegistrations(
  services: Services,
  summary: SeedSummary,
  users: UserRegistry,
  tournaments: TournamentRegistry
): Promise<void> {
  const db = services.db;
  let registered = 0;

  // Individual players available to register.
  const playerKeys = Array.from({ length: 20 }, (_, i) => `player-${String(i + 1).padStart(2, '0')}`);

  // Only registration-open individual tournaments accept registrations right now.
  const plan: { tournamentSlug: string; approve: boolean; count: number; waitlistExtra: number; manual: boolean }[] = [
    { tournamentSlug: 'nova-open-cup', approve: true, count: 10, waitlistExtra: 0, manual: false },
    { tournamentSlug: 'orbit-qualifier', approve: true, count: 4, waitlistExtra: 2, manual: true } // capacity 4 -> full + waitlist
  ];

  for (const p of plan) {
    const t = tournaments.get(p.tournamentSlug);
    if (t === undefined) continue;
    const organizerCtxRoles = ['tournament_organizer', 'tournament_administrator'];
    const admin = users.get('admin-super');
    if (admin === undefined) continue;
    const adminCtx = () => accountContext(admin.accountId, organizerCtxRoles);

    const total = p.count + p.waitlistExtra;
    for (let i = 0; i < total; i++) {
      const player = users.get(playerKeys[i % playerKeys.length] ?? '');
      if (player === undefined) continue;

      const existing = await services.registrations.myRegistration(player.accountId, t.id);
      let registrationId: string;
      if (existing !== null) {
        registrationId = existing._id;
      } else {
        const reg = await services.registrations.register(accountContext(player.accountId), player.accountId, t.id, {
          idempotencyKey: newIdemKey(`reg:${p.tournamentSlug}:${player.key}`)
        });
        registrationId = reg._id;
        registered += 1;
      }

      // Move some into explicit states via the admin service.
      const current = await services.registrations.getById(t.id, registrationId);
      if (current === null) continue;
      const overCapacity = i >= t.capacity;
      try {
        if (overCapacity && current.state !== 'waitlisted' && current.state !== 'cancelled') {
          await services.registrations.waitlist(adminCtx(), admin.accountId, t.id, registrationId, 'demo seed waitlist');
        } else if (p.manual && p.approve && current.state === 'pending' && i < t.capacity) {
          await services.registrations.approve(adminCtx(), admin.accountId, t.id, registrationId, 'demo seed approval');
        }
      } catch {
        // Capacity/state races are acceptable for demo data; leave the record as-is.
      }
    }
  }

  // One team registration into the open team tournament (owner registers their team).
  const teamTournament = tournaments.get('dragon-team-clash');
  const teamOwner = users.get('organizer-02');
  if (teamTournament !== undefined && teamOwner !== undefined) {
    const team = await db.collection('teams').findOne({ slug: 'dragon-guard' } as never);
    const existing = await services.registrations.myRegistration(teamOwner.accountId, teamTournament.id);
    if (team !== null && existing === null) {
      try {
        await services.registrations.register(accountContext(teamOwner.accountId), teamOwner.accountId, teamTournament.id, {
          teamId: team._id as unknown as string,
          idempotencyKey: newIdemKey('reg:dragon-team-clash:dragon-guard')
        });
        registered += 1;
      } catch {
        // Team eligibility (roster/game identity) may reject; acceptable for demo.
      }
    }
  }

  // One explicit cancellation example.
  const cancelT = tournaments.get('nova-open-cup');
  const canceller = users.get('player-01');
  if (cancelT !== undefined && canceller !== undefined) {
    const reg = await services.registrations.myRegistration(canceller.accountId, cancelT.id);
    if (reg !== null && reg.state !== 'cancelled') {
      try {
        await services.registrations.cancel(accountContext(canceller.accountId), canceller.accountId, cancelT.id, reg._id, {
          asAdmin: false,
          reason: 'demo seed self-cancellation'
        });
      } catch {
        // If cancellation is not permitted from the current state, leave it.
      }
    }
  }

  summary.record('registrations', registered, 0);
}
