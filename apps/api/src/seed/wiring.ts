/**
 * Builds the real application services for the demo seeder (mirrors server.ts wiring)
 * and provides the small helpers every domain seeder shares: a system request context,
 * a super-admin actor for role grants, a demo-marker stamp, and account creation through
 * the genuine mobile-OTP flow (accounts can only be created by verifyOtp).
 */
import type { Db } from 'mongodb';
import type { AppConfig } from '../config.ts';
import type { Database } from '../shared/db/client.ts';
import { createRequestContext, SYSTEM_ACTOR, type RequestContext } from '../shared/context.ts';
import { newId } from '../shared/ids.ts';
import { normalizeIranianMobile } from '../modules/identity/mobile.ts';
import { readDevInbox } from '../modules/identity/sms.ts';
import type { Actor } from '../modules/admin/service.ts';
import type { DemoRegistry } from './registry.ts';
import {
  buildAdmin,
  buildCheckout,
  buildCompetitions,
  buildContent,
  buildGames,
  buildHolds,
  buildIdentity,
  buildLedger,
  buildMedia,
  buildModeration,
  buildNotifications,
  buildOperations,
  buildPayments,
  buildPrizes,
  buildRegistrations,
  buildTeams,
  buildTournaments
} from '../server.ts';

export function buildServices(database: Database, config: AppConfig) {
  const identity = buildIdentity(database, config);
  const admin = buildAdmin(database);
  const games = buildGames(database);
  const content = buildContent(database);
  const teams = buildTeams(database, games, identity);
  const tournaments = buildTournaments(database, games);
  const registrations = buildRegistrations(database, tournaments, identity, teams);
  const competitions = buildCompetitions(database, tournaments, registrations);
  const ledger = buildLedger(database);
  const payments = buildPayments(database, config, ledger);
  const holds = buildHolds(database, ledger);
  const checkout = buildCheckout(database, config, tournaments, registrations, ledger, holds);
  const prizes = buildPrizes(database, tournaments, competitions, registrations, ledger);
  const notifications = buildNotifications(database, config);
  const moderation = buildModeration(database, identity);
  const operations = buildOperations(database, config, notifications, holds, checkout);
  const media = buildMedia(database, config);
  return {
    db: database.db,
    // The connection itself, so a seeder step may build a second, differently configured
    // instance of a service (see the notification-delivery demo in engagement.ts).
    database,
    config,
    identity: identity.service,
    admin: admin.service,
    games: games.service,
    content: content.service,
    teams: teams.service,
    tournaments: tournaments.service,
    registrations: registrations.service,
    competitions: competitions.service,
    ledger: ledger.service,
    payments: payments.service,
    paymentsMockEnabled: payments.mockEnabled,
    holds: holds.service,
    checkout: checkout.service,
    prizes: prizes.service,
    notifications: notifications.service,
    moderation: moderation.service,
    operations: operations.service,
    media: media.service
  };
}

export type Services = ReturnType<typeof buildServices>;

/** A fresh system request context (audit attributes to "system"). */
export function sysContext(): RequestContext {
  return createRequestContext(newId(), SYSTEM_ACTOR);
}

/** A super-admin actor so the seeder may grant any role, including elevated ones. */
export function superActor(): Actor {
  return { context: sysContext(), isSuperAdmin: true };
}

/** A request context attributed to a real demo account (services that require an author). */
export function accountContext(accountId: string, roles: readonly string[] = []): RequestContext {
  return createRequestContext(newId(), { kind: 'account', accountId, roles });
}

export interface DemoDescriptor {
  demoSeedKey: string;
  domainType: string;
  collection: string;
  resettable: boolean;
  businessRef?: string;
}

/**
 * Idempotent create-through-service, tracked in the demo registry (never on the domain
 * row). If the key is already registered, reuse it. Otherwise, optionally self-heal by a
 * READ-ONLY natural-key lookup (adopts an orphan a prior partial run created without
 * mutating it), else create via the service. In every case ownership is recorded only in
 * the registry, so immutable/append-only domain rows are never written a marker field.
 */
export async function ensureDemo(
  registry: DemoRegistry,
  db: Db,
  desc: DemoDescriptor,
  create: () => Promise<string>,
  naturalFilter?: Record<string, unknown>
): Promise<{ id: string; reused: boolean }> {
  const existing = await registry.find(desc.demoSeedKey);
  if (existing !== null) return { id: existing.recordId, reused: true };
  if (naturalFilter !== undefined) {
    const orphan = await db.collection(desc.collection).findOne(naturalFilter as never);
    if (orphan !== null) {
      const id = orphan._id as unknown as string;
      await registry.record({ ...desc, recordId: id });
      return { id, reused: true };
    }
  }
  const id = await create();
  await registry.record({ ...desc, recordId: id });
  return { id, reused: false };
}

/**
 * Returns the account id for a demo mobile, creating the account through the real
 * mobile-OTP flow on first run (verifyOtp is the only way an account is created) and
 * reusing it on reruns. Reads the plaintext dev OTP from the mock SMS inbox — never a
 * real SMS, and the code is never printed.
 */
export async function ensureDemoAccount(
  services: Services,
  mobile: string,
  locale: 'fa' | 'en',
  ip: string
): Promise<{ accountId: string; created: boolean }> {
  const existing = await services.identity.findAccountIdByMobile(mobile);
  if (existing !== null) return { accountId: existing, created: false };

  const correlationId = newId();
  await services.identity.requestOtp({ mobile, locale, ip, correlationId });
  const canonical = normalizeIranianMobile(mobile);
  const inbox = await readDevInbox(services.db, canonical, 1);
  const code = inbox[0]?.code;
  if (code === undefined) {
    throw new Error(`demo seeder could not read a dev OTP for ${canonical} (is NODE_ENV=development?)`);
  }
  const session = await services.identity.verifyOtp({
    mobile,
    code,
    ip,
    userAgent: 'demo-seeder',
    correlationId: newId()
  });
  return { accountId: session.account._id, created: true };
}
