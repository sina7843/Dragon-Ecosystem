import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { StoreService } from './service.ts';
import { FULFILLMENT_STATES, LOCALES, PRODUCT_TYPES, type FulfillmentState, type Locale, type ProductState } from './state.ts';

/**
 * Commerce HTTP surface (API-089..094, PAGE-037..041, PAGE-056, PAGE-057).
 *
 * There is **no return, refund, or entitlement-revocation route anywhere** — COMMERCE-010
 * excludes a customer return workflow and OD-020 has not confirmed revocation rules. A
 * guardrail test asserts that against the registered paths rather than against this
 * comment.
 */

export interface StoreDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  store: StoreService;
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
const localeQuery = { type: 'string', enum: [...LOCALES] } as const;
const reasonProperty = { type: 'string', minLength: 1, maxLength: 500 } as const;

function localeOf(request: FastifyRequest): Locale {
  const raw = (request.query as { locale?: string }).locale;
  return raw === 'en' ? 'en' : 'fa';
}

export function registerStoreRoutes(app: FastifyInstance, deps: StoreDeps): void {
  const guards = createSessionGuards(deps.identity);
  const authed = () => ({ preHandler: [guards.requireSession] });
  const shopGate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.storeManage)] });
  const actor = (request: FastifyRequest): string => requireIdentity(request).account._id;

  app.get(
    '/store/config',
    {
      schema: {
        tags: ['store'],
        summary: 'Which commerce capabilities are gated. Physical fulfillment, entitlement revocation, and returns are all off.',
        response: { 200: { type: 'object', additionalProperties: true } }
      }
    },
    async () => deps.store.configView()
  );

  // --- Public catalog (API-089, API-090) ---

  app.get(
    '/products',
    {
      schema: {
        tags: ['store'],
        summary: 'Published catalog. Filters distinguish physical from digital and available from not.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            locale: localeQuery,
            type: { type: 'string', enum: [...PRODUCT_TYPES] },
            q: { type: 'string', maxLength: 100 },
            available: { type: 'boolean' },
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        },
        response: okObject
      }
    },
    async (request) => {
      const query = request.query as { type?: 'physical' | 'digital'; q?: string; available?: boolean; cursor?: string; limit?: number };
      return deps.store.listProducts({
        locale: localeOf(request),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.q === undefined ? {} : { q: query.q }),
        ...(query.available === undefined ? {} : { availableOnly: query.available }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit })
      });
    }
  );

  app.get(
    '/products/:slug',
    {
      schema: {
        tags: ['store'],
        summary: 'Product detail with variants, stock, and whether it can be purchased today.',
        params: { type: 'object', required: ['slug'], additionalProperties: false, properties: { slug: { type: 'string' } } },
        querystring: { type: 'object', additionalProperties: false, properties: { locale: localeQuery } },
        response: okObject
      }
    },
    async (request) => {
      const product = await deps.store.getProduct((request.params as { slug: string }).slug, localeOf(request));
      if (product === null) throw new NotFoundError('Unknown product.');
      return product;
    }
  );

  // --- Cart (API-091) ---

  app.get(
    '/me/cart',
    { ...authed(), schema: { tags: ['store'], summary: 'The caller’s cart with server-calculated totals.', querystring: { type: 'object', additionalProperties: false, properties: { locale: localeQuery } }, response: okObject } },
    async (request) => deps.store.getCart(actor(request), localeOf(request))
  );

  app.patch(
    '/me/cart',
    {
      ...authed(),
      schema: {
        tags: ['store'],
        summary: 'Set a line quantity (zero removes it) or the discount code. Totals are always recalculated server-side.',
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            variantId: { type: 'string' },
            quantity: { type: 'integer', minimum: 0, maximum: 99 },
            discountCode: { type: ['string', 'null'], maxLength: 24 }
          }
        },
        response: okObject
      }
    },
    async (request) => {
      const body = request.body as { variantId?: string; quantity?: number; discountCode?: string | null };
      if (body.variantId !== undefined && body.quantity !== undefined) {
        await deps.store.setCartItem(request.requestContext, actor(request), body.variantId, body.quantity);
      }
      if (body.discountCode !== undefined) {
        await deps.store.setCartDiscount(request.requestContext, actor(request), body.discountCode);
      }
      return deps.store.getCart(actor(request), localeOf(request));
    }
  );

  // --- Checkout and orders (API-092, API-093, API-094) ---

  app.post(
    '/orders',
    {
      ...authed(),
      schema: {
        tags: ['store'],
        summary: 'Idempotent checkout. One order per key; a retry returns the original order.',
        body: {
          type: 'object',
          required: ['cartVersion', 'idempotencyKey', 'consent'],
          additionalProperties: false,
          properties: {
            cartVersion: { type: 'integer', minimum: 1 },
            idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
            consent: { type: 'boolean' },
            address: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fullName: { type: 'string', maxLength: 100 },
                mobile: { type: 'string', maxLength: 20 },
                province: { type: 'string', maxLength: 40 },
                city: { type: 'string', maxLength: 60 },
                postalCode: { type: 'string', maxLength: 10 },
                line1: { type: 'string', maxLength: 200 }
              }
            }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as Parameters<StoreService['checkout']>[2];
      const order = await deps.store.checkout(request.requestContext, actor(request), body);
      reply.status(201);
      const { _id, ...rest } = order;
      return { id: _id, ...rest };
    }
  );

  app.get(
    '/me/orders',
    {
      ...authed(),
      schema: { tags: ['store'], summary: 'The caller’s own orders.', querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: okObject }
    },
    async (request) => {
      const page = await deps.store.listMyOrders(actor(request), request.query as { cursor?: string; limit?: number });
      return { items: page.items.map(({ _id, ...rest }) => ({ id: _id, ...rest })), nextCursor: page.nextCursor };
    }
  );

  app.get(
    '/me/orders/:id',
    {
      ...authed(),
      schema: { tags: ['store'], summary: 'One owned order with its receipt. Someone else’s order is a 404.', params: idParam, response: okObject }
    },
    async (request) => {
      const detail = await deps.store.getMyOrder(actor(request), (request.params as { id: string }).id);
      if (detail === null) throw new NotFoundError('Unknown order.');
      const { order, ...rest } = detail;
      const { _id, ...orderRest } = order;
      return { order: { id: _id, ...orderRest }, ...rest };
    }
  );

  app.get(
    '/me/entitlements',
    { ...authed(), schema: { tags: ['store'], summary: 'Digital entitlements the caller owns.', response: okObject } },
    async (request) => ({ items: (await deps.store.listMyEntitlements(actor(request))).map(({ _id, ...rest }) => ({ id: _id, ...rest })) })
  );

  // --- Store administration (PAGE-056, ROLE-021) ---

  app.post(
    '/admin/store/products',
    {
      ...shopGate(),
      schema: {
        tags: ['store'],
        summary: 'Create a draft product in both locales.',
        body: {
          type: 'object',
          required: ['type', 'translations'],
          additionalProperties: false,
          properties: {
            slug: { type: 'string', maxLength: 120 },
            type: { type: 'string', enum: [...PRODUCT_TYPES] },
            translations: { type: 'object', additionalProperties: true },
            mediaUrls: { type: 'array', maxItems: 8, items: { type: 'string' } }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const product = await deps.store.createProduct(request.requestContext, actor(request), request.body as Parameters<StoreService['createProduct']>[2]);
      reply.status(201);
      const { _id, ...rest } = product;
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/store/products/:id/status',
    {
      ...shopGate(),
      schema: {
        tags: ['store'],
        summary: 'Publish, unpublish, or archive a product.',
        params: idParam,
        body: { type: 'object', required: ['state', 'reason'], additionalProperties: false, properties: { state: { type: 'string', enum: ['draft', 'published', 'archived'] }, reason: reasonProperty } },
        response: okObject
      }
    },
    async (request) => {
      const body = request.body as { state: ProductState; reason: string };
      const { _id, ...rest } = await deps.store.transitionProduct(request.requestContext, (request.params as { id: string }).id, body.state, body.reason);
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/store/products/:id/variants',
    {
      ...shopGate(),
      schema: {
        tags: ['store'],
        summary: 'Add a variant. The Dragon Coin price is what is charged; a Toman price is a displayed list price.',
        params: idParam,
        body: {
          type: 'object',
          required: ['sku', 'translations', 'price'],
          additionalProperties: false,
          properties: {
            sku: { type: 'string', maxLength: 32 },
            translations: { type: 'object', additionalProperties: true },
            price: { type: 'object', additionalProperties: false, properties: { dragonCoinAmount: { type: 'integer' }, tomanAmount: { type: 'integer' } } },
            stockOnHand: { type: 'integer', minimum: 0 }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const variant = await deps.store.createVariant(request.requestContext, (request.params as { id: string }).id, request.body as Parameters<StoreService['createVariant']>[2]);
      reply.status(201);
      const { _id, ...rest } = variant;
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/store/variants/:id/inventory',
    {
      ...shopGate(),
      schema: {
        tags: ['store'],
        summary: 'Adjust stock with a reason. Every movement is retained (COMMERCE-013).',
        params: idParam,
        body: { type: 'object', required: ['quantityDelta', 'reason'], additionalProperties: false, properties: { quantityDelta: { type: 'integer' }, reason: reasonProperty } },
        response: okObject
      }
    },
    async (request) => {
      const body = request.body as { quantityDelta: number; reason: string };
      const { _id, ...rest } = await deps.store.adjustInventory(request.requestContext, (request.params as { id: string }).id, body.quantityDelta, body.reason);
      return { id: _id, ...rest };
    }
  );

  app.get(
    '/admin/store/variants/:id/inventory',
    { ...shopGate(), schema: { tags: ['store'], summary: 'Stock movement history for a variant.', params: idParam, response: okObject } },
    async (request) => ({ items: (await deps.store.listMovements((request.params as { id: string }).id)).map(({ _id, ...rest }) => ({ id: _id, ...rest })) })
  );

  app.post(
    '/admin/store/discounts',
    {
      ...shopGate(),
      schema: {
        tags: ['store'],
        summary: 'Create a versioned discount with a period and optional usage limit.',
        body: {
          type: 'object',
          required: ['code', 'percentOff', 'startsAt', 'endsAt'],
          additionalProperties: false,
          properties: {
            code: { type: 'string', maxLength: 24 },
            percentOff: { type: 'integer', minimum: 1, maximum: 90 },
            startsAt: { type: 'string' },
            endsAt: { type: 'string' },
            productIds: { type: 'array', maxItems: 50, items: { type: 'string' } },
            maxRedemptions: { type: 'integer', minimum: 1 }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const discount = await deps.store.createDiscount(request.requestContext, request.body as Parameters<StoreService['createDiscount']>[1]);
      reply.status(201);
      const { _id, ...rest } = discount;
      return { id: _id, ...rest };
    }
  );

  // --- Order operations (PAGE-057) ---

  app.get(
    '/admin/store/orders',
    {
      ...shopGate(),
      schema: { tags: ['store'], summary: 'Orders with payment and fulfillment status. No ledger change can be made here.', querystring: { type: 'object', additionalProperties: false, properties: { state: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: okObject }
    },
    async (request) => ({ items: (await deps.store.listOrdersForOperator(request.query as { state?: string; limit?: number })).map(({ _id, ...rest }) => ({ id: _id, ...rest })) })
  );

  app.get(
    '/admin/store/orders/:id/fulfillments',
    { ...shopGate(), schema: { tags: ['store'], summary: 'Fulfillment rows for one order.', params: idParam, response: okObject } },
    async (request) => ({ items: (await deps.store.listFulfillments((request.params as { id: string }).id)).map(({ _id, ...rest }) => ({ id: _id, ...rest })) })
  );

  app.post(
    '/admin/store/fulfillments/:id/state',
    {
      ...shopGate(),
      schema: {
        tags: ['store'],
        summary: 'Advance an internal fulfillment state. No carrier is booked and no external call is made.',
        params: idParam,
        body: { type: 'object', required: ['state', 'reason'], additionalProperties: false, properties: { state: { type: 'string', enum: [...FULFILLMENT_STATES] }, reason: reasonProperty } },
        response: okObject
      }
    },
    async (request) => {
      const body = request.body as { state: FulfillmentState; reason: string };
      const { _id, ...rest } = await deps.store.transitionFulfillment(request.requestContext, (request.params as { id: string }).id, body.state, actor(request), body.reason);
      return { id: _id, ...rest };
    }
  );

  app.get(
    '/admin/store/reconciliation',
    { ...shopGate(), schema: { tags: ['store'], summary: 'Recomputes paid-order totals from their line items and reports every difference.', response: okObject } },
    async () => deps.store.reconcile()
  );
}
