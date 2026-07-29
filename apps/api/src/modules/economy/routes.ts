import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { EconomyService } from './service.ts';
import { REWARD_SOURCES, type RewardSource } from './state.ts';

/**
 * Economy HTTP surface (REWARD-002..008).
 *
 * There is **no redemption, cash-out, sell-back, exchange-rate, or order-book route
 * anywhere** — DEC-024 forbids turning Dragon Coin back into money and DEC-023 defines
 * trading as a direct transfer. A guardrail test asserts that against the registered
 * paths rather than against this comment.
 */

export interface EconomyDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  economy: EconomyService;
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

const okObject = { 200: { type: 'object', additionalProperties: true }, ...errorResponses } as const;
const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };
const reasonBody = { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } };

export function registerEconomyRoutes(app: FastifyInstance, deps: EconomyDeps): void {
  const guards = createSessionGuards(deps.identity);
  const authed = () => ({ preHandler: [guards.requireSession] });
  const financeManage = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.financeManage)] });
  const financeApprove = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.financeApprove)] });
  const actor = (request: FastifyRequest): string => requireIdentity(request).account._id;

  app.get(
    '/economy/config',
    {
      schema: {
        tags: ['economy'],
        summary: 'Transfer limits and what the economy will never do: no cash redemption, no order-book trading.',
        response: { 200: { type: 'object', additionalProperties: true } }
      }
    },
    async () => deps.economy.configView()
  );

  // --- Transfers (REWARD-005) ---

  app.post(
    '/me/coin-transfers',
    {
      ...authed(),
      schema: {
        tags: ['economy'],
        summary: 'Send Dragon Coin to another player. Debit and credit commit together; the same key never sends twice.',
        body: {
          type: 'object',
          required: ['recipientUsername', 'amount', 'idempotencyKey'],
          additionalProperties: false,
          properties: {
            recipientUsername: { type: 'string', minLength: 3, maxLength: 30 },
            amount: { type: 'integer', minimum: 1 },
            note: { type: 'string', maxLength: 200 },
            idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { recipientUsername: string; amount: number; note?: string; idempotencyKey: string };
      const record = await deps.economy.transfer(request.requestContext, actor(request), body);
      reply.status(201);
      const { _id, ...rest } = record;
      return { id: _id, ...rest };
    }
  );

  app.get(
    '/me/coin-transfers',
    { ...authed(), schema: { tags: ['economy'], summary: 'Transfers the caller sent or received.', response: okObject } },
    async (request) => ({ items: (await deps.economy.listMyTransfers(actor(request))).map(({ _id, ...rest }) => ({ id: _id, ...rest })) })
  );

  // --- Transfer review (REWARD-007) ---

  app.get(
    '/admin/coin-transfers/review',
    { ...financeManage(), schema: { tags: ['economy'], summary: 'Transfers held by the manual-review threshold. No value has moved for any of them.', response: okObject } },
    async () => ({ items: (await deps.economy.listTransfersForReview()).map(({ _id, ...rest }) => ({ id: _id, ...rest })) })
  );

  app.post(
    '/admin/coin-transfers/:id/approve',
    {
      ...financeApprove(),
      schema: { tags: ['economy'], summary: 'Release a held transfer, moving the value for the first time.', params: idParam, body: reasonBody, response: okObject }
    },
    async (request) => {
      const { _id, ...rest } = await deps.economy.approveTransfer(request.requestContext, (request.params as { id: string }).id, actor(request), (request.body as { reason: string }).reason);
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/coin-transfers/:id/reject',
    {
      ...financeApprove(),
      schema: { tags: ['economy'], summary: 'Reject a held transfer. No value moved, so nothing is undone.', params: idParam, body: reasonBody, response: okObject }
    },
    async (request) => {
      const { _id, ...rest } = await deps.economy.rejectTransfer(request.requestContext, (request.params as { id: string }).id, actor(request), (request.body as { reason: string }).reason);
      return { id: _id, ...rest };
    }
  );

  // --- Reward rules and grants (REWARD-002, REWARD-003) ---

  app.get(
    '/admin/reward-rules',
    { ...financeManage(), schema: { tags: ['economy'], summary: 'Reward rules and their grant counts.', response: okObject } },
    async () => ({ items: (await deps.economy.listRules()).map(({ _id, ...rest }) => ({ id: _id, ...rest })) })
  );

  app.post(
    '/admin/reward-rules',
    {
      ...financeManage(),
      schema: {
        tags: ['economy'],
        summary: 'Define a reward rule. Every grant is traceable to a rule rather than to a number typed at the time.',
        body: {
          type: 'object',
          required: ['code', 'source', 'amount', 'description'],
          additionalProperties: false,
          properties: {
            code: { type: 'string', maxLength: 32 },
            source: { type: 'string', enum: [...REWARD_SOURCES] },
            amount: { type: 'integer', minimum: 1 },
            description: { type: 'string', minLength: 1, maxLength: 300 },
            maxGrants: { type: 'integer', minimum: 1 }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { code: string; source: RewardSource; amount: number; description: string; maxGrants?: number };
      const rule = await deps.economy.createRule(request.requestContext, actor(request), body);
      reply.status(201);
      const { _id, ...rest } = rule;
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/reward-rules/:id/grants',
    {
      // Issuance creates coin, so it takes the higher finance permission and a reason.
      ...financeApprove(),
      schema: {
        tags: ['economy'],
        summary: 'Issue a reward to an account. Once per rule per account; the audit links the actor to the ledger transaction.',
        params: idParam,
        body: { type: 'object', required: ['accountId', 'reason'], additionalProperties: false, properties: { accountId: { type: 'string' }, reason: { type: 'string', minLength: 1, maxLength: 500 } } },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { accountId: string; reason: string };
      const grant = await deps.economy.grantReward(request.requestContext, actor(request), (request.params as { id: string }).id, body.accountId, body.reason);
      reply.status(201);
      const { _id, ...rest } = grant;
      return { id: _id, ...rest };
    }
  );

  app.get(
    '/admin/reward-grants',
    { ...financeManage(), schema: { tags: ['economy'], summary: 'Issued rewards with their ledger transactions.', response: okObject } },
    async () => ({ items: (await deps.economy.listGrants()).map(({ _id, ...rest }) => ({ id: _id, ...rest })) })
  );

  app.get(
    '/admin/economy/reconciliation',
    { ...financeManage(), schema: { tags: ['economy'], summary: 'Reconciles grants and transfers against the ledger and names every difference.', response: okObject } },
    async () => deps.economy.reconcile()
  );
}
