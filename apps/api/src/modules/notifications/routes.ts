import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { NotificationsService } from './service.ts';
import type { NotificationRecord, NotificationDeliveryRecord, NotificationTemplateRecord } from './state.ts';

/**
 * Notification HTTP surface (DRAGON-13). Participant routes are session-gated and act
 * only on the caller's own inbox and preferences. Template approval, tournament
 * enablement, delivery visibility, and the consume/deliver trigger require the
 * support/operator permission. No raw recipient contact is ever exposed.
 */

export interface NotificationsDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  notifications: NotificationsService;
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

/** Participant inbox view: localized client-side from templateKey + params; no recipient/contact detail. */
function inboxView(notification: NotificationRecord) {
  return { id: notification._id, templateKey: notification.templateKey, category: notification.category, params: notification.params, read: notification.readAt !== null, createdAt: notification.createdAt };
}
/** Operator delivery view: recipient already masked in storage; no full contact. */
function deliveryView(delivery: NotificationDeliveryRecord) {
  return { id: delivery._id, channel: delivery.channel, templateKey: delivery.templateKey, category: delivery.category, recipientMasked: delivery.recipientMasked, status: delivery.status, attempts: delivery.attempts, suppressedReason: delivery.suppressedReason, createdAt: delivery.createdAt };
}
function templateView(template: NotificationTemplateRecord) {
  return { id: template._id, templateKey: template.templateKey, channel: template.channel, version: template.version, category: template.category, status: template.status, locales: template.locales, createdAt: template.createdAt };
}

export function registerNotificationsRoutes(app: FastifyInstance, deps: NotificationsDeps): void {
  const guards = createSessionGuards(deps.identity);
  const authed = () => ({ preHandler: [guards.requireSession] });
  const opsGate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.supportManage)] });
  const accountId = (request: FastifyRequest): string => requireIdentity(request).account._id;

  // --- Participant inbox ---
  app.get('/notifications', { ...authed(), schema: { tags: ['notifications'], summary: 'List the caller\'s notifications.', querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.notifications.listInbox(accountId(request), request.query as { cursor?: string; limit?: number });
    return { items: page.items.map(inboxView), nextCursor: page.nextCursor };
  });

  app.get('/notifications/unread-count', { ...authed(), schema: { tags: ['notifications'], summary: 'Unread notification count.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    deps.notifications.unreadCount(accountId(request))
  );

  app.post('/notifications/read-all', { ...authed(), schema: { tags: ['notifications'], summary: 'Mark all notifications read.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    deps.notifications.markAllRead(request.requestContext, accountId(request))
  );

  app.post('/notifications/:id/read', { ...authed(), schema: { tags: ['notifications'], summary: 'Mark one notification read.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const notification = await deps.notifications.markRead(request.requestContext, accountId(request), (request.params as { id: string }).id);
    return inboxView(notification);
  });

  app.get('/notifications/preferences', { ...authed(), schema: { tags: ['notifications'], summary: 'Get notification preferences.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    ({ categories: await deps.notifications.getPreferences(accountId(request)) })
  );

  app.put('/notifications/preferences', { ...authed(), schema: { tags: ['notifications'], summary: 'Update notification preferences (gated classes are rejected).', body: { type: 'object', additionalProperties: false, properties: { transactional: { type: 'object', additionalProperties: false, properties: { sms: { type: 'boolean' }, email: { type: 'boolean' } } }, marketing: { type: 'object', additionalProperties: false, properties: { in_app: { type: 'boolean' }, sms: { type: 'boolean' }, email: { type: 'boolean' } } } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    ({ categories: await deps.notifications.updatePreferences(request.requestContext, accountId(request), request.body as Parameters<NotificationsService['updatePreferences']>[2]) })
  );

  // --- Operator / admin ---
  app.get('/admin/notification-templates', { ...opsGate(), schema: { tags: ['notifications'], summary: 'List notification templates (operator).', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async () =>
    ({ templates: (await deps.notifications.listTemplates()).map(templateView) })
  );

  app.post(
    '/admin/notification-templates',
    {
      ...opsGate(),
      schema: { tags: ['notifications'], summary: 'Create a versioned SMS/email template (operator).', body: { type: 'object', required: ['templateKey', 'channel', 'category', 'locales'], additionalProperties: false, properties: { templateKey: { type: 'string', minLength: 1, maxLength: 64 }, channel: { type: 'string', enum: ['sms', 'email'] }, category: { type: 'string', enum: ['transactional', 'marketing'] }, locales: { type: 'object', required: ['fa', 'en'], additionalProperties: false, properties: { fa: { type: 'object', required: ['subject', 'body'], additionalProperties: false, properties: { subject: { type: 'string', maxLength: 200 }, body: { type: 'string', minLength: 1, maxLength: 1000 } } }, en: { type: 'object', required: ['subject', 'body'], additionalProperties: false, properties: { subject: { type: 'string', maxLength: 200 }, body: { type: 'string', minLength: 1, maxLength: 1000 } } } } } } }, response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses } }
    },
    async (request, reply) => {
      const template = await deps.notifications.createTemplate(request.requestContext, request.body as Parameters<NotificationsService['createTemplate']>[1]);
      reply.status(201);
      return templateView(template);
    }
  );

  app.post('/admin/notification-templates/:id/approve', { ...opsGate(), schema: { tags: ['notifications'], summary: 'Approve a template (operator).', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) =>
    templateView(await deps.notifications.approveTemplate(request.requestContext, (request.params as { id: string }).id))
  );

  app.post('/admin/notification-templates/enable', { ...opsGate(), schema: { tags: ['notifications'], summary: 'Enable a template for a tournament (operator).', body: { type: 'object', required: ['tournamentId', 'templateKey'], additionalProperties: false, properties: { tournamentId: { type: 'string', minLength: 1, maxLength: 64 }, templateKey: { type: 'string', minLength: 1, maxLength: 64 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const record = await deps.notifications.enableTournamentTemplate(request.requestContext, request.body as { tournamentId: string; templateKey: string });
    return { id: record._id, tournamentId: record.tournamentId, templateKey: record.templateKey };
  });

  app.get('/admin/notification-deliveries', { ...opsGate(), schema: { tags: ['notifications'], summary: 'List notification deliveries with masked recipients (operator).', querystring: { type: 'object', additionalProperties: false, properties: { status: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.notifications.listDeliveries(request.query as { status?: string; cursor?: string; limit?: number });
    return { items: page.items.map(deliveryView), nextCursor: page.nextCursor };
  });

  app.post('/admin/notifications/process', { ...opsGate(), schema: { tags: ['notifications'], summary: 'Run a bounded consume + deliver pass (operator).', body: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const limit = (request.body as { limit?: number } | undefined)?.limit;
    const consumed = await deps.notifications.processOutbox(request.requestContext, limit === undefined ? {} : { limit });
    const delivered = await deps.notifications.processDeliveries(request.requestContext, limit === undefined ? {} : { limit });
    return { consumed, delivered };
  });
}
