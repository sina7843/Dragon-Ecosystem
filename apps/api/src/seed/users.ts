/**
 * Demo users, created through the real mobile-OTP flow and granted roles through the
 * real admin service. Every identity is obviously fictional; mobiles are in a fixed
 * 0912-900-xxxx demo band (never ending 0000/0001, which the mock SMS treats specially).
 * No real names, numbers, or personal data.
 */
import type { Db } from 'mongodb';
import type { AccountRecord, ProfileVisibility } from '../modules/identity/store.ts';
import { newId } from '../shared/ids.ts';
import type { SeedSummary } from './harness.ts';
import { demoRef } from './harness.ts';
import type { DemoRegistry } from './registry.ts';
import { ensureDemoAccount, superActor, sysContext, type Services } from './wiring.ts';

export interface DemoUser {
  readonly key: string;
  readonly accountId: string;
  readonly mobile: string;
  readonly username: string | null;
  readonly role: string | null;
}

export type UserRegistry = Map<string, DemoUser>;

type ProfilePlan =
  | { kind: 'none' } // account only — exercises the "incomplete profile" empty state
  | {
      kind: 'profile';
      username: string;
      displayName: string;
      bio: string;
      visibility: ProfileVisibility;
      locale: 'fa' | 'en';
    };

interface UserSpec {
  readonly key: string;
  readonly mobileSuffix: number; // 0912900{suffix}, 4 digits, >= 1000
  readonly locale: 'fa' | 'en';
  readonly role: string | null;
  readonly profile: ProfilePlan;
  readonly suspended?: boolean;
}

function profile(
  username: string,
  displayName: string,
  bio: string,
  visibility: ProfileVisibility,
  locale: 'fa' | 'en'
): ProfilePlan {
  return { kind: 'profile', username, displayName, bio, visibility, locale };
}

/** Fixed, deterministic roster. Persian and English display names, varied profile states. */
const SPECS: readonly UserSpec[] = [
  { key: 'admin-super', mobileSuffix: 1000, locale: 'en', role: 'super_administrator', profile: profile('demo_superadmin', 'Demo Super Admin', 'Fictional platform owner for the local demo.', 'public', 'en') },
  { key: 'admin-content', mobileSuffix: 1001, locale: 'fa', role: 'content_publisher', profile: profile('demo_editor', 'سردبیر نمونه', 'مدیر محتوای ساختگی برای نمایش محلی.', 'public', 'fa') },
  { key: 'op-finance', mobileSuffix: 1002, locale: 'en', role: 'finance_operator', profile: profile('demo_finance', 'Demo Finance Op', 'Fictional finance operator.', 'private', 'en') },
  { key: 'op-support', mobileSuffix: 1003, locale: 'fa', role: 'support_operator', profile: profile('demo_support', 'پشتیبان نمونه', 'اپراتور پشتیبانی ساختگی.', 'private', 'fa') },
  { key: 'moderator', mobileSuffix: 1004, locale: 'en', role: 'community_moderator', profile: profile('demo_mod', 'Demo Moderator', 'Fictional community moderator.', 'public', 'en') },
  { key: 'organizer-01', mobileSuffix: 1010, locale: 'fa', role: 'tournament_organizer', profile: profile('demo_org_ava', 'آوا برگزارکننده', 'برگزارکننده مسابقات نمونه.', 'public', 'fa') },
  { key: 'organizer-02', mobileSuffix: 1011, locale: 'en', role: 'tournament_organizer', profile: profile('demo_org_kai', 'Kai Organizer', 'Runs fictional demo tournaments.', 'public', 'en') },
  { key: 'organizer-03', mobileSuffix: 1012, locale: 'fa', role: 'tournament_organizer', profile: profile('demo_org_sam', 'سام برگزارکننده', 'برگزارکننده رویدادهای نمایشی.', 'public', 'fa') }
];

// 20 regular players with a mix of Persian/English names, public/private, short/long bios.
const PLAYER_NAMES: readonly [string, string, 'fa' | 'en'][] = [
  ['demo_player_ava', 'آوا بازیکن', 'fa'], ['demo_player_reza', 'رضا پویا', 'fa'], ['demo_player_nova', 'Nova Storm', 'en'],
  ['demo_player_mina', 'مینا راد', 'fa'], ['demo_player_leo', 'Leo Frost', 'en'], ['demo_player_sara', 'سارا مهر', 'fa'],
  ['demo_player_max', 'Max Vega', 'en'], ['demo_player_niki', 'نیکی آرین', 'fa'], ['demo_player_zoe', 'Zoe Kane', 'en'],
  ['demo_player_omid', 'امید کیان', 'fa'], ['demo_player_iris', 'Iris Lane', 'en'], ['demo_player_dara', 'دارا نوری', 'fa'],
  ['demo_player_finn', 'Finn Reed', 'en'], ['demo_player_yas', 'یاس صبا', 'fa'], ['demo_player_ash', 'Ash Vale', 'en'],
  ['demo_player_bita', 'بیتا رها', 'fa'], ['demo_player_ryo', 'Ryo Sato', 'en'], ['demo_player_kian', 'کیان پارسا', 'fa'],
  ['demo_player_eve', 'Eve Winter', 'en'], ['demo_player_tara', 'تارا سها', 'fa']
];

function buildSpecs(): UserSpec[] {
  const specs = [...SPECS];
  PLAYER_NAMES.forEach(([username, displayName, locale], i) => {
    const longBio = i % 4 === 0;
    specs.push({
      key: `player-${String(i + 1).padStart(2, '0')}`,
      mobileSuffix: 2000 + i,
      locale,
      role: null,
      profile: profile(
        username,
        displayName,
        longBio
          ? 'Fictional demo player with a deliberately longer biography so profile cards, truncation, and detail views all have something meaningful to render in both languages.'
          : 'Fictional demo player.',
        i % 3 === 0 ? 'private' : 'public',
        locale
      )
    });
  });
  // Incomplete profiles (account only) for empty-state inspection.
  specs.push({ key: 'incomplete-01', mobileSuffix: 3000, locale: 'fa', role: null, profile: { kind: 'none' } });
  specs.push({ key: 'incomplete-02', mobileSuffix: 3001, locale: 'en', role: null, profile: { kind: 'none' } });
  // Suspended demo user.
  specs.push({ key: 'suspended', mobileSuffix: 3100, locale: 'en', role: null, suspended: true, profile: profile('demo_suspended', 'Demo Suspended', 'Fictional suspended account.', 'public', 'en') });
  // Fully empty user: profile only, no team/wallet/notifications/registrations elsewhere.
  specs.push({ key: 'empty', mobileSuffix: 3200, locale: 'fa', role: null, profile: profile('demo_empty', 'کاربر خالی', 'بدون تیم، کیف پول یا اعلان — برای بررسی حالت خالی.', 'public', 'fa') });
  return specs;
}

function mobileOf(spec: UserSpec): string {
  return `0912900${String(spec.mobileSuffix).padStart(4, '0')}`;
}

export async function seedUsers(services: Services, registry: DemoRegistry, summary: SeedSummary): Promise<UserRegistry> {
  const db: Db = services.db;
  const users: UserRegistry = new Map();
  let created = 0;
  let reused = 0;

  const specs = buildSpecs();

  for (const [i, spec] of specs.entries()) {
    const mobile = mobileOf(spec);
    // Vary the source IP so the per-IP OTP rate limit never trips during a full seed.
    const ip = `127.0.${Math.floor(i / 250)}.${(i % 250) + 1}`;
    const { accountId, created: isNew } = await ensureDemoAccount(services, mobile, spec.locale, ip);
    if (isNew) created += 1;
    else reused += 1;

    // The account anchors immutable financial/registration history — preserved, never reset.
    await registry.record({ demoSeedKey: demoRef('user', spec.key), domainType: 'account', collection: 'accounts', recordId: accountId, resettable: false, businessRef: mobile });

    let username: string | null = null;
    if (spec.profile.kind === 'profile') {
      username = spec.profile.username;
      // Only write the profile when it is not already seeded, so a rerun writes nothing
      // (and appends no audit event). Reset removes the registry entry, so it re-creates.
      if (!(await registry.has(demoRef('profile', spec.key)))) {
        const account = (await db.collection<AccountRecord>('accounts').findOne({ _id: accountId })) as AccountRecord;
        await services.identity.saveProfile(
          account,
          {
            username: spec.profile.username,
            displayName: spec.profile.displayName,
            birthDate: '2000-01-01',
            bio: spec.profile.bio,
            visibility: spec.profile.visibility,
            locale: spec.profile.locale
          },
          newId()
        );
        // A profile row shares the account _id; it is mutable content and may be reset.
        await registry.record({ demoSeedKey: demoRef('profile', spec.key), domainType: 'profile', collection: 'user_profiles', recordId: accountId, resettable: true });
      }
    }

    if (spec.role !== null) {
      // assignRole is not idempotent — only grant when the active assignment is absent.
      const already = await db
        .collection('role_assignments')
        .findOne({ accountId, role: spec.role, revokedAt: null } as never);
      if (already === null) {
        const assignment = await services.admin.assignRole(superActor(), {
          accountId,
          role: spec.role,
          reason: 'demo seed role grant (development only)'
        });
        await registry.record({ demoSeedKey: demoRef('role', spec.key), domainType: 'role_assignment', collection: 'role_assignments', recordId: assignment._id, resettable: true });
      }
    }

    if (spec.suspended === true) {
      await services.identity.transitionAccountState(accountId, 'suspended', sysContext(), 'demo seed: suspended account example');
    }

    users.set(spec.key, { key: spec.key, accountId, mobile, username, role: spec.role });
  }

  summary.record('users', created, reused);
  return users;
}
