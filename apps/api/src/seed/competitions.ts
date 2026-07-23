/**
 * Brackets and standings through the real competition services — never by inserting
 * matches, standings, bracket versions, or result history directly. Each demo competition
 * gets its own registration-open tournament with automatic approval, players registered
 * (and thus approved) while it is open, then the bracket is generated and advanced through
 * the normal recordResult lifecycle: one generated, one partially played, one completed
 * (with a result correction), a round-robin with standings, and a Swiss round.
 */
import { demoRef, newIdemKey } from './harness.ts';
import type { SeedSummary } from './harness.ts';
import type { CatalogRegistry } from './catalog.ts';
import type { DemoRegistry } from './registry.ts';
import type { UserRegistry } from './users.ts';
import { accountContext, ensureDemo, type Services } from './wiring.ts';

type Format = 'single_elimination' | 'round_robin' | 'swiss';

interface CompSpec {
  readonly slug: string;
  readonly nameEn: string;
  readonly nameFa: string;
  readonly game: string;
  readonly format: Format;
  readonly players: readonly string[];
  readonly advance: 'generated' | 'partial' | 'complete' | 'round_robin' | 'swiss';
}

const DAY = 86_400_000;

const COMPS: readonly CompSpec[] = [
  { slug: 'comp-se-generated', nameEn: 'Nova Bracket (Seeded)', nameFa: 'جدول نوا (تعیین‌شده)', game: 'nova-strike', format: 'single_elimination', players: ['player-01', 'player-02', 'player-03', 'player-04'], advance: 'generated' },
  { slug: 'comp-se-partial', nameEn: 'Nova Bracket (In Play)', nameFa: 'جدول نوا (در حال اجرا)', game: 'nova-strike', format: 'single_elimination', players: ['player-05', 'player-06', 'player-07', 'player-08'], advance: 'partial' },
  { slug: 'comp-se-complete', nameEn: 'Nova Bracket (Finished)', nameFa: 'جدول نوا (پایان‌یافته)', game: 'nova-strike', format: 'single_elimination', players: ['player-09', 'player-10', 'player-11', 'player-12'], advance: 'complete' },
  { slug: 'comp-round-robin', nameEn: 'Astro Round Robin', nameFa: 'دوره‌ای فضایی', game: 'astro-racers', format: 'round_robin', players: ['player-13', 'player-14', 'player-15', 'player-16'], advance: 'round_robin' },
  { slug: 'comp-swiss', nameEn: 'Rune Swiss', nameFa: 'سوئیسی رون', game: 'rune-tactics', format: 'swiss', players: ['player-17', 'player-18', 'player-19', 'player-20'], advance: 'swiss' }
];

async function recordReady(services: Services, ctx: () => ReturnType<typeof accountContext>, tournamentId: string, max: number): Promise<number> {
  let recorded = 0;
  while (recorded < max) {
    const comp = await services.competitions.getCompetition(tournamentId);
    if (comp === null) break;
    const matches = await services.competitions.listMatches(comp._id);
    const ready = matches.find((m) => m.state === 'ready');
    if (ready === undefined) break;
    await services.competitions.recordResult(ctx(), tournamentId, ready._id, { winnerSlot: 'a', scoreA: 2, scoreB: 1 });
    recorded += 1;
  }
  return recorded;
}

export async function seedCompetitions(
  services: Services,
  registry: DemoRegistry,
  summary: SeedSummary,
  users: UserRegistry,
  catalog: CatalogRegistry
): Promise<void> {
  const db = services.db;
  const organizer = users.get('organizer-01');
  if (organizer === undefined) return;
  const orgCtx = () => accountContext(organizer.accountId, ['tournament_organizer', 'tournament_administrator', 'referee']);
  const now = Date.now();
  const iso = (offsetDays: number): string => new Date(now + offsetDays * DAY).toISOString();

  let built = 0;
  let reusedT = 0;
  let corrections = 0;

  for (const spec of COMPS) {
    const gameId = catalog.publishedGames.get(spec.game);
    if (gameId === undefined) continue;

    const { id: tournamentId, reused } = await ensureDemo(
      registry,
      db,
      { demoSeedKey: demoRef('tournament', spec.slug), domainType: 'tournament', collection: 'tournaments', resettable: false },
      async () => {
        const draft = await services.tournaments.createDraft(orgCtx(), {
          slug: spec.slug,
          gameId,
          participantType: 'individual',
          format: spec.format,
          capacity: spec.players.length,
          approvalMode: 'automatic',
          registration: { opensAt: iso(-2), closesAt: iso(5) },
          schedule: { startAt: iso(7), endAt: iso(9) },
          ruleProfile: { text: { fa: 'قوانین نمونه.', en: 'Fictional demo rules.' } },
          translations: {
            fa: { name: spec.nameFa, summary: `${spec.nameFa} — نمونه.`, description: `توضیح ${spec.nameFa}.` },
            en: { name: spec.nameEn, summary: `${spec.nameEn} — demo.`, description: `Description of ${spec.nameEn}.` }
          }
        });
        await services.tournaments.transition(orgCtx(), draft._id, 'published', 'demo seed publish');
        return draft._id;
      },
      { slug: spec.slug }
    );
    if (reused) reusedT += 1;
    else built += 1;

    // Register the players (automatic approval claims a main seat -> approved).
    for (const key of spec.players) {
      const p = users.get(key);
      if (p === undefined) continue;
      const existing = await services.registrations.myRegistration(p.accountId, tournamentId);
      if (existing === null) {
        try {
          await services.registrations.register(accountContext(p.accountId), p.accountId, tournamentId, {
            idempotencyKey: newIdemKey(`reg:${spec.slug}:${key}`)
          });
        } catch {
          // eligibility/capacity race — leave as-is
        }
      }
    }

    // Generate the bracket once, then advance per plan through the normal lifecycle.
    if ((await services.competitions.getCompetition(tournamentId)) === null) {
      try {
        await services.competitions.generate(orgCtx(), tournamentId, {});
      } catch {
        // Not enough approved participants — skip advancement for this one.
        continue;
      }
    }

    if (spec.advance === 'partial') {
      await recordReady(services, orgCtx, tournamentId, 1);
    } else if (spec.advance === 'complete') {
      await recordReady(services, orgCtx, tournamentId, 100);
      // One deterministic result correction for version history.
      const comp = await services.competitions.getCompetition(tournamentId);
      if (comp !== null && !(await registry.has(demoRef('correction', spec.slug)))) {
        const matches = await services.competitions.listMatches(comp._id);
        // Correct the last-decided match first (the final has no downstream to block it).
        const completed = matches
          .filter((m) => m.state === 'completed')
          .sort((a, b) => (b.round as number) - (a.round as number));
        for (const match of completed) {
          try {
            await services.competitions.correctResult(orgCtx(), tournamentId, match._id, {
              expectedVersion: match.version as number,
              winnerSlot: 'b',
              scoreA: 1,
              scoreB: 2,
              reason: 'Demo: corrected result for version-history display.',
              idempotencyKey: newIdemKey(`correct:${spec.slug}`)
            });
            await registry.record({ demoSeedKey: demoRef('correction', spec.slug), domainType: 'result_correction', collection: 'competition_result_corrections', recordId: `${comp._id}:${match._id}`, resettable: false });
            corrections += 1;
            break;
          } catch {
            // Correcting this match is blocked (downstream completed); try an earlier-decided one.
          }
        }
      }
    } else if (spec.advance === 'round_robin') {
      await recordReady(services, orgCtx, tournamentId, 100);
    } else if (spec.advance === 'swiss') {
      await recordReady(services, orgCtx, tournamentId, 100);
      try {
        await services.competitions.generateSwissRound(orgCtx(), tournamentId);
        await recordReady(services, orgCtx, tournamentId, 100);
      } catch {
        // Swiss may have no further pairings — acceptable
      }
    }

    // Ensure a standings snapshot exists for the played competitions.
    if (spec.advance !== 'generated') {
      try {
        await services.competitions.recalculate(orgCtx(), tournamentId);
      } catch {
        // no-op if standings are already current
      }
    }
  }

  summary.record('competitions', built, reusedT);
  if (corrections > 0) summary.record('result corrections', corrections, 0);
}
