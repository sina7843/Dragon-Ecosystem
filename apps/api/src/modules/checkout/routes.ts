import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from 'mongodb';
import { NotFoundError, RateLimitError, ValidationError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import { consumeRateLimit } from '../identity/rate-limit.ts';
import type { RawCallback, ProviderEventType } from '../payments/index.ts';
import type { CheckoutService } from './service.ts';
import type { CheckoutRecord } from './state.ts';

/**
 * Paid checkout HTTP surface (DRAGON-12). User routes are session-gated and act on
 * the caller's own account. The provider callback treats its body as untrusted input
 * and uses no session; the mock pay control is fail-closed (non-production only).
 * Expiry is a finance/operational route.
 */

export interface CheckoutDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  checkout: CheckoutService;
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

/** Owner-facing checkout view: no internal ledger, registration, or business-reference detail. */
function checkoutView(checkout: CheckoutRecord) {
  return {
    id: checkout._id,
    tournamentId: checkout.tournamentId,
    irrAmount: checkout.irrAmount,
    tomanAmount: Math.trunc(checkout.irrAmount / 10),
    drcAmount: checkout.drcAmount,
    state: checkout.state,
    createdAt: checkout.createdAt,
    expiresAt: checkout.expiresAt,
    completedAt: checkout.completedAt,
    version: checkout.version
  };
}

export function registerCheckoutRoutes(app: FastifyInstance, deps: CheckoutDeps): void {
  const guards = createSessionGuards(deps.identity);
  const authed = () => ({ preHandler: [guards.requireSession] });
  const financeManage = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.financeManage)] });
  const accountId = (request: FastifyRequest): string => requireIdentity(request).account._id;

  async function limit(request: FastifyRequest, bucket: string, key: string, max: number, windowSeconds: number): Promise<void> {
    if (!(await consumeRateLimit(deps.db, `checkout:${bucket}:${key}`, max, windowSeconds)).allowed) throw new RateLimitError();
  }

  app.post(
    '/tournaments/:id/checkout',
    {
      ...authed(),
      schema: { tags: ['checkout'], summary: 'Start a paid registration checkout.', params: idParam, body: { type: 'object', required: ['idempotencyKey'], additionalProperties: false, properties: { idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 }, teamId: { type: 'string', minLength: 1, maxLength: 64 }, answers: { type: 'array', items: { type: 'object', required: ['key', 'value'], additionalProperties: false, properties: { key: { type: 'string' }, value: { type: 'string' } } } } } }, response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses } }
    },
    async (request, reply) => {
      const id = accountId(request);
      await limit(request, 'start', id, 10, 60);
      const checkout = await deps.checkout.startCheckout(request.requestContext, id, (request.params as { id: string }).id, request.body as { idempotencyKey: string; teamId?: string; answers?: Array<{ key: string; value: string }> });
      reply.status(201);
      return checkoutView(checkout);
    }
  );

  app.get('/checkouts', { ...authed(), schema: { tags: ['checkout'], summary: 'List the caller\'s checkouts.', querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.checkout.listCheckouts(accountId(request), request.query as { cursor?: string; limit?: number });
    return { items: page.items.map(checkoutView), nextCursor: page.nextCursor };
  });

  app.get('/checkouts/:id', { ...authed(), schema: { tags: ['checkout'], summary: 'Get one owned checkout.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const checkout = await deps.checkout.getCheckout(accountId(request), (request.params as { id: string }).id);
    if (checkout === null) throw new NotFoundError('Unknown checkout.');
    return checkoutView(checkout);
  });

  app.post('/checkouts/:id/confirm', { ...authed(), schema: { tags: ['checkout'], summary: 'Confirm a Dragon-Coin-only checkout.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const id = accountId(request);
    await limit(request, 'confirm', id, 20, 60);
    return checkoutView(await deps.checkout.confirmDragonCoin(request.requestContext, id, (request.params as { id: string }).id));
  });

  app.post('/checkouts/:id/cancel', { ...authed(), schema: { tags: ['checkout'], summary: 'Cancel a pending checkout.', params: idParam, body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    checkoutView(await deps.checkout.cancelCheckout(request.requestContext, accountId(request), (request.params as { id: string }).id, (request.body as { reason: string }).reason))
  );

  // --- Provider callback (untrusted, no session authority) ---
  app.post(
    '/checkout/provider/callback',
    {
      schema: {
        tags: ['checkout'],
        summary: 'Receive a provider payment callback for a tournament fee.',
        body: { type: 'object', required: ['provider', 'providerRequestId', 'purchaseId', 'rialAmount', 'asset', 'eventType', 'eventId', 'signature'], additionalProperties: false, properties: { provider: { type: 'string', minLength: 1, maxLength: 64 }, providerRequestId: { type: 'string', minLength: 1, maxLength: 200 }, purchaseId: { type: 'string', minLength: 1, maxLength: 64 }, rialAmount: { type: 'integer', minimum: 0 }, asset: { type: 'string', minLength: 1, maxLength: 16 }, eventType: { type: 'string', minLength: 1, maxLength: 32 }, eventId: { type: 'string', minLength: 1, maxLength: 200 }, signature: { type: 'string', minLength: 1, maxLength: 512 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      await limit(request, 'callback', request.ip, 120, 60);
      await deps.checkout.handleFeeCallback(request.body as RawCallback);
      return { status: 'received' };
    }
  );

  // --- Mock pay control (non-production only) ---
  if (deps.mockEnabled) {
    app.post(
      '/checkout/mock/pay',
      { ...authed(), schema: { tags: ['checkout'], summary: 'Simulate a fee payment outcome for an owned checkout (mock only).', body: { type: 'object', required: ['checkoutId', 'outcome'], additionalProperties: false, properties: { checkoutId: { type: 'string', minLength: 1, maxLength: 64 }, outcome: { type: 'string', enum: ['success', 'failed', 'cancelled'] }, eventId: { type: 'string', minLength: 1, maxLength: 200 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
      async (request) => {
        const id = accountId(request);
        const body = request.body as { checkoutId: string; outcome: ProviderEventType; eventId?: string };
        const checkout = await deps.checkout.getCheckout(id, body.checkoutId);
        if (checkout === null) throw new NotFoundError('Unknown checkout.');
        if (checkout.providerRequestId === null) throw new ValidationError('This checkout has no Toman payment.', [{ field: 'checkout', code: 'PAYMENT_REQUIRED', message: 'No Toman payment to simulate.' }]);
        const provider = deps.checkout.provider as unknown as { name: string; sign?: (fields: Omit<RawCallback, 'signature'>) => string };
        if (typeof provider.sign !== 'function') throw new ValidationError('The mock provider is not available.', [{ field: 'provider', code: 'MOCK_PROVIDER_DISABLED', message: 'Mock provider disabled.' }]);
        const fields: Omit<RawCallback, 'signature'> = { provider: checkout.provider, providerRequestId: checkout.providerRequestId, purchaseId: checkout._id, rialAmount: checkout.irrAmount, asset: 'IRR', eventType: body.outcome, eventId: body.eventId ?? `checkoutevt_${checkout._id}_${body.outcome}` };
        const raw: RawCallback = { ...fields, signature: provider.sign(fields) as string };
        return checkoutView(await deps.checkout.handleFeeCallback(raw));
      }
    );
  }

  // --- Finance/operational expiry ---
  app.post('/admin/checkouts/expire', { ...financeManage(), schema: { tags: ['checkout'], summary: 'Run a bounded batch of checkout expiries (finance/operational).', body: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    deps.checkout.expireDueCheckouts(request.requestContext, request.body as { limit?: number })
  );
}
