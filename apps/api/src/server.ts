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
import { IdentityService, MockSmsAdapter, registerIdentityRoutes } from './modules/identity/index.ts';
import { AdminService, AuthorizationService, registerAdminRoutes } from './modules/admin/index.ts';
import { ContentService, registerContentRoutes } from './modules/content/index.ts';
import { GamesService, registerGamesRoutes } from './modules/games/index.ts';
import { TeamsService, registerTeamsRoutes } from './modules/teams/index.ts';
import { TournamentsService, registerTournamentsRoutes } from './modules/tournaments/index.ts';
import { RegistrationsService, registerRegistrationsRoutes } from './modules/registrations/index.ts';
import { CompetitionsService, registerCompetitionsRoutes } from './modules/competitions/index.ts';
import { seedSystemConfiguration } from './shared/db/seed.ts';
import { ANONYMOUS_ACTOR, createRequestContext, type RequestContext } from './shared/context.ts';
import { NotFoundError, toErrorBody } from './shared/errors.ts';
import { commonErrorResponses, sharedSchemas } from './http/schemas.ts';

export const API_VERSION = '0.1.0';
export const SERVICE_NAME = 'dragon-api';
export const API_PREFIX = '/api/v1';

/** Locale policy from Requirements section 17.1 (I18N-001, I18N-003). */
export const SUPPORTED_LOCALES = ['fa', 'en'] as const;
export const DEFAULT_LOCALE = 'fa';

/**
 * Baseline response headers (SEC-008). The full hardened header set, CSP, and
 * CORS allowlist are owned by DRAGON-16b; this is the foundation boundary only.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer'
};

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

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.id);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
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
            if (deps.competitions !== undefined) {
              registerCompetitionsRoutes(api, {
                identity: deps.identity.service,
                authorization: deps.admin.authorization,
                tournaments: deps.tournaments.service,
                competitions: deps.competitions.service
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

/** Wires the identity module to a live database. */
export function buildIdentity(database: Database, config: AppConfig): { service: IdentityService; db: Db } {
  const sms = new MockSmsAdapter(database.db, config.env);
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
  const app = buildServer(config, {
    database,
    identity,
    admin: buildAdmin(database),
    content: buildContent(database),
    games,
    teams,
    tournaments,
    registrations,
    competitions: buildCompetitions(database, tournaments, registrations)
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
