import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import { loadConfig, type AppConfig } from './config.ts';
import { Database } from './shared/db/client.ts';
import { migrations } from './shared/db/migrations/001-foundation.ts';
import { runMigrations } from './shared/db/migrations.ts';
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

/** Minimum surface the server needs from the data layer, so tests can supply a stub. */
export interface HealthCheckable {
  ping(): Promise<boolean>;
}

export interface ServerDependencies {
  readonly database: HealthCheckable;
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
  const applied = await runMigrations(database.db, migrations);
  await seedSystemConfiguration(database.db);
  return applied;
}

/** Entry point guard: only start listening when executed directly (pathToFileURL keeps this correct on Windows). */
const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  const config = loadConfig();
  const database = await Database.connect(config.mongoUri);
  await prepareDatabase(database);

  const app = buildServer(config, { database });

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
