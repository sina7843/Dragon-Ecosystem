import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { ModerationService } from './service.ts';
import type { ModerationCaseRecord, SupportCaseRecord } from './state.ts';

/**
 * Moderation, support, and recovery HTTP surface (DRAGON-14). Report intake and
 * support-case creation are session-gated participant routes; case handling is gated
 * on `moderation.manage`; support and recovery review on `support.manage`. Recovery
 * output masks the account and offers no approval action (OD-029).
 */

export interface ModerationDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  moderation: ModerationService;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' }, 401: { $ref: 'ErrorResponse#' }, 403: { $ref: 'ErrorResponse#' }, 404: { $ref: 'ErrorResponse#' }, 409: { $ref: 'ErrorResponse#' }, 422: { $ref: 'ErrorResponse#' }, 429: { $ref: 'ErrorResponse#' }
} as const;
const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };

function caseView(c: ModerationCaseRecord) {
  return { id: c._id, subjectType: c.subjectType, subjectId: c.subjectId, severity: c.severity, state: c.state, assignedTo: c.assignedTo, action: c.action, actionReason: c.actionReason, emergency: c.emergency, reportCount: c.reportCount, createdAt: c.createdAt, version: c.version };
}
function supportView(c: SupportCaseRecord) {
  return { id: c._id, category: c.category, subject: c.subject, state: c.state, assignedTo: c.assignedTo, resolutionNote: c.resolutionNote, createdAt: c.createdAt, version: c.version };
}

export function registerModerationRoutes(app: FastifyInstance, deps: ModerationDeps): void {
  const guards = createSessionGuards(deps.identity);
  const authed = () => ({ preHandler: [guards.requireSession] });
  const modGate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.moderationManage)] });
  const supGate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.supportManage)] });
  const actorId = (request: FastifyRequest): string => requireIdentity(request).account._id;

  // --- Participant intake ---
  app.post('/reports', { ...authed(), schema: { tags: ['moderation'], summary: 'File a moderation report.', body: { type: 'object', required: ['subjectType', 'subjectId', 'reason'], additionalProperties: false, properties: { subjectType: { type: 'string', enum: ['user', 'content', 'tournament'] }, subjectId: { type: 'string', minLength: 1, maxLength: 64 }, reason: { type: 'string', minLength: 1, maxLength: 200 }, details: { type: 'string', maxLength: 2000 } } }, response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request, reply) => {
    const report = await deps.moderation.fileReport(request.requestContext, actorId(request), request.body as { subjectType: 'user' | 'content' | 'tournament'; subjectId: string; reason: string; details?: string });
    reply.status(201);
    return { id: report._id, status: report.status, createdAt: report.createdAt };
  });

  app.post('/support/cases', { ...authed(), schema: { tags: ['moderation'], summary: 'Open a support case.', body: { type: 'object', required: ['category', 'subject', 'body'], additionalProperties: false, properties: { category: { type: 'string', minLength: 1, maxLength: 64 }, subject: { type: 'string', minLength: 1, maxLength: 200 }, body: { type: 'string', minLength: 1, maxLength: 4000 } } }, response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request, reply) => {
    const record = await deps.moderation.openSupportCase(request.requestContext, actorId(request), request.body as { category: string; subject: string; body: string });
    reply.status(201);
    return supportView(record);
  });

  app.get('/support/cases', { ...authed(), schema: { tags: ['moderation'], summary: 'List the caller\'s support cases.', querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.moderation.listMySupport(actorId(request), request.query as { cursor?: string; limit?: number });
    return { items: page.items.map(supportView), nextCursor: page.nextCursor };
  });

  app.get('/support/cases/:id', { ...authed(), schema: { tags: ['moderation'], summary: 'Get one owned support case.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const record = await deps.moderation.getSupportCase(actorId(request), (request.params as { id: string }).id);
    if (record === null) throw new NotFoundError('Unknown support case.');
    return supportView(record);
  });

  // --- Moderation (moderation.manage) ---
  /**
   * Adds display names for the accounts a page of cases references.
   *
   * A moderator was reading `user:192be49a-…` for the subject and a bare UUID for the
   * assignee, which is unusable and puts more join-keys than necessary into every
   * screenshot. Only `user` subjects resolve — a content or tournament subject is not an
   * account — and resolution is one batched query for the whole page. The raw ids stay in
   * the payload because the client still needs them to link and to filter.
   */
  async function withAccountNames<T extends { subjectType?: string; subjectId?: string; assignedTo?: string | null }>(
    cases: readonly T[]
  ): Promise<Array<T & { subjectName: { username: string; displayName: string } | null; assigneeName: { username: string; displayName: string } | null }>> {
    const ids = new Set<string>();
    for (const c of cases) {
      if (c.subjectType === 'user' && typeof c.subjectId === 'string') ids.add(c.subjectId);
      if (typeof c.assignedTo === 'string' && c.assignedTo !== '') ids.add(c.assignedTo);
    }
    const names = await deps.identity.getIdentitySummaries([...ids]);
    return cases.map((c) => ({
      ...c,
      subjectName: c.subjectType === 'user' && typeof c.subjectId === 'string' ? names.get(c.subjectId) ?? null : null,
      assigneeName: typeof c.assignedTo === 'string' ? names.get(c.assignedTo) ?? null : null
    }));
  }

  app.get('/admin/moderation/cases', { ...modGate(), schema: { tags: ['moderation'], summary: 'Search moderation cases.', querystring: { type: 'object', additionalProperties: false, properties: { state: { type: 'string' }, severity: { type: 'string' }, subjectType: { type: 'string' }, subjectId: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.moderation.listCases(request.query as { state?: string; severity?: string; subjectType?: string; subjectId?: string; cursor?: string; limit?: number });
    return { items: await withAccountNames(page.items.map(caseView)), nextCursor: page.nextCursor };
  });

  app.get('/admin/moderation/cases/:id', { ...modGate(), schema: { tags: ['moderation'], summary: 'Get a moderation case with its reports.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const id = (request.params as { id: string }).id;
    const record = await deps.moderation.getCase(id);
    if (record === null) throw new NotFoundError('Unknown case.');
    const reports = await deps.moderation.listCaseReports(id);
    return { case: caseView(record), reports: reports.map((r) => ({ id: r._id, reason: r.reason, details: r.details, createdAt: r.createdAt })) };
  });

  app.post('/admin/moderation/cases/:id/assign', { ...modGate(), schema: { tags: ['moderation'], summary: 'Assign a case.', params: idParam, body: { type: 'object', required: ['expectedVersion'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, assignee: { type: 'string', minLength: 1, maxLength: 64 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const body = request.body as { expectedVersion: number; assignee?: string };
    return caseView(await deps.moderation.assignCase(request.requestContext, (request.params as { id: string }).id, body.assignee ?? actorId(request), body.expectedVersion));
  });

  app.post('/admin/moderation/cases/:id/severity', { ...modGate(), schema: { tags: ['moderation'], summary: 'Set case severity.', params: idParam, body: { type: 'object', required: ['expectedVersion', 'severity'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const body = request.body as { expectedVersion: number; severity: 'low' | 'medium' | 'high' | 'critical' };
    return caseView(await deps.moderation.setSeverity(request.requestContext, (request.params as { id: string }).id, body.severity, body.expectedVersion));
  });

  app.post('/admin/moderation/cases/:id/emergency', { ...modGate(), schema: { tags: ['moderation'], summary: 'Flag a case for emergency review.', params: idParam, body: { type: 'object', required: ['expectedVersion', 'emergency'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, emergency: { type: 'boolean' } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const body = request.body as { expectedVersion: number; emergency: boolean };
    return caseView(await deps.moderation.setEmergency(request.requestContext, (request.params as { id: string }).id, body.emergency, body.expectedVersion));
  });

  app.post('/admin/moderation/cases/:id/act', { ...modGate(), schema: { tags: ['moderation'], summary: 'Act on a case (suspend/remove/dismiss).', params: idParam, body: { type: 'object', required: ['expectedVersion', 'action', 'reason'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, action: { type: 'string', enum: ['suspend', 'remove', 'dismiss'] }, reason: { type: 'string', minLength: 1, maxLength: 500 }, emergency: { type: 'boolean' } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const body = request.body as { expectedVersion: number; action: 'suspend' | 'remove' | 'dismiss'; reason: string; emergency?: boolean };
    return caseView(await deps.moderation.actOnCase(request.requestContext, (request.params as { id: string }).id, { action: body.action, reason: body.reason, ...(body.emergency === undefined ? {} : { emergency: body.emergency }) }, body.expectedVersion));
  });

  // --- Support + recovery (support.manage) ---
  app.get('/admin/support/cases', { ...supGate(), schema: { tags: ['moderation'], summary: 'List support cases (operator).', querystring: { type: 'object', additionalProperties: false, properties: { state: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.moderation.listSupport(request.query as { state?: string; cursor?: string; limit?: number });
    return { items: page.items.map((c) => ({ ...supportView(c), requesterId: c.requesterId, body: c.body })), nextCursor: page.nextCursor };
  });

  for (const to of ['assigned', 'resolved', 'closed'] as const) {
    app.post(`/admin/support/cases/:id/${to === 'assigned' ? 'assign' : to === 'resolved' ? 'resolve' : 'close'}`, { ...supGate(), schema: { tags: ['moderation'], summary: `Move a support case to ${to}.`, params: idParam, body: { type: 'object', required: ['expectedVersion'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, assignee: { type: 'string', maxLength: 64 }, note: { type: 'string', maxLength: 2000 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
      const body = request.body as { expectedVersion: number; assignee?: string; note?: string };
      return supportView(await deps.moderation.transitionSupport(request.requestContext, (request.params as { id: string }).id, to, { expectedVersion: body.expectedVersion, ...(body.assignee === undefined ? {} : { assignee: body.assignee }), ...(body.note === undefined ? {} : { note: body.note }) }));
    });
  }

  app.post('/admin/recovery', { ...supGate(), schema: { tags: ['moderation'], summary: 'Record an account-recovery request for review.', body: { type: 'object', required: ['accountId', 'reason'], additionalProperties: false, properties: { accountId: { type: 'string', minLength: 1, maxLength: 64 }, reason: { type: 'string', minLength: 1, maxLength: 2000 } } }, response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request, reply) => {
    const record = await deps.moderation.createRecovery(request.requestContext, request.body as { accountId: string; reason: string });
    reply.status(201);
    return { id: record._id, state: record.state, createdAt: record.createdAt };
  });

  app.get('/admin/recovery', { ...supGate(), schema: { tags: ['moderation'], summary: 'List recovery requests (masked accounts).', querystring: { type: 'object', additionalProperties: false, properties: { state: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.moderation.listRecovery(request.query as { state?: string; cursor?: string; limit?: number });
    return { items: page.items, nextCursor: page.nextCursor };
  });

  app.post('/admin/recovery/:id/review', { ...supGate(), schema: { tags: ['moderation'], summary: 'Triage a recovery request (reviewed/rejected; approval is disabled).', params: idParam, body: { type: 'object', required: ['expectedVersion', 'decision', 'note'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, decision: { type: 'string' }, note: { type: 'string', minLength: 1, maxLength: 2000 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const body = request.body as { expectedVersion: number; decision: string; note: string };
    const record = await deps.moderation.reviewRecovery(request.requestContext, (request.params as { id: string }).id, body);
    return { id: record._id, state: record.state, reviewNote: record.reviewNote, version: record.version };
  });
}
