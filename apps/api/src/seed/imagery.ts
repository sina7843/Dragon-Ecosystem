/**
 * Attaches generated artwork to the demo entities that have an image slot: game covers,
 * tournament posters, content covers, team logos, and profile avatars.
 *
 * Runs after the entities exist so it works the same on a fresh database and on one seeded
 * before this step existed, and only ever fills an EMPTY slot — an image an operator set by
 * hand is never overwritten, and a rerun writes nothing (no audit noise, no version churn).
 * Every asset is uploaded through the real media service with bilingual alt text.
 */
import { newId } from '../shared/ids.ts';
import type { SeedSummary } from './harness.ts';
import { ensureImageAsset } from './media.ts';
import type { DemoRegistry } from './registry.ts';
import { accountContext, type Services } from './wiring.ts';

interface Named {
  readonly _id: string;
  readonly version: number;
}

/** `alt` for a cover: names the subject, because that is what the image depicts. */
function coverAlt(fa: string, en: string, kind: 'game' | 'tournament' | 'article'): { fa: string; en: string } {
  const faKind = kind === 'game' ? 'بازی' : kind === 'tournament' ? 'مسابقه' : 'مطلب';
  return { fa: `تصویر شاخص ${faKind} ${fa}`, en: `Cover image for the ${kind} ${en}` };
}

export async function seedImagery(
  services: Services,
  registry: DemoRegistry,
  summary: SeedSummary,
  uploaderId: string
): Promise<void> {
  const db = services.db;
  const adminCtx = () => accountContext(uploaderId, ['content_publisher', 'platform_administrator', 'tournament_administrator']);
  let attached = 0;
  let already = 0;

  // --- Game covers (published and draft alike; the admin list shows both) ---
  const games = (await db
    .collection('games')
    .find({ $or: [{ coverImageUrl: null }, { coverImageUrl: { $exists: false } }] })
    .toArray()) as unknown as Array<Named & { slug: string; translations: Record<string, { name: string }> }>;
  for (const game of games) {
    const url = await ensureImageAsset(services, registry, uploaderId, `game:${game.slug}`, 'poster', coverAlt(game.translations['fa']?.name ?? game.slug, game.translations['en']?.name ?? game.slug, 'game'));
    await services.games.update(adminCtx(), game._id, { slug: game.slug, coverImageUrl: url, translations: {}, expectedVersion: game.version });
    attached += 1;
  }

  // --- Content covers ---
  const items = (await db
    .collection('content_items')
    .find({ $or: [{ coverImageUrl: null }, { coverImageUrl: { $exists: false } }] })
    .toArray()) as unknown as Array<Named & { slugs: { en: string }; translations: Record<string, { title: string }> }>;
  for (const item of items) {
    const slug = item.slugs.en;
    const url = await ensureImageAsset(services, registry, uploaderId, `content:${slug}`, 'poster', coverAlt(item.translations['fa']?.title ?? slug, item.translations['en']?.title ?? slug, 'article'));
    await services.content.updateContent(adminCtx(), item._id, { coverImageUrl: url, expectedVersion: item.version });
    attached += 1;
  }

  // --- Tournament posters ---
  // Unlike games/content/teams there is no service write for a PUBLISHED tournament:
  // `updateDraft` is deliberately draft-only and the state machine has no route back to
  // draft. Filling an empty poster slot is a presentation-only backfill with no domain
  // meaning, so the seeder writes the field directly rather than inventing a domain
  // transition for demo data. Development-only, and it never touches a set poster.
  const tournaments = (await db
    .collection('tournaments')
    .find({ $or: [{ coverImageUrl: null }, { coverImageUrl: { $exists: false } }] })
    .toArray()) as unknown as Array<Named & { slug: string; translations: Record<string, { name: string }> }>;
  for (const tournament of tournaments) {
    const url = await ensureImageAsset(services, registry, uploaderId, `tournament:${tournament.slug}`, 'poster', coverAlt(tournament.translations['fa']?.name ?? tournament.slug, tournament.translations['en']?.name ?? tournament.slug, 'tournament'));
    await db.collection('tournaments').updateOne({ _id: tournament._id } as never, { $set: { coverImageUrl: url } });
    attached += 1;
  }

  // --- Team logos (owner-gated, so the write is made by the team's own owner) ---
  const teams = (await db
    .collection('teams')
    .find({ status: 'active', $or: [{ avatarUrl: null }, { avatarUrl: { $exists: false } }] })
    .toArray()) as unknown as Array<Named & { slug: string; name: string }>;
  for (const team of teams) {
    const owner = (await db.collection('team_memberships').findOne({ teamId: team._id, role: 'owner', status: 'active' } as never)) as unknown as { accountId: string } | null;
    if (owner === null) continue;
    const url = await ensureImageAsset(services, registry, uploaderId, `team:${team.slug}`, 'avatar', { fa: `نشان تیم ${team.name}`, en: `Team logo for ${team.name}` });
    await services.teams.updateTeam(accountContext(owner.accountId), owner.accountId, team._id, { avatarUrl: url, expectedVersion: team.version });
    attached += 1;
  }

  // --- Profile avatars ---
  // saveProfile rewrites the whole profile, so the current values are read and resent
  // unchanged alongside the avatar; only the avatar actually differs.
  const profiles = (await db
    .collection('user_profiles')
    .find({ $or: [{ avatarUrl: null }, { avatarUrl: { $exists: false } }] })
    .toArray()) as unknown as Array<{
    _id: string;
    username: string;
    displayName: string;
    birthDate: string;
    bio: string;
    visibility: 'public' | 'private';
  }>;
  for (const profile of profiles) {
    const account = await db.collection('accounts').findOne({ _id: profile._id } as never);
    if (account === null) continue;
    const url = await ensureImageAsset(services, registry, uploaderId, `avatar:${profile.username}`, 'avatar', { fa: `تصویر نمایه ${profile.displayName}`, en: `Profile picture of ${profile.displayName}` });
    await services.identity.saveProfile(
      account as never,
      {
        username: profile.username,
        displayName: profile.displayName,
        birthDate: profile.birthDate,
        bio: profile.bio,
        avatarUrl: url,
        visibility: profile.visibility
      },
      newId()
    );
    attached += 1;
  }

  already = (await db.collection('media_assets').countDocuments()) - attached;
  summary.record('imagery attached', attached, Math.max(0, already));
}
