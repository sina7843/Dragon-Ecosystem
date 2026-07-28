import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from 'mongodb';
import { NotFoundError, RateLimitError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import { consumeRateLimit } from '../identity/rate-limit.ts';
import type { HoldsService } from './service.ts';
import type { HoldsReconciliation } from './reconciliation.ts';
import type { HoldRecord } from './state.ts';

/**
 * Holds HTTP surface (DRAGON-11c). User routes are session-gated and read only the
 * caller's own holds and balance summary. Hold creation, capture, force-release,
 * expiry, and reconciliation are finance-permission operations — there is no generic
 * create/capture/transfer endpoint for arbitrary clients. No internal ledger account
 * id or business reference is exposed to ordinary users.
 */

export interface HoldsDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  holds: HoldsService;
  reconciliation: HoldsReconciliation;
  db: Db;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' },
  429: { $ref: 'ErrorResponse#' }
} as const;

const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };

/** Owner-facing hold view: no internal ledger account id, no raw business reference. */
function holdView(hold: HoldRecord) {
  return {
    id: hold._id,
    purpose: hold.purpose,
    originalAmount: hold.originalAmount,
    remainingAmount: hold.remainingAmount,
    capturedAmount: hold.capturedAmount,
    releasedAmount: hold.releasedAmount,
    state: hold.state,
    createdAt: hold.createdAt,
    expiresAt: hold.expiresAt,
    version: hold.version
  };
}

export function registerHoldsRoutes(app: FastifyInstance, deps: HoldsDeps): void {
  const guards = createSessionGuards(deps.identity);
  const authed = () => ({ preHandler: [guards.requireSession] });
  const financeManage = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.financeManage)] });
  const financeApprove = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.financeApprove)] });
  const accountId = (request: FastifyRequest): string => requireIdentity(request).account._id;

  async function limit(request: FastifyRequest, bucket: string, key: string, max: number, windowSeconds: number): Promise<void> {
    const decision = await consumeRateLimit(deps.db, `holds:${bucket}:${key}`, max, windowSeconds);
    if (!decision.allowed) throw new RateLimitError();
  }

  // --- User reads ---

  app.get('/wallet/summary', { ...authed(), schema: { tags: ['holds'], summary: 'Ledger, held, and available Dragon Coin balance.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    deps.holds.getSummary(accountId(request))
  );

  app.get('/wallet/holds', { ...authed(), schema: { tags: ['holds'], summary: 'List the caller\'s own holds.', querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.holds.listHolds(accountId(request), request.query as { cursor?: string; limit?: number });
    return { items: page.items.map(holdView), nextCursor: page.nextCursor };
  });

  app.get('/wallet/holds/:id', { ...authed(), schema: { tags: ['holds'], summary: 'Get one owned hold.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const hold = await deps.holds.getHold(accountId(request), (request.params as { id: string }).id);
    if (hold === null) throw new NotFoundError('Unknown hold.');
    return holdView(hold);
  });

  // --- Finance operations ---

  // Platform-wide hold list. The owner is included because a finance operator acting on a
  // hold has to know whose funds are reserved; the owner-scoped `/wallet/holds` above is
  // unchanged and still only ever returns the caller's own.
  app.get('/admin/holds', { ...financeManage(), schema: { tags: ['holds'], summary: 'List holds across accounts (finance).', querystring: { type: 'object', additionalProperties: false, properties: { state: { type: 'string' }, purpose: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.holds.listAllHolds(request.query as { state?: string; purpose?: string; cursor?: string; limit?: number });
    return { items: page.items.map((hold) => ({ ...holdView(hold), ownerId: hold.ownerId })), nextCursor: page.nextCursor };
  });

  app.post(
    '/admin/holds',
    {
      ...financeManage(),
      schema: {
        tags: ['holds'],
        summary: 'Create a Dragon Coin hold on a target account (finance).',
        body: { type: 'object', required: ['ownerId', 'purpose', 'amount', 'businessRef', 'idempotencyKey'], additionalProperties: false, properties: { ownerId: { type: 'string', minLength: 1, maxLength: 64 }, purpose: { type: 'string', minLength: 1, maxLength: 64 }, amount: { type: 'integer', minimum: 1 }, businessRef: { type: 'string', minLength: 8, maxLength: 200 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 }, domainRef: { type: 'string', maxLength: 200 }, ttlSeconds: { type: 'integer', minimum: 1, maximum: 2_592_000 } } },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { ownerId: string; purpose: string; amount: number; businessRef: string; idempotencyKey: string; domainRef?: string; ttlSeconds?: number };
      await limit(request, 'create', requireIdentity(request).account._id, 30, 60);
      const hold = await deps.holds.createHold(request.requestContext, body.ownerId, body);
      reply.status(201);
      return { ...holdView(hold), businessRef: hold.businessRef, domainRef: hold.domainRef };
    }
  );

  app.post(
    '/admin/holds/:id/capture',
    {
      ...financeManage(),
      schema: { tags: ['holds'], summary: 'Capture part or all of a hold into the ledger (finance).', params: idParam, body: { type: 'object', required: ['amount', 'idempotencyKey'], additionalProperties: false, properties: { amount: { type: 'integer', minimum: 1 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 }, reason: { type: 'string', maxLength: 500 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } }
    },
    async (request) => {
      await limit(request, 'capture', requireIdentity(request).account._id, 60, 60);
      const hold = await deps.holds.captureHold(request.requestContext, (request.params as { id: string }).id, request.body as { amount: number; idempotencyKey: string; reason?: string });
      return holdView(hold);
    }
  );

  app.post(
    '/admin/holds/:id/release',
    {
      ...financeApprove(),
      schema: { tags: ['holds'], summary: 'Force-release part or all of a hold (finance override).', params: idParam, body: { type: 'object', required: ['reason', 'idempotencyKey'], additionalProperties: false, properties: { amount: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 500 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } }
    },
    async (request) => {
      const hold = await deps.holds.releaseHold(request.requestContext, (request.params as { id: string }).id, request.body as { amount?: number; reason: string; idempotencyKey: string });
      return holdView(hold);
    }
  );

  app.post(
    '/admin/holds/expire',
    { ...financeManage(), schema: { tags: ['holds'], summary: 'Run a bounded batch of hold expiries (finance/operational).', body: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request) => deps.holds.expireDueHolds(request.requestContext, request.body as { limit?: number })
  );

  app.post(
    '/admin/holds/reconciliation',
    { ...financeManage(), schema: { tags: ['holds'], summary: 'Bounded read-only hold reconciliation (finance).', body: { type: 'object', required: ['ledgerAccountIds'], additionalProperties: false, properties: { ledgerAccountIds: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 64 } } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request) => deps.reconciliation.report((request.body as { ledgerAccountIds: string[] }).ledgerAccountIds)
  );
}
