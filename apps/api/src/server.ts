import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from './config.ts';

export const API_VERSION = '0.1.0';
export const SERVICE_NAME = 'dragon-api';

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

interface ErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors: never[];
    correlationId: string;
    retryable: boolean;
  };
}

/** Error envelope from Requirements section 15.2. */
function errorBody(code: string, message: string, correlationId: string, retryable: boolean): ErrorBody {
  return { error: { code, message, fieldErrors: [], correlationId, retryable } };
}

export function buildServer(config: AppConfig): FastifyInstance {
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

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.id);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
    return payload;
  });

  // Liveness only: process viability, no dependency calls (Requirements section 28.4).
  // Readiness lands with the first real dependency in DRAGON-01.
  app.get('/health', async () => ({
    status: 'ok',
    service: SERVICE_NAME,
    version: API_VERSION,
    time: new Date().toISOString()
  }));

  app.get('/api/v1/meta', async () => ({
    name: SERVICE_NAME,
    version: API_VERSION,
    environment: config.env,
    locales: [...SUPPORTED_LOCALES],
    defaultLocale: DEFAULT_LOCALE
  }));

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(errorBody('RESOURCE_NOT_FOUND', 'Resource not found.', String(request.id), false));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'unhandled request error');
    // Production responses must not disclose internals (SEC-018).
    const message = status < 500 ? error.message : 'An unexpected error occurred.';
    const code = error.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
    reply.status(status).send(errorBody(code, message, String(request.id), status >= 500 || status === 429));
  });

  return app;
}

/** Entry point guard: only start listening when executed directly (pathToFileURL keeps this correct on Windows). */
const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  const config = loadConfig();
  const app = buildServer(config);

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      app.log.info({ signal }, 'shutting down');
      void app.close().then(() => process.exit(0));
    });
  }

  app.listen({ host: config.host, port: config.port }).catch((error: unknown) => {
    app.log.error({ err: error }, 'failed to start');
    process.exit(1);
  });
}
