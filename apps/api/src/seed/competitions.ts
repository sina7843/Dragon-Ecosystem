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

type Format = 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss';

interface CompSpec {
  readonly slug: string;
  readonly nameEn: string;
  readonly nameFa: string;
  readonly game: string;
  readonly format: Format;
  readonly players: readonly string[];
  readonly advance: 'generated' | 'partial' | 'complete' | 'round_robin' | 'swiss';
  /**
   * Prize placements, which are also what gives the prize module something to allocate.
   * A Toman reward becomes a cash entitlement a finance operator works through
   * (pending → approved → paid); a Dragon Coin reward is credited straight to the wallet.
   */
  readonly prizes?: ReadonlyArray<{ rank: number; tomanAmount?: number; dragonCoinAmount?: number }>;
}

const DAY = 86_400_000;

const COMPS: readonly CompSpec[] = [
  { slug: 'comp-se-generated', nameEn: 'Nova Bracket (Seeded)', nameFa: 'جدول نوا (تعیین‌شده)', game: 'nova-strike', format: 'single_elimination', players: ['player-01', 'player-02', 'player-03', 'player-04'], advance: 'generated' },
  { slug: 'comp-se-partial', nameEn: 'Nova Bracket (In Play)', nameFa: 'جدول نوا (در حال اجرا)', game: 'nova-strike', format: 'single_elimination', players: ['player-05', 'player-06', 'player-07', 'player-08'], advance: 'partial' },
  { slug: 'comp-se-complete', nameEn: 'Nova Bracket (Finished)', nameFa: 'جدول نوا (پایان‌یافته)', game: 'nova-strike', format: 'single_elimination', players: ['player-09', 'player-10', 'player-11', 'player-12'], advance: 'complete', prizes: [{ rank: 1, tomanAmount: 3_000_000, dragonCoinAmount: 500 }, { rank: 2, tomanAmount: 1_500_000 }, { rank: 3, tomanAmount: 750_000 }] },
  // Eight entrants so the winners, losers, and grand-final bands all exist; the single
  // 4-player double-elimination tournament in the catalogue never had a competition.
  { slug: 'comp-de-complete', nameEn: 'Shadow Double Elimination', nameFa: 'حذفی دوگانه سایه', game: 'shadow-duel', format: 'double_elimination', players: ['player-01', 'player-02', 'player-03', 'player-04', 'player-05', 'player-06', 'player-07', 'player-08'], advance: 'complete', prizes: [{ rank: 1, dragonCoinAmount: 400 }] },
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
          ...(spec.prizes === undefined ? {} : { prizes: { placements: spec.prizes.map((p) => ({ ...p })) } }),
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

    // Prize placements on a tournament seeded before they existed. `updateDraft` is
    // draft-only and these are published or completed, so this fills the empty slot
    // directly — the same development-only backfill the posters use, and equally
    // presentation-level: it adds a prize table where there was none and never edits one.
    if (spec.prizes !== undefined) {
      const withPrizes = (await db.collection('tournaments').findOne({ _id: tournamentId } as never)) as unknown as
        | { prizes?: { placements?: unknown[]; version?: number } }
        | null;
      if (withPrizes !== null && (withPrizes.prizes?.placements?.length ?? 0) === 0) {
        await db.collection('tournaments').updateOne({ _id: tournamentId } as never, {
          $set: {
            prizes: {
              version: (withPrizes.prizes?.version ?? 0) + 1,
              placements: spec.prizes.map((p) => ({
                rank: p.rank,
                rewards: [
                  ...(p.tomanAmount === undefined ? [] : [{ assetCode: 'IRR', amountInteger: p.tomanAmount * 10 }]),
                  ...(p.dragonCoinAmount === undefined ? [] : [{ assetCode: 'DRC', amountInteger: p.dragonCoinAmount }])
                ]
              }))
            }
          }
        });
      }
    }

    // These are the bracket/standings demos, so their rosters are public: the participant
    // list, and the player links that hang off it, are the point of the page.
    const saved = (await db.collection('tournaments').findOne({ _id: tournamentId } as never)) as unknown as
      | { version: number; participantsPublic?: boolean }
      | null;
    if (saved !== null && saved.participantsPublic !== true) {
      await services.tournaments.setParticipantsVisibility(orgCtx(), tournamentId, true, saved.version);
    }

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

    // Ensure a standings snapshot exists for the played competitions — but only when one
    // is missing. `recalculate` bumps the calculation version every time it runs, and prize
    // allocation is keyed on that version, so calling it unconditionally made each rerun
    // supersede the previous allocation and mint a fresh set of entitlements.
    if (spec.advance !== 'generated' && (await services.competitions.getStandings(tournamentId)) === null) {
      try {
        await services.competitions.recalculate(orgCtx(), tournamentId);
      } catch {
        // Not enough played matches to produce a snapshot yet.
      }
    }

    // A bracket that has been played to the end leaves a finished event, which is what
    // the public results archive shows: final standings, a champion, and no entry form.
    // Only the fully played single-elimination demo qualifies — the others are mid-run.
    if (spec.advance === 'complete') {
      const current = (await db.collection('tournaments').findOne({ _id: tournamentId } as never)) as unknown as
        | { state: string }
        | null;
      if (current?.state === 'published') {
        await services.tournaments.transition(orgCtx(), tournamentId, 'completed', 'demo seed: bracket played to completion');
      }
    }
  }

  summary.record('competitions', built, reusedT);
  if (corrections > 0) summary.record('result corrections', corrections, 0);
}
