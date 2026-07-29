import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { PrizesService } from './service.ts';
import type { PrizeEntitlementRecord } from './state.ts';

/**
 * Prize HTTP surface (DRAGON-12). Participants read their own cash entitlements.
 * Prize allocation and entitlement settlement require finance permission; paying a
 * cash entitlement (recording an off-platform settlement) requires the higher
 * finance-approve permission. No internal ledger detail is exposed to participants.
 */

export interface PrizesDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  prizes: PrizesService;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' }
} as const;

const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };

/** Participant-facing entitlement view: no ledger, approver, or internal ids. */
function ownerView(entitlement: PrizeEntitlementRecord) {
  return { id: entitlement._id, tournamentId: entitlement.tournamentId, rank: entitlement.rank, amount: entitlement.amount, tomanAmount: Math.trunc(entitlement.amount / 10), state: entitlement.state, createdAt: entitlement.createdAt };
}
/** Finance view includes settlement fields. */
function financeView(entitlement: PrizeEntitlementRecord) {
  return { ...ownerView(entitlement), accountId: entitlement.accountId, allocationVersion: entitlement.allocationVersion, reason: entitlement.reason, settlementEvidence: entitlement.settlementEvidence, approvedBy: entitlement.approvedBy, paidBy: entitlement.paidBy, recipientVerifiedBy: entitlement.recipientVerifiedBy ?? null, recipientVerifiedAt: entitlement.recipientVerifiedAt ?? null, retryCount: entitlement.retryCount ?? 0, reversedBy: entitlement.reversedBy ?? null, reversalReason: entitlement.reversalReason ?? null, version: entitlement.version };
}

export function registerPrizesRoutes(app: FastifyInstance, deps: PrizesDeps): void {
  const guards = createSessionGuards(deps.identity);
  const authed = () => ({ preHandler: [guards.requireSession] });
  const financeManage = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.financeManage)] });
  const financeApprove = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.financeApprove)] });
  const accountId = (request: FastifyRequest): string => requireIdentity(request).account._id;

  // --- Participant reads ---
  app.get('/wallet/entitlements', { ...authed(), schema: { tags: ['prizes'], summary: 'List the caller\'s prize entitlements.', querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.prizes.listAccountEntitlements(accountId(request), request.query as { cursor?: string; limit?: number });
    return { items: page.items.map(ownerView), nextCursor: page.nextCursor };
  });

  // --- Finance: allocation + entitlement settlement ---
  app.post('/admin/tournaments/:id/prizes/allocate', { ...financeManage(), schema: { tags: ['prizes'], summary: 'Allocate prizes from final standings (versioned, idempotent).', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    deps.prizes.allocate(request.requestContext, (request.params as { id: string }).id)
  );

  // The finance queue: everything awaiting a decision, regardless of tournament.
  app.get('/admin/entitlements', { ...financeManage(), schema: { tags: ['prizes'], summary: 'List cash entitlements across tournaments (finance).', querystring: { type: 'object', additionalProperties: false, properties: { state: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.prizes.listEntitlements(request.query as { state?: string; cursor?: string; limit?: number });
    return { items: page.items.map(financeView), nextCursor: page.nextCursor };
  });

  app.get('/admin/tournaments/:id/entitlements', { ...financeManage(), schema: { tags: ['prizes'], summary: 'List a tournament\'s cash entitlements (finance).', params: idParam, querystring: { type: 'object', additionalProperties: false, properties: { state: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.prizes.listTournamentEntitlements((request.params as { id: string }).id, request.query as { state?: string; cursor?: string; limit?: number });
    return { items: page.items.map(financeView), nextCursor: page.nextCursor };
  });

  app.post('/admin/entitlements/:id/approve', { ...financeManage(), schema: { tags: ['prizes'], summary: 'Approve a pending cash entitlement (finance).', params: idParam, body: { type: 'object', required: ['expectedVersion', 'reason'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 500 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    financeView(await deps.prizes.approveEntitlement(request.requestContext, (request.params as { id: string }).id, request.body as { expectedVersion: number; reason: string }))
  );

  app.post('/admin/entitlements/:id/pay', { ...financeApprove(), schema: { tags: ['prizes'], summary: 'Mark a cash entitlement paid with settlement evidence (finance approve).', params: idParam, body: { type: 'object', required: ['expectedVersion', 'reason', 'settlementEvidence'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 500 }, settlementEvidence: { type: 'string', minLength: 1, maxLength: 1000 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    financeView(await deps.prizes.payEntitlement(request.requestContext, (request.params as { id: string }).id, request.body as { expectedVersion: number; reason: string; settlementEvidence: string }))
  );

  const versionedBody = (extra: Record<string, unknown> = {}, required: string[] = []) => ({
    type: 'object',
    required: ['expectedVersion', 'reason', ...required],
    additionalProperties: false,
    properties: { expectedVersion: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 500 }, ...extra }
  });
  const okObject = { 200: { type: 'object', additionalProperties: true }, ...errorResponses } as const;

  // Recipient verification is deliberately its own step: PAYOUT-011 requires the check to
  // be complete before settlement, and folding it into approval would make one judgement
  // stand for two.
  app.post('/admin/entitlements/:id/verify-recipient', { ...financeManage(), schema: { tags: ['prizes'], summary: 'Record that the payout recipient was verified (finance).', params: idParam, body: versionedBody(), response: okObject } }, async (request) =>
    financeView(await deps.prizes.verifyRecipient(request.requestContext, (request.params as { id: string }).id, request.body as { expectedVersion: number; reason: string })));

  app.post('/admin/entitlements/:id/review', { ...financeManage(), schema: { tags: ['prizes'], summary: 'Flag a payout for manual review (finance).', params: idParam, body: versionedBody(), response: okObject } }, async (request) =>
    financeView(await deps.prizes.flagForReview(request.requestContext, (request.params as { id: string }).id, request.body as { expectedVersion: number; reason: string })));

  app.post('/admin/entitlements/:id/processing', { ...financeApprove(), schema: { tags: ['prizes'], summary: 'Mark settlement as under way (finance approve).', params: idParam, body: versionedBody(), response: okObject } }, async (request) =>
    financeView(await deps.prizes.startProcessing(request.requestContext, (request.params as { id: string }).id, request.body as { expectedVersion: number; reason: string })));

  // A retry reuses the same entitlement, so it cannot become a second payment (PAYOUT-009).
  app.post('/admin/entitlements/:id/retry', { ...financeManage(), schema: { tags: ['prizes'], summary: 'Return a failed payout to approved for another attempt (finance).', params: idParam, body: versionedBody(), response: okObject } }, async (request) =>
    financeView(await deps.prizes.retryEntitlement(request.requestContext, (request.params as { id: string }).id, request.body as { expectedVersion: number; reason: string })));

  app.post('/admin/entitlements/:id/cancel', { ...financeApprove(), schema: { tags: ['prizes'], summary: 'Cancel a payout that will not be settled (finance approve).', params: idParam, body: versionedBody(), response: okObject } }, async (request) =>
    financeView(await deps.prizes.cancelEntitlement(request.requestContext, (request.params as { id: string }).id, request.body as { expectedVersion: number; reason: string })));

  // PAYOUT-010: the original allocation stays immutable; the reversal is recorded on top.
  app.post('/admin/entitlements/:id/reverse', { ...financeApprove(), schema: { tags: ['prizes'], summary: 'Reverse a settled payout with a reason (finance approve).', params: idParam, body: versionedBody(), response: okObject } }, async (request) =>
    financeView(await deps.prizes.reverseEntitlement(request.requestContext, (request.params as { id: string }).id, request.body as { expectedVersion: number; reason: string })));

  app.get('/admin/finance/reconciliation', { ...financeManage(), schema: { tags: ['prizes'], summary: 'Reconcile prize definition, allocation, ledger, and settlement; every difference is named.', response: okObject } }, async () =>
    deps.prizes.reconcileFinance());

  app.post('/admin/entitlements/:id/fail', { ...financeManage(), schema: { tags: ['prizes'], summary: 'Mark a cash entitlement failed (finance).', params: idParam, body: { type: 'object', required: ['expectedVersion', 'reason'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 500 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    financeView(await deps.prizes.failEntitlement(request.requestContext, (request.params as { id: string }).id, request.body as { expectedVersion: number; reason: string }))
  );
}
