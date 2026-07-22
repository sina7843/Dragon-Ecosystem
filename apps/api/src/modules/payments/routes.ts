import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from 'mongodb';
import { NotFoundError, RateLimitError, ValidationError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import { consumeRateLimit } from '../identity/rate-limit.ts';
import type { PaymentsService } from './service.ts';
import type { PurchaseRecord } from './state.ts';
import type { ProviderEventType, RawCallback } from './provider.ts';

/**
 * Payment HTTP surface (DRAGON-11b). User routes are session-gated and act only on
 * the caller's own account (identity from the session, never a request field). The
 * provider callback route treats its body as untrusted input and uses no browser
 * session as authority. The mock pay control exists only when the mock provider is
 * enabled (never in production). Correction requires an explicit finance permission.
 */

export interface PaymentsDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  payments: PaymentsService;
  db: Db;
  mockEnabled: boolean;
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

/** Owner-facing purchase view: no internal ledger, provider-reference, or correlation detail. */
function purchaseView(purchase: PurchaseRecord) {
  return {
    id: purchase._id,
    packageCode: purchase.packageCode,
    dragonCoin: purchase.dragonCoin,
    rialAmount: purchase.rialAmount,
    tomanAmount: Math.trunc(purchase.rialAmount / 10),
    state: purchase.state,
    callbackVerification: purchase.callbackVerification,
    createdAt: purchase.createdAt,
    expiresAt: purchase.expiresAt,
    completedAt: purchase.completedAt,
    version: purchase.version
  };
}

export function registerPaymentsRoutes(app: FastifyInstance, deps: PaymentsDeps): void {
  const guards = createSessionGuards(deps.identity);
  const authed = () => ({ preHandler: [guards.requireSession] });
  const financeGate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.financeApprove)] });
  const accountId = (request: FastifyRequest): string => requireIdentity(request).account._id;

  async function limit(request: FastifyRequest, bucket: string, key: string, max: number, windowSeconds: number): Promise<void> {
    const decision = await consumeRateLimit(deps.db, `payments:${bucket}:${key}`, max, windowSeconds);
    if (!decision.allowed) throw new RateLimitError();
  }

  // --- User routes ---

  app.get('/payments/packages', { ...authed(), schema: { tags: ['payments'], summary: 'List available Dragon Coin purchase packages.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async () => ({
    packages: deps.payments.listPackages().map((pkg) => ({ ...pkg, tomanAmount: Math.trunc(pkg.rialAmount / 10) }))
  }));

  app.get('/payments/balance', { ...authed(), schema: { tags: ['payments'], summary: 'Current Dragon Coin balance.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    deps.payments.getDragonCoinBalance(accountId(request))
  );

  app.post(
    '/payments/purchases',
    {
      ...authed(),
      schema: {
        tags: ['payments'],
        summary: 'Create a Dragon Coin purchase for the authenticated account.',
        body: { type: 'object', required: ['packageCode', 'idempotencyKey'], additionalProperties: false, properties: { packageCode: { type: 'string', minLength: 1, maxLength: 64 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 } } },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const id = accountId(request);
      await limit(request, 'create', id, 10, 60);
      const purchase = await deps.payments.createPurchase(request.requestContext, id, request.body as { packageCode: string; idempotencyKey: string });
      reply.status(201);
      return purchaseView(purchase);
    }
  );

  app.get('/payments/purchases', { ...authed(), schema: { tags: ['payments'], summary: 'List the authenticated account\'s purchase history.', querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.payments.listPurchases(accountId(request), request.query as { cursor?: string; limit?: number });
    return { items: page.items.map(purchaseView), nextCursor: page.nextCursor };
  });

  app.get('/payments/purchases/:id', { ...authed(), schema: { tags: ['payments'], summary: 'Get one owned purchase.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const purchase = await deps.payments.getPurchase(accountId(request), (request.params as { id: string }).id);
    if (purchase === null) throw new NotFoundError('Unknown purchase.');
    return purchaseView(purchase);
  });

  // --- Provider callback (untrusted input, no session authority) ---

  app.post(
    '/payments/provider/callback',
    {
      schema: {
        tags: ['payments'],
        summary: 'Receive a provider payment callback.',
        body: {
          type: 'object',
          required: ['provider', 'providerRequestId', 'purchaseId', 'rialAmount', 'asset', 'eventType', 'eventId', 'signature'],
          additionalProperties: false,
          properties: {
            provider: { type: 'string', minLength: 1, maxLength: 64 },
            providerRequestId: { type: 'string', minLength: 1, maxLength: 200 },
            purchaseId: { type: 'string', minLength: 1, maxLength: 64 },
            rialAmount: { type: 'integer', minimum: 0 },
            asset: { type: 'string', minLength: 1, maxLength: 16 },
            eventType: { type: 'string', minLength: 1, maxLength: 32 },
            eventId: { type: 'string', minLength: 1, maxLength: 200 },
            signature: { type: 'string', minLength: 1, maxLength: 512 }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      await limit(request, 'callback', request.ip, 120, 60);
      const verified = deps.payments.provider.verifyCallback(request.body as RawCallback);
      await deps.payments.handleVerifiedCallback(verified);
      // Generic provider-facing acknowledgement; no internal account or ledger detail.
      return { status: 'received' };
    }
  );

  // --- Mock pay control: simulates the provider calling back. Non-production only. ---

  if (deps.mockEnabled) {
    app.post(
      '/payments/mock/pay',
      {
        ...authed(),
        schema: {
          tags: ['payments'],
          summary: 'Simulate a provider payment outcome for an owned purchase (mock only).',
          body: { type: 'object', required: ['purchaseId', 'outcome'], additionalProperties: false, properties: { purchaseId: { type: 'string', minLength: 1, maxLength: 64 }, outcome: { type: 'string', enum: ['success', 'failed', 'cancelled'] }, eventId: { type: 'string', minLength: 1, maxLength: 200 } } },
          response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
        }
      },
      async (request) => {
        const id = accountId(request);
        await limit(request, 'mockpay', id, 30, 60);
        const body = request.body as { purchaseId: string; outcome: ProviderEventType; eventId?: string };
        const purchase = await deps.payments.getPurchase(id, body.purchaseId);
        if (purchase === null) throw new NotFoundError('Unknown purchase.');
        const provider = deps.payments.provider as unknown as { name: string; sign?: (fields: Omit<RawCallback, 'signature'>) => string };
        if (typeof provider.sign !== 'function') throw new ValidationError('The mock provider is not available.', [{ field: 'provider', code: 'MOCK_PROVIDER_DISABLED', message: 'Mock provider disabled.' }]);
        const fields: Omit<RawCallback, 'signature'> = { provider: purchase.provider, providerRequestId: purchase.providerRequestId, purchaseId: purchase._id, rialAmount: purchase.rialAmount, asset: 'IRR', eventType: body.outcome, eventId: body.eventId ?? `mockevt_${purchase._id}_${body.outcome}` };
        const raw: RawCallback = { ...fields, signature: provider.sign(fields) as string };
        const verified = deps.payments.provider.verifyCallback(raw);
        const result = await deps.payments.handleVerifiedCallback(verified);
        return purchaseView(result);
      }
    );
  }

  // --- Finance correction ---

  app.post(
    '/payments/admin/purchases/:id/correct',
    {
      ...financeGate(),
      schema: {
        tags: ['payments'],
        summary: 'Reverse a successful purchase with a compensating ledger transaction (finance).',
        params: idParam,
        body: { type: 'object', required: ['expectedVersion', 'reason', 'correctionRef'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 500 }, correctionRef: { type: 'string', minLength: 8, maxLength: 200 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const purchase = await deps.payments.correctPurchase(request.requestContext, (request.params as { id: string }).id, request.body as { expectedVersion: number; reason: string; correctionRef: string });
      return purchaseView(purchase);
    }
  );
}
