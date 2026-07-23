/**
 * Teams, memberships, invitations, and gaming identities — all through the real teams
 * service (owner-gated). Public and private teams, accepted members, pending invitations,
 * one player with several pending invites, plus verified gaming identities (some players
 * across multiple games). The "empty" demo user is deliberately left out of every team.
 */
import type { CatalogRegistry } from './catalog.ts';
import type { SeedSummary } from './harness.ts';
import { demoRef } from './harness.ts';
import type { DemoRegistry } from './registry.ts';
import type { UserRegistry } from './users.ts';
import { accountContext, ensureDemo, type Services } from './wiring.ts';

interface TeamSpec {
  readonly slug: string;
  readonly nameFa: string;
  readonly nameEn: string;
  readonly game: string; // published game slug
  readonly ownerKey: string;
  readonly visibility: 'public' | 'private';
  readonly memberKeys: readonly string[]; // invited AND accepted
  readonly pendingKeys: readonly string[]; // invited, not accepted
}

const TEAMS: readonly TeamSpec[] = [
  { slug: 'nova-wolves', nameFa: 'گرگ‌های نوا', nameEn: 'Nova Wolves', game: 'nova-strike', ownerKey: 'organizer-01', visibility: 'public', memberKeys: ['player-01', 'player-02', 'player-03'], pendingKeys: ['player-15'] },
  { slug: 'dragon-guard', nameFa: 'نگهبان اژدها', nameEn: 'Dragon Guard', game: 'dragon-arena', ownerKey: 'organizer-02', visibility: 'private', memberKeys: ['player-04', 'player-05'], pendingKeys: ['player-15'] },
  { slug: 'astro-aces', nameFa: 'آس‌های فضایی', nameEn: 'Astro Aces', game: 'astro-racers', ownerKey: 'organizer-03', visibility: 'public', memberKeys: ['player-06', 'player-07', 'player-08', 'player-09'], pendingKeys: [] },
  { slug: 'rune-keepers', nameFa: 'نگهبانان رون', nameEn: 'Rune Keepers', game: 'rune-tactics', ownerKey: 'player-10', visibility: 'public', memberKeys: ['player-11'], pendingKeys: ['player-15'] },
  { slug: 'pixel-pilots', nameFa: 'خلبانان پیکسل', nameEn: 'Pixel Pilots', game: 'pixel-league', ownerKey: 'player-12', visibility: 'private', memberKeys: [], pendingKeys: ['player-13'] },
  { slug: 'shadow-syndicate', nameFa: 'سندیکای سایه', nameEn: 'Shadow Syndicate', game: 'shadow-duel', ownerKey: 'player-14', visibility: 'public', memberKeys: ['player-16', 'player-17'], pendingKeys: [] },
  { slug: 'orbit-owls', nameFa: 'جغدهای مداری', nameEn: 'Orbit Owls', game: 'orbit-blitz', ownerKey: 'player-18', visibility: 'public', memberKeys: ['player-19'], pendingKeys: ['player-15'] },
  { slug: 'nova-newcomers', nameFa: 'تازه‌واردان نوا', nameEn: 'Nova Newcomers', game: 'nova-strike', ownerKey: 'player-20', visibility: 'public', memberKeys: [], pendingKeys: [] }
];

// Gaming identities: player key -> list of [gameSlug, inGameName]. Some players multi-game.
const GAMING_IDS: readonly [string, readonly [string, string][]][] = [
  ['player-01', [['nova-strike', 'AvaNova'], ['dragon-arena', 'AvaDragon']]],
  ['player-02', [['nova-strike', 'RezaPrime']]],
  ['player-03', [['nova-strike', 'NovaStormGG'], ['astro-racers', 'StormRacer']]],
  ['player-04', [['dragon-arena', 'MinaShield']]],
  ['player-05', [['dragon-arena', 'LeoFrostbite']]],
  ['player-06', [['astro-racers', 'SaraSpeed']]],
  ['player-07', [['astro-racers', 'MaxVelocity'], ['pixel-league', 'MaxArcade']]],
  ['player-10', [['rune-tactics', 'OmidTactician']]],
  ['player-14', [['shadow-duel', 'AshBlade']]],
  ['player-18', [['orbit-blitz', 'EveOrbit']]]
];

export async function seedCommunity(
  services: Services,
  registry: DemoRegistry,
  summary: SeedSummary,
  users: UserRegistry,
  catalog: CatalogRegistry
): Promise<void> {
  const db = services.db;

  // Gaming identities (upsert per account+game — inherently idempotent). Mutable, resettable.
  let giCreated = 0;
  let giReused = 0;
  for (const [playerKey, ids] of GAMING_IDS) {
    const player = users.get(playerKey);
    if (player === undefined) continue;
    for (const [gameSlug, inGameName] of ids) {
      const gameId = catalog.publishedGames.get(gameSlug);
      if (gameId === undefined) continue;
      const had = await db.collection('gaming_identities').findOne({ accountId: player.accountId, gameId } as never);
      await services.teams.saveGamingIdentity(accountContext(player.accountId), player.accountId, {
        gameId,
        inGameName,
        visibility: 'public'
      });
      const saved = await db.collection('gaming_identities').findOne({ accountId: player.accountId, gameId } as never);
      if (saved !== null) {
        await registry.record({ demoSeedKey: demoRef('gaming', `${playerKey}:${gameSlug}`), domainType: 'gaming_identity', collection: 'gaming_identities', recordId: saved._id as unknown as string, resettable: true });
      }
      if (had === null) giCreated += 1;
      else giReused += 1;
    }
  }
  summary.record('gaming identities', giCreated, giReused);

  // Teams are anchors registrations/competitions reference — preserved, never reset.
  let tCreated = 0;
  let tReused = 0;
  let invited = 0;
  for (const t of TEAMS) {
    const owner = users.get(t.ownerKey);
    const gameId = catalog.publishedGames.get(t.game);
    if (owner === undefined || gameId === undefined) continue;

    const { id: teamId, reused } = await ensureDemo(
      registry,
      db,
      { demoSeedKey: demoRef('team', t.slug), domainType: 'team', collection: 'teams', resettable: false },
      async () => {
        const team = await services.teams.createTeam(accountContext(owner.accountId), owner.accountId, {
          name: t.nameEn,
          description: `${t.nameEn} — a fictional demo team for ${t.game}.`,
          gameId,
          slug: t.slug,
          visibility: t.visibility
        });
        return team._id;
      },
      { slug: t.slug }
    );
    if (reused) tReused += 1;
    else tCreated += 1;

    for (const memberKey of [...t.memberKeys, ...t.pendingKeys]) {
      const member = users.get(memberKey);
      if (member === undefined || member.username === null) continue;
      const pending = t.pendingKeys.includes(memberKey);
      // Skip if a pending invitation or active membership already exists (idempotent).
      const already = await db
        .collection('team_invitations')
        .findOne({ teamId, invitedAccountId: member.accountId, status: 'pending' } as never);
      const isMember = await db
        .collection('team_memberships')
        .findOne({ teamId, accountId: member.accountId, status: 'active' } as never);
      if (already === null && isMember === null) {
        const invitation = await services.teams.invite(accountContext(owner.accountId), owner.accountId, teamId, member.username);
        invited += 1;
        if (!pending) {
          await services.teams.acceptInvitation(accountContext(member.accountId), member.accountId, invitation._id);
        }
      }
    }
  }
  summary.record('teams', tCreated, tReused);
  summary.record('team invites', invited, 0);
}
