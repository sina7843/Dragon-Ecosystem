import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { StuckReservationDetector } from './recovery.ts';
import type { OperationsService } from './service.ts';
import type { AlertRecord, JobExecutionRecord } from './state.ts';

/**
 * Operations HTTP surface (DRAGON-14). A participant may emit a consent-aware
 * analytics event about their own session; operator routes (run jobs, health check,
 * metrics, alerts, job history) require the support/operator permission. No route
 * exposes raw account ids or secrets.
 */

export interface OperationsDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  operations: OperationsService;
  /** Absent in compositions that do not wire hold-backed modules. */
  recovery?: StuckReservationDetector;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' }, 401: { $ref: 'ErrorResponse#' }, 403: { $ref: 'ErrorResponse#' }, 404: { $ref: 'ErrorResponse#' }, 409: { $ref: 'ErrorResponse#' }, 422: { $ref: 'ErrorResponse#' }
} as const;
const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };

function alertView(a: AlertRecord) {
  return { id: a._id, category: a.category, severity: a.severity, message: a.message, detail: a.detail, status: a.status, createdAt: a.createdAt };
}
function jobView(j: JobExecutionRecord) {
  return { id: j._id, jobName: j.jobName, status: j.status, startedAt: j.startedAt, finishedAt: j.finishedAt, result: j.result, error: j.error };
}

export function registerOperationsRoutes(app: FastifyInstance, deps: OperationsDeps): void {
  const guards = createSessionGuards(deps.identity);
  const authed = () => ({ preHandler: [guards.requireSession] });
  const opsGate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.supportManage)] });
  const accountId = (request: FastifyRequest): string => requireIdentity(request).account._id;

  // --- Participant consent-aware analytics event ---
  app.post('/analytics/events', { ...authed(), schema: { tags: ['operations'], summary: 'Record a consent-aware analytics event for the caller.', body: { type: 'object', required: ['name', 'consented'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 64 }, consented: { type: 'boolean' }, props: { type: 'object', additionalProperties: true } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const body = request.body as { name: string; consented: boolean; props?: Record<string, unknown> };
    // Client-emitted events are always nonessential and require consent; the account is pseudonymized.
    return deps.operations.track(request.requestContext, { name: body.name, essential: false, accountId: accountId(request), consented: body.consented, ...(body.props === undefined ? {} : { props: body.props }) });
  });

  // --- Operator ---
  app.post('/admin/ops/run-jobs', { ...opsGate(), schema: { tags: ['operations'], summary: 'Run a bounded pass of operational jobs.', body: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const limit = (request.body as { limit?: number } | undefined)?.limit;
    return { jobs: await deps.operations.runJobs(request.requestContext, limit === undefined ? {} : { limit }) };
  });

  app.post('/admin/ops/health-check', { ...opsGate(), schema: { tags: ['operations'], summary: 'Inspect failure signals and raise alerts.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    deps.operations.checkHealth(request.requestContext)
  );

  app.get('/admin/ops/metrics', { ...opsGate(), schema: { tags: ['operations'], summary: 'Operational metrics snapshot.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async () =>
    deps.operations.metrics()
  );

  app.get('/admin/ops/alerts', { ...opsGate(), schema: { tags: ['operations'], summary: 'List alerts.', querystring: { type: 'object', additionalProperties: false, properties: { status: { type: 'string' }, category: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.operations.listAlerts(request.query as { status?: string; category?: string; cursor?: string; limit?: number });
    return { items: page.items.map(alertView), nextCursor: page.nextCursor };
  });

  app.post('/admin/ops/alerts/:id/acknowledge', { ...opsGate(), schema: { tags: ['operations'], summary: 'Acknowledge an alert.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    alertView(await deps.operations.acknowledgeAlert(request.requestContext, (request.params as { id: string }).id))
  );

  // Read-only by design: it reports what is stuck and changes nothing. There is
  // deliberately no companion repair endpoint — several remedies depend on policy that is
  // not approved (DEC-034 approves no return workflow), and a repair route that can touch
  // money is the one most likely to be aimed at the wrong record.
  app.get('/admin/ops/stuck-reservations', { ...opsGate(), schema: { tags: ['operations'], summary: 'Inspect hold-backed records that can no longer complete. Read-only; repairs nothing.', querystring: { type: 'object', additionalProperties: false, properties: { staleAfterSeconds: { type: 'integer', minimum: 60, maximum: 604800 }, limit: { type: 'integer', minimum: 1, maximum: 1000 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    if (deps.recovery === undefined) return { staleAfterSeconds: 0, inspectedWorkflows: [], findings: [] };
    return deps.recovery.inspect(request.query as { staleAfterSeconds?: number; limit?: number });
  });

  app.get('/admin/ops/jobs', { ...opsGate(), schema: { tags: ['operations'], summary: 'List recent job executions.', querystring: { type: 'object', additionalProperties: false, properties: { jobName: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    ({ jobs: (await deps.operations.listJobExecutions(request.query as { jobName?: string; limit?: number })).map(jobView) })
  );
}
