import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Db } from 'mongodb';
import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import cookie from '@fastify/cookie';
import { loadConfig, type AppConfig } from './config.ts';
import { Database } from './shared/db/client.ts';
import { allMigrations } from './migrations.ts';
import { runMigrations } from './shared/db/migrations.ts';
import { IdentityService, MockSmsAdapter, KavenegarSmsAdapter, registerIdentityRoutes } from './modules/identity/index.ts';
import { AdminService, AuthorizationService, registerAdminRoutes } from './modules/admin/index.ts';
import { ContentService, registerContentRoutes } from './modules/content/index.ts';
import { GamesService, registerGamesRoutes } from './modules/games/index.ts';
import { TeamsService, registerTeamsRoutes } from './modules/teams/index.ts';
import { TournamentsService, registerTournamentsRoutes } from './modules/tournaments/index.ts';
import { RegistrationsService, registerRegistrationsRoutes } from './modules/registrations/index.ts';
import { CompetitionsService, registerCompetitionsRoutes } from './modules/competitions/index.ts';
import { LedgerService } from './modules/ledger/index.ts';
import { PaymentsService, MockPaymentProvider, registerPaymentsRoutes } from './modules/payments/index.ts';
import { HoldsService, HoldsReconciliation, registerHoldsRoutes } from './modules/holds/index.ts';
import { CheckoutService, registerCheckoutRoutes } from './modules/checkout/index.ts';
import { PrizesService, registerPrizesRoutes } from './modules/prizes/index.ts';
import { NotificationsService, KavenegarSmsChannel, registerNotificationsRoutes, type ContactAccess } from './modules/notifications/index.ts';
import { ModerationService, registerModerationRoutes } from './modules/moderation/index.ts';
import { OperationsService, registerOperationsRoutes, type JobRunner } from './modules/operations/index.ts';
import { MediaService, MongoBlobStorage, registerMediaRoutes, type MediaReferences } from './modules/media/index.ts';
import { SeoService, registerSeoRoutes, type SitemapEntry, type SitemapSource, type Locale as SeoLocale } from './modules/seo/index.ts';
import { StreamsService, LocalStubStreamingProvider, registerStreamsRoutes, isPubliclyReadableStream, type StreamAlerts } from './modules/streams/index.ts';
import { ChatService, registerChatRoutes, type ChatModerationCases, type ChatStreamAccess } from './modules/chat/index.ts';
import { EducationService, registerEducationRoutes } from './modules/education/index.ts';
import { SocialService, DEFAULT_SOCIAL_CONFIG, registerSocialRoutes, type SocialDirectory, type SocialModerationCases } from './modules/social/index.ts';
import { StoreService, registerStoreRoutes, type StorePayments } from './modules/store/index.ts';
import type { EntityId } from './shared/ids.ts';
import { seedSystemConfiguration } from './shared/db/seed.ts';
import { ANONYMOUS_ACTOR, createRequestContext, type RequestContext } from './shared/context.ts';
import { utcNow } from './shared/events.ts';
import { ForbiddenError, NotFoundError, toErrorBody } from './shared/errors.ts';
import { commonErrorResponses, sharedSchemas } from './http/schemas.ts';

export const API_VERSION = '0.1.0';
export const SERVICE_NAME = 'dragon-api';
export const API_PREFIX = '/api/v1';

/** Locale policy from Requirements section 17.1 (I18N-001, I18N-003). */
export const SUPPORTED_LOCALES = ['fa', 'en'] as const;
export const DEFAULT_LOCALE = 'fa';

/**
 * Response security headers (SEC-008). DRAGON-16b (security hardening) added the locked
 * CSP + Permissions-Policy here on API JSON responses; the SPA document CSP and transport
 * headers (HSTS) live in nginx, and the CSRF origin guard is the onRequest hook below.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  // API responses are JSON, never documents or asset hosts: lock the CSP all the way down
  // as defence-in-depth (the SPA document's CSP is served by nginx). No inline/eval.
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  // The API needs no powerful browser features.
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
};

/** Methods that never change state; the CSRF origin guard skips them (they must stay side-effect free). */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Maps the configured trusted-proxy list to Fastify's `trustProxy` option.
 *
 * An empty list becomes `false`: trust nothing, so `request.ip` is the real
 * socket peer (correct for local development and tests). A non-empty list is
 * passed through as explicit addresses, so `X-Forwarded-For` is honoured only
 * when the immediate peer is a listed proxy — a direct client cannot spoof it.
 * We never return `true` (trust everyone) or a hop count (which would trust the
 * direct peer even when the API is reachable without the proxy).
 */
export function resolveTrustProxy(trustedProxies: readonly string[]): false | string[] {
  return trustedProxies.length === 0 ? false : [...trustedProxies];
}

/** Minimum surface the server needs from the data layer, so tests can supply a stub. */
export interface HealthCheckable {
  ping(): Promise<boolean>;
}

export interface ServerDependencies {
  readonly database: HealthCheckable;
  /** Present once the data layer is connected; contract tests may omit it. */
  readonly identity?: { service: IdentityService; db: Db };
  readonly admin?: { service: AdminService; authorization: AuthorizationService };
  readonly content?: { service: ContentService };
  readonly games?: { service: GamesService };
  readonly teams?: { service: TeamsService };
  readonly tournaments?: { service: TournamentsService };
  readonly registrations?: { service: RegistrationsService };
  readonly competitions?: { service: CompetitionsService };
  readonly payments?: { service: PaymentsService; db: Db; mockEnabled: boolean };
  readonly holds?: { service: HoldsService; reconciliation: HoldsReconciliation; db: Db };
  readonly checkout?: { service: CheckoutService; db: Db; mockEnabled: boolean };
  readonly prizes?: { service: PrizesService };
  readonly notifications?: { service: NotificationsService };
  readonly moderation?: { service: ModerationService };
  readonly operations?: { service: OperationsService };
  readonly media?: { service: MediaService };
  readonly seo?: { service: SeoService };
  readonly streams?: { service: StreamsService };
  readonly chat?: { service: ChatService };
  readonly education?: { service: EducationService };
  readonly social?: { service: SocialService };
  readonly store?: { service: StoreService };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Correlation and actor context for every request (section 16.2, AUDIT-001). */
    requestContext: RequestContext;
  }
}

export function buildServer(config: AppConfig, deps: ServerDependencies): FastifyInstance {
  const app = Fastify({
    // Correlation ID for every request (Requirements section 28.1).
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-correlation-id',
    // Trust X-Forwarded-For only from the configured reverse proxy, so per-IP
    // rate limits key on the real client behind nginx and cannot be spoofed by a
    // direct caller (SEC-009).
    trustProxy: resolveTrustProxy(config.trustedProxies),
    logger: {
      level: config.env === 'test' ? 'silent' : 'info',
      base: { service: SERVICE_NAME, environment: config.env },
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      // Never log credential-bearing headers (SEC-012).
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[redacted]'
      }
    }
  });

  for (const schema of sharedSchemas) app.addSchema(schema);

  // Session state travels in an httpOnly cookie (section 16.1).
  app.register(cookie);

  // Every request carries a context before any handler runs; authentication
  // upgrades the actor from anonymous in DRAGON-03.
  app.addHook('onRequest', async (request) => {
    request.requestContext = createRequestContext(String(request.id), ANONYMOUS_ACTOR);
  });

  // CSRF defence-in-depth (SEC): when a public origin is configured (production), a
  // state-changing request that carries a browser Origin must match it. A cross-site page
  // always sends its own Origin on an unsafe cross-site request, so this blocks browser
  // CSRF against the cookie session on top of SameSite=Lax. Requests with no Origin
  // (server-to-server, native API clients) are unaffected — CSRF needs a browser, which
  // always sets Origin. Skipped entirely when no public origin is set (local/dev/test),
  // where the browser origin and the proxied API host legitimately differ.
  app.addHook('onRequest', async (request, reply) => {
    if (config.publicOrigin === '' || SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin === undefined || origin === config.publicOrigin) return;
    const { status, body } = toErrorBody(new ForbiddenError('Cross-origin request rejected.'), String(request.id));
    return reply.status(status).send(body);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.id);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
    // Dynamic API responses are never cacheable, and authenticated JSON must not linger in
    // a shared/browser cache. Root routes that set their own cache-control (media, sitemap,
    // robots) are left untouched.
    if (request.url.startsWith(API_PREFIX) && reply.getHeader('cache-control') === undefined) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Dragon Ecosystem API',
        description: 'Versioned HTTPS JSON API for the Dragon Ecosystem platform.',
        version: API_VERSION
      },
      // Paths are absolute, so the document is served relative to the deployment root.
      servers: [{ url: '/', description: 'Deployment root' }],
      tags: [{ name: 'operations', description: 'Health, readiness, and service metadata.' }]
    },
    // Publish shared schemas under their $id instead of generated def-N names.
    refResolver: {
      buildLocalReference(json, _baseUri, _fragment, i) {
        return typeof json['$id'] === 'string' ? json['$id'] : `def-${String(i)}`;
      }
    }
  });

  // Operational routes live in their own plugin so @fastify/swagger, registered
  // above, is loaded before these routes are declared and can document them.
  app.register(async (operations) => {
    // Liveness only: process viability, no dependency calls (Requirements section 28.4).
    operations.get(
      '/health',
      {
        schema: {
          tags: ['operations'],
          summary: 'Liveness probe.',
          response: { 200: { $ref: 'HealthResponse#' } }
        }
      },
      async () => ({
        status: 'ok',
        service: SERVICE_NAME,
        version: API_VERSION,
        time: new Date().toISOString()
      })
    );

    // Readiness tests required local dependencies without causing heavy load (section 28.4).
    operations.get(
      '/health/ready',
      {
        schema: {
          tags: ['operations'],
          summary: 'Readiness probe.',
          response: {
            200: { $ref: 'ReadinessResponse#' },
            503: { $ref: 'ReadinessResponse#' }
          }
        }
      },
      async (request, reply) => {
        let mongoOk = false;
        try {
          mongoOk = await deps.database.ping();
        } catch (error) {
          request.log.warn({ err: error }, 'readiness check failed');
        }
        reply.status(mongoOk ? 200 : 503);
        return { status: mongoOk ? 'ready' : 'not_ready', checks: { mongo: mongoOk ? 'ok' : 'failed' } };
      }
    );
  });

  // Public media byte serving at the site root (MEDIA-007): only a published asset is
  // served; the URL is content-addressed so responses are safely cacheable/immutable.
  if (deps.media !== undefined) {
    const media = deps.media.service;
    app.register(async (root) => {
      root.get('/media/:id', { schema: { tags: ['media'], summary: 'Serve a published media asset by id.', params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } } } }, async (request, reply) => {
        // Metadata only first: a conditional hit returns 304 without ever loading the bytes.
        const meta = await media.getPublishedRecordMeta((request.params as { id: string }).id);
        if (meta === null) {
          const { status, body } = toErrorBody(new NotFoundError('Unknown media asset.'), String(request.id));
          return reply.status(status).send(body);
        }
        const etag = `"${meta.sha256}"`;
        reply.header('cache-control', 'public, max-age=31536000, immutable').header('etag', etag);
        // Content-addressed: a matching validator means the client already has these exact
        // bytes, so skip re-transferring them (304).
        if (request.headers['if-none-match'] === etag) {
          return reply.status(304).send();
        }
        const bytes = await media.readBytes(meta.storageKey);
        if (bytes === null) {
          const { status, body } = toErrorBody(new NotFoundError('Unknown media asset.'), String(request.id));
          return reply.status(status).send(body);
        }
        return reply.header('content-type', meta.contentType).send(bytes);
      });
    });
  }

  // SEO robots.txt + sitemap.xml at the site root (SEO-005/006).
  if (deps.seo !== undefined) {
    const seo = deps.seo.service;
    app.register(async (root) => {
      registerSeoRoutes(root, { seo });
    });
  }

  app.register(
    async (api) => {
      api.get(
        '/meta',
        {
          schema: {
            tags: ['operations'],
            summary: 'Service metadata and supported locales.',
            response: { 200: { $ref: 'MetaResponse#' }, ...commonErrorResponses }
          }
        },
        async () => ({
          name: SERVICE_NAME,
          version: API_VERSION,
          environment: config.env,
          locales: [...SUPPORTED_LOCALES],
          defaultLocale: DEFAULT_LOCALE
        })
      );

      // Published contract, generated from the same schemas the server enforces.
      api.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

      // Development and test only: reports the client IP the server resolved, so
      // proxy-trust behaviour can be asserted end to end. Not registered in
      // production, so it exposes nothing there.
      if (config.env !== 'production') {
        api.get('/dev/client-ip', { schema: { hide: true } }, async (request) => ({ ip: request.ip }));
      }

      if (deps.identity !== undefined) {
        registerIdentityRoutes(api, deps.identity.service, config, deps.identity.db);

        if (deps.admin !== undefined) {
          registerAdminRoutes(api, {
            identity: deps.identity.service,
            authorization: deps.admin.authorization,
            admin: deps.admin.service,
            devRoutesEnabled: config.devRoutesEnabled
          });

          if (deps.content !== undefined) {
            registerContentRoutes(api, {
              identity: deps.identity.service,
              authorization: deps.admin.authorization,
              content: deps.content.service
            });
          }
          if (deps.games !== undefined) {
            registerGamesRoutes(api, {
              identity: deps.identity.service,
              authorization: deps.admin.authorization,
              games: deps.games.service
            });
          }
          if (deps.teams !== undefined) {
            registerTeamsRoutes(api, { identity: deps.identity.service, teams: deps.teams.service });
          }
          // Streams reference games, tournaments, and matches by id only, so the module
          // has no service dependency on them and registers independently.
          if (deps.streams !== undefined) {
            registerStreamsRoutes(api, {
              identity: deps.identity.service,
              authorization: deps.admin.authorization,
              streams: deps.streams.service
            });
          }
          // Education reuses identity, media, and the shared holds/ledger boundary; it has
          // no dependency on tournaments, so it registers independently.
          if (deps.education !== undefined) {
            registerEducationRoutes(api, {
              identity: deps.identity.service,
              authorization: deps.admin.authorization,
              education: deps.education.service
            });
          }
          // The store reaches money only through the shared holds boundary, so it needs no
          // other module and registers independently.
          if (deps.store !== undefined) {
            registerStoreRoutes(api, {
              identity: deps.identity.service,
              authorization: deps.admin.authorization,
              store: deps.store.service
            });
          }
          // The community reaches identity and moderation through ports only, so it needs
          // no other module and registers independently.
          if (deps.social !== undefined) {
            registerSocialRoutes(api, {
              identity: deps.identity.service,
              authorization: deps.admin.authorization,
              social: deps.social.service
            });
          }
          // Chat rooms exist only for streams, so the module is registered alongside them.
          if (deps.chat !== undefined) {
            registerChatRoutes(api, {
              identity: deps.identity.service,
              authorization: deps.admin.authorization,
              chat: deps.chat.service
            });
          }
          if (deps.tournaments !== undefined) {
            registerTournamentsRoutes(api, {
              identity: deps.identity.service,
              authorization: deps.admin.authorization,
              tournaments: deps.tournaments.service
            });

            if (deps.registrations !== undefined) {
              registerRegistrationsRoutes(api, {
                identity: deps.identity.service,
                authorization: deps.admin.authorization,
                registrations: deps.registrations.service
              });
            }
            // Competitions join bracket seeds onto participant names, so the public
            // bracket/standings routes need the registrations service too.
            if (deps.competitions !== undefined && deps.registrations !== undefined) {
              registerCompetitionsRoutes(api, {
                identity: deps.identity.service,
                authorization: deps.admin.authorization,
                tournaments: deps.tournaments.service,
                registrations: deps.registrations.service,
                competitions: deps.competitions.service
              });
            }
            if (deps.payments !== undefined) {
              registerPaymentsRoutes(api, {
                identity: deps.identity.service,
                authorization: deps.admin.authorization,
                payments: deps.payments.service,
                db: deps.payments.db,
                mockEnabled: deps.payments.mockEnabled
              });
            }
            if (deps.holds !== undefined) {
              registerHoldsRoutes(api, {
                identity: deps.identity.service,
                authorization: deps.admin.authorization,
                holds: deps.holds.service,
                reconciliation: deps.holds.reconciliation,
                db: deps.holds.db
              });
            }
            if (deps.checkout !== undefined) {
              registerCheckoutRoutes(api, {
                identity: deps.identity.service,
                authorization: deps.admin.authorization,
                checkout: deps.checkout.service,
                db: deps.checkout.db,
                mockEnabled: deps.checkout.mockEnabled
              });
            }
            if (deps.prizes !== undefined) {
              registerPrizesRoutes(api, {
                identity: deps.identity.service,
                authorization: deps.admin.authorization,
                prizes: deps.prizes.service
              });
            }
            if (deps.notifications !== undefined) {
              registerNotificationsRoutes(api, {
                identity: deps.identity.service,
                authorization: deps.admin.authorization,
                notifications: deps.notifications.service
              });
            }
            if (deps.moderation !== undefined) {
              registerModerationRoutes(api, {
                identity: deps.identity.service,
                authorization: deps.admin.authorization,
                moderation: deps.moderation.service
              });
            }
            if (deps.operations !== undefined) {
              registerOperationsRoutes(api, {
                identity: deps.identity.service,
                authorization: deps.admin.authorization,
                operations: deps.operations.service
              });
            }
            if (deps.media !== undefined) {
              registerMediaRoutes(api, {
                identity: deps.identity.service,
                authorization: deps.admin.authorization,
                media: deps.media.service,
                maxUploadBytes: config.mediaMaxBytes
              });
            }
          }
        }
      }
    },
    { prefix: API_PREFIX }
  );

  app.setNotFoundHandler((request, reply) => {
    const { status, body } = toErrorBody(new NotFoundError(), String(request.id));
    reply.status(status).send(body);
  });

  app.setErrorHandler((error, request, reply) => {
    const { status, body } = toErrorBody(error, String(request.id));
    if (status >= 500) request.log.error({ err: error }, 'unhandled request error');
    reply.status(status).send(body);
  });

  return app;
}

/**
 * Controlled startup job: migrations and the system-configuration seed run before
 * the server accepts traffic (section 34.4). Both are idempotent and replica-safe.
 */
export async function prepareDatabase(database: Database): Promise<string[]> {
  const applied = await runMigrations(database.db, allMigrations);
  await seedSystemConfiguration(database.db);
  return applied;
}

/** Wires the identity module to a live database, selecting the configured SMS provider. */
export function buildIdentity(database: Database, config: AppConfig): { service: IdentityService; db: Db } {
  const sms =
    config.sms.provider === 'kavenegar' && config.sms.kavenegar !== null
      ? new KavenegarSmsAdapter(database.db, { apiKey: config.sms.kavenegar.apiKey, otpTemplate: config.sms.kavenegar.otpTemplate })
      : new MockSmsAdapter(database.db, config.env);
  return { service: new IdentityService(database, config.auth, sms, config.env), db: database.db };
}

/** Wires the administration module to a live database. */
export function buildAdmin(database: Database): { service: AdminService; authorization: AuthorizationService } {
  return { service: new AdminService(database), authorization: new AuthorizationService(database.db) };
}

/** Wires the content module to a live database. */
export function buildContent(database: Database): { service: ContentService } {
  return { service: new ContentService(database) };
}

/** Wires the games module to a live database. */
export function buildGames(database: Database): { service: GamesService } {
  return { service: new GamesService(database) };
}

/**
 * Wires the teams module. It depends on the games catalog (to reference published
 * games) and identity (to resolve usernames and public identities) across the
 * module boundary via their public services.
 */
export function buildTeams(
  database: Database,
  games: { service: GamesService },
  identity: { service: IdentityService }
): { service: TeamsService } {
  return { service: new TeamsService(database, games.service, identity.service) };
}

/** Wires the tournaments module; it references published games across the module boundary. */
export function buildTournaments(database: Database, games: { service: GamesService }): { service: TournamentsService } {
  return { service: new TournamentsService(database, games.service) };
}

/**
 * Wires the registrations module. It reads tournaments (definition), identity
 * (profile/age eligibility), and teams (owner-gated roster snapshots and gaming
 * identity) across their public services.
 */
export function buildRegistrations(
  database: Database,
  tournaments: { service: TournamentsService },
  identity: { service: IdentityService },
  teams: { service: TeamsService }
): { service: RegistrationsService } {
  return { service: new RegistrationsService(database, tournaments.service, identity.service, teams.service) };
}

/** Wires the competitions module; it reads tournaments and approved registrations across their public services. */
export function buildCompetitions(
  database: Database,
  tournaments: { service: TournamentsService },
  registrations: { service: RegistrationsService }
): { service: CompetitionsService } {
  return { service: new CompetitionsService(database, tournaments.service, registrations.service) };
}

export function buildLedger(database: Database): { service: LedgerService } {
  return { service: new LedgerService(database) };
}

export function buildPayments(database: Database, config: AppConfig, ledger: { service: LedgerService }): { service: PaymentsService; db: Db; mockEnabled: boolean } {
  const provider = new MockPaymentProvider(config.payments.callbackSecret);
  const service = new PaymentsService(database, ledger.service, provider, { mockEnabled: config.payments.mockEnabled, purchaseTtlSeconds: config.payments.purchaseTtlSeconds });
  // The self-serve `/payments/mock/pay` test control (which self-signs a success and
  // would let a caller credit themselves) is fail-closed: registered only outside
  // production, even if PAYMENTS_MOCK_ENABLED is explicitly set. The mock provider
  // itself may still back purchases in a non-production or explicitly-opted prod env.
  return { service, db: database.db, mockEnabled: config.payments.mockEnabled && config.env !== 'production' };
}

export function buildHolds(database: Database, ledger: { service: LedgerService }): { service: HoldsService; reconciliation: HoldsReconciliation; db: Db } {
  return { service: new HoldsService(database, ledger.service), reconciliation: new HoldsReconciliation(database), db: database.db };
}

export function buildCheckout(
  database: Database,
  config: AppConfig,
  tournaments: { service: TournamentsService },
  registrations: { service: RegistrationsService },
  ledger: { service: LedgerService },
  holds: { service: HoldsService }
): { service: CheckoutService; db: Db; mockEnabled: boolean } {
  const provider = new MockPaymentProvider(config.payments.callbackSecret);
  const service = new CheckoutService(
    database,
    { paidTournamentsEnabled: config.paidTournamentsEnabled, ttlSeconds: config.payments.purchaseTtlSeconds },
    tournaments.service,
    registrations.service,
    ledger.service,
    holds.service,
    provider
  );
  return { service, db: database.db, mockEnabled: config.payments.mockEnabled && config.env !== 'production' };
}

export function buildPrizes(
  database: Database,
  tournaments: { service: TournamentsService },
  competitions: { service: CompetitionsService },
  registrations: { service: RegistrationsService },
  ledger: { service: LedgerService }
): { service: PrizesService } {
  return { service: new PrizesService(database, tournaments.service, competitions.service, registrations.service, ledger.service) };
}

export function buildNotifications(database: Database, config: AppConfig): { service: NotificationsService } {
  // Reads the recipient's contact + locale for channel delivery; the full mobile/email
  // is only used at send time and never stored (deliveries keep a mask only).
  const contacts: ContactAccess = {
    async getContact(accountId) {
      const account = await database.db.collection<{ _id: string; locale?: string }>('accounts').findOne({ _id: accountId });
      if (account === null) return null;
      // Only a VERIFIED contact may receive a notification — never an unverified or
      // stale address left mid-verification (privacy; fail-closed like the channel gates).
      const methods = await database.db.collection<{ accountId: string; type: string; canonical: string; verified: boolean }>('identity_methods').find({ accountId, verified: true }).toArray();
      const mobile = methods.find((m) => m.type === 'mobile')?.canonical ?? null;
      const email = methods.find((m) => m.type === 'email')?.canonical ?? null;
      return { mobile, email, locale: account.locale === 'en' ? 'en' : 'fa' };
    }
  };
  const smsChannel =
    config.sms.provider === 'kavenegar' && config.sms.kavenegar !== null
      ? new KavenegarSmsChannel({ apiKey: config.sms.kavenegar.apiKey, sender: config.sms.kavenegar.sender })
      : undefined;
  return { service: new NotificationsService(database, { smsEnabled: config.notificationsSmsEnabled, emailEnabled: config.notificationsEmailEnabled }, config.env, contacts, smsChannel) };
}

export function buildModeration(database: Database, identity: { service: IdentityService }): { service: ModerationService } {
  // Moderation only reaches identity through a narrow suspend adapter — it never
  // touches authentication or account internals directly.
  return {
    service: new ModerationService(database, {
      async suspendAccount(accountId, context, reason, emergency) {
        await identity.service.transitionAccountState(accountId, 'suspended', context, reason, { emergency });
      }
    })
  };
}

export function buildOperations(
  database: Database,
  config: AppConfig,
  notifications: { service: NotificationsService },
  holds: { service: HoldsService },
  checkout: { service: CheckoutService }
): { service: OperationsService } {
  // The bounded runner drains the outbox → deliveries → expiries in a fixed order;
  // each returns bounded numeric counters recorded as the job execution result.
  const jobs: readonly JobRunner[] = [
    { name: 'notifications.outbox', run: (context, limit) => notifications.service.processOutbox(context, { limit }) },
    { name: 'notifications.deliveries', run: (context, limit) => notifications.service.processDeliveries(context, { limit }) },
    { name: 'holds.expire', run: (context, limit) => holds.service.expireDueHolds(context, { limit }) },
    { name: 'checkout.expire', run: (context, limit) => checkout.service.expireDueCheckouts(context, { limit }) }
  ];
  return { service: new OperationsService(database, { analyticsExternalEnabled: config.analyticsExternalEnabled, pseudonymSalt: config.pseudonymSalt }, jobs) };
}

export function buildMedia(database: Database, config: AppConfig): { service: MediaService } {
  const storage = new MongoBlobStorage(database.db);
  // MEDIA-008: a media URL is "referenced" while any published cover image points at it.
  // The check reads the reference field only; it never mutates another module's data.
  const references: MediaReferences = {
    async isReferenced(publicUrl) {
      const [content, games] = await Promise.all([
        database.db.collection('content_items').countDocuments({ coverImageUrl: publicUrl }, { limit: 1 }),
        database.db.collection('games').countDocuments({ coverImageUrl: publicUrl }, { limit: 1 })
      ]);
      return content + games > 0;
    }
  };
  return { service: new MediaService(database, storage, { mediaMaxBytes: config.mediaMaxBytes }, references) };
}

/**
 * Wires the streams module.
 *
 * The provider is selected here, not inside the service, so the domain never learns which
 * vendor is behind the adapter (STREAM-002, section 33.1). Operator alerts go through a
 * narrow port bound to the operations service, so streams never import its internals.
 */
export function buildStreams(
  database: Database,
  config: AppConfig,
  operations: { service: OperationsService }
): { service: StreamsService } {
  const provider = new LocalStubStreamingProvider(config.streaming.secureLinkSecret);
  const alerts: StreamAlerts = {
    async raise(context, input) {
      await operations.service.raiseAlert(context, { category: 'stream', severity: input.severity, message: input.message, detail: input.detail });
    }
  };
  return {
    service: new StreamsService(
      database,
      provider,
      { rightsPolicyApproved: config.streaming.rightsPolicyApproved, playbackTtlSeconds: config.streaming.playbackTtlSeconds },
      alerts
    )
  };
}

/**
 * Wires the chat module.
 *
 * Chat reaches streams and moderation only through narrow ports: it asks streams whether
 * a visitor may watch (so a room inherits the stream's access decision rather than
 * inventing one), and it files reports into the shared moderation case workflow instead
 * of keeping a private report table.
 */
export function buildChat(
  database: Database,
  streams: { service: StreamsService },
  moderation: { service: ModerationService }
): { service: ChatService } {
  const streamAccess: ChatStreamAccess = {
    async getWatchable(streamId) {
      const stream = await streams.service.getById(streamId);
      if (stream === null) return null;
      return { readable: isPubliclyReadableStream(stream.state), accessMode: stream.accessMode };
    }
  };
  const cases: ChatModerationCases = {
    fileReport: (context, reporterId, input) => moderation.service.fileReport(context, reporterId, input)
  };
  return { service: new ChatService(database, streamAccess, cases) };
}

/**
 * Wires the education module.
 *
 * The paid path reaches money only through the shared holds service, which itself posts
 * through the ledger — so there is no education-specific balance anywhere (EDU-010).
 */
export function buildEducation(database: Database, config: AppConfig, holds: { service: HoldsService }): { service: EducationService } {
  return { service: new EducationService(database, { paidCoursesEnabled: config.paidCoursesEnabled }, holds.service) };
}

/**
 * Wires the community module.
 *
 * Social reaches identity and moderation only through narrow ports. The directory port is
 * what keeps privacy-by-default honest: the social module never queries `user_profiles`
 * itself, so "is this account publicly visible" and "does this @mention resolve" are both
 * answered by the same identity rules the rest of the product already uses (section 16.4)
 * rather than by a second, drifting copy of them.
 */
export function buildSocial(
  database: Database,
  config: AppConfig,
  identity: { service: IdentityService },
  moderation: { service: ModerationService }
): { service: SocialService } {
  const directory: SocialDirectory = {
    async isPubliclyVisible(accountId) {
      return (await identity.service.getPublicIdentities([accountId])).has(accountId);
    },
    async resolveMentionable(usernames) {
      const resolved = new Map<string, EntityId>();
      for (const username of usernames) {
        // A private profile must not be mentionable, otherwise a mention notification
        // would confirm the account exists.
        if (!(await identity.service.isProfilePublic(username))) continue;
        const accountId = await identity.service.findAccountIdByUsername(username);
        if (accountId !== null) resolved.set(username, accountId);
      }
      return resolved;
    }
  };
  const cases: SocialModerationCases = {
    fileReport: (context, reporterId, input) => moderation.service.fileReport(context, reporterId, input)
  };
  return {
    service: new SocialService(
      database,
      {
        ...DEFAULT_SOCIAL_CONFIG,
        blockingEnabled: config.socialBlockingEnabled,
        appealsEnabled: config.moderationAppealsEnabled,
        pushEnabled: config.pushNotificationsEnabled
      },
      directory,
      cases
    )
  };
}

/**
 * Wires the store module.
 *
 * Commerce reaches money only through the shared holds service, which posts through the
 * ledger — so there is no store-specific balance, and a shop operator (ROLE-021) cannot
 * touch a ledger even indirectly. The only monetary effect the store can cause is the
 * customer's own reservation and capture of their Dragon Coin.
 */
export function buildStore(database: Database, config: AppConfig, holds: { service: HoldsService }): { service: StoreService } {
  const payments: StorePayments = {
    createHold: (context, ownerId, input) => holds.service.createHold(context, ownerId, input),
    captureHold: (context, holdId, input) => holds.service.captureHold(context, holdId, input),
    releaseHold: (context, holdId, input) => holds.service.releaseHold(context, holdId, input)
  };
  return {
    service: new StoreService(
      database,
      {
        physicalFulfillmentEnabled: config.physicalFulfillmentEnabled,
        entitlementRevocationEnabled: config.entitlementRevocationEnabled
      },
      payments
    )
  };
}

export function buildSeo(database: Database, config: AppConfig): { service: SeoService } {
  // Bounded scan cap so the sitemap never runs an unbounded query (PERF-010). A larger
  // catalog would page; the launch catalog fits well within this ceiling.
  const CAP = 5000;
  const both = (make: (locale: SeoLocale) => string): SitemapEntry => ({
    path: make('fa'),
    alternates: { fa: make('fa'), en: make('en') }
  });
  const source: SitemapSource = {
    async collect() {
      const entries: SitemapEntry[] = [];
      // Static public pages.
      for (const base of ['', '/content', '/games', '/tournaments']) {
        entries.push(both((locale) => `/${locale}${base}`));
      }
      const [content, games, tournaments] = await Promise.all([
        database.db.collection<{ type: string; slugs: Record<string, string> }>('content_items').find({ state: 'published', publishedAt: { $lte: utcNow() } }, { projection: { type: 1, slugs: 1 } }).limit(CAP).toArray(),
        database.db.collection<{ slug: string }>('games').find({ status: 'published' }, { projection: { slug: 1 } }).limit(CAP).toArray(),
        database.db.collection<{ slug: string }>('tournaments').find({ state: 'published' }, { projection: { slug: 1 } }).limit(CAP).toArray()
      ]);
      for (const item of content) {
        // Content slugs are per-locale (DEC): hreflang must point at each locale's own slug.
        entries.push({
          path: `/fa/content/${item.type}/${item.slugs['fa']}`,
          alternates: { fa: `/fa/content/${item.type}/${item.slugs['fa']}`, en: `/en/content/${item.type}/${item.slugs['en']}` }
        });
      }
      for (const game of games) entries.push(both((locale) => `/${locale}/games/${game.slug}`));
      for (const t of tournaments) entries.push(both((locale) => `/${locale}/tournaments/${t.slug}`));
      return entries;
    }
  };
  return { service: new SeoService({ env: config.env, publicOrigin: config.publicOrigin }, source) };
}

/** Entry point guard: only start listening when executed directly (pathToFileURL keeps this correct on Windows). */
const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  const config = loadConfig();
  const database = await Database.connect(config.mongoUri);
  await prepareDatabase(database);

  const identity = buildIdentity(database, config);
  const games = buildGames(database);
  const teams = buildTeams(database, games, identity);
  const tournaments = buildTournaments(database, games);
  const registrations = buildRegistrations(database, tournaments, identity, teams);
  const ledger = buildLedger(database);
  const holds = buildHolds(database, ledger);
  const competitions = buildCompetitions(database, tournaments, registrations);
  const checkout = buildCheckout(database, config, tournaments, registrations, ledger, holds);
  const notifications = buildNotifications(database, config);
  const operations = buildOperations(database, config, notifications, holds, checkout);
  const moderation = buildModeration(database, identity);
  const streams = buildStreams(database, config, operations);
  const app = buildServer(config, {
    database,
    identity,
    admin: buildAdmin(database),
    content: buildContent(database),
    games,
    teams,
    tournaments,
    registrations,
    competitions,
    payments: buildPayments(database, config, ledger),
    holds,
    checkout,
    prizes: buildPrizes(database, tournaments, competitions, registrations, ledger),
    notifications,
    moderation,
    operations,
    media: buildMedia(database, config),
    seo: buildSeo(database, config),
    streams,
    chat: buildChat(database, streams, moderation),
    education: buildEducation(database, config, holds),
    social: buildSocial(database, config, identity, moderation),
    store: buildStore(database, config, holds)
  });

  // Defense in depth: a non-production server exposes read-only development routes
  // (mock SMS inbox, client-ip probe) and may use placeholder secrets. NODE_ENV
  // defaults to development when unset, so this warning makes an accidental
  // non-production deployment loud. Set NODE_ENV=production for any real deployment.
  if (config.env !== 'production') {
    app.log.warn({ env: config.env }, 'SECURITY: non-production environment — development routes and placeholder secrets may be active.');
  }
  // The privileged, unauthenticated /dev/grant-role is registered only behind an
  // explicit flag; warn loudly whenever it is on.
  if (config.devRoutesEnabled) {
    app.log.warn(
      { env: config.env },
      'SECURITY: ENABLE_DEV_ROUTES=true — the unauthenticated /api/v1/dev/grant-role is registered. Never enable this outside local development or automated tests.'
    );
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      app.log.info({ signal }, 'shutting down');
      void app
        .close()
        .then(() => database.close())
        .then(() => process.exit(0));
    });
  }

  app.listen({ host: config.host, port: config.port }).catch((error: unknown) => {
    app.log.error({ err: error }, 'failed to start');
    process.exit(1);
  });
}
