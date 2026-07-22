import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the notifications module (DRAGON-13). */
export const NOTIFICATIONS_COLLECTIONS = {
  notifications: 'notifications',
  deliveries: 'notification_deliveries',
  templates: 'notification_templates',
  enablements: 'notification_template_enablements',
  preferences: 'notification_preferences'
} as const;

/**
 * Notification safeguards. One in-app notification per (account, source event,
 * template) makes the outbox consumer idempotent; one delivery per (notification,
 * channel); one template per (key, channel, version); one enablement per
 * (tournament, template). Delivery lookup by due time backs the bounded retry pass.
 */
export const NOTIFICATIONS_INDEXES: readonly IndexDeclaration[] = [
  { collection: NOTIFICATIONS_COLLECTIONS.notifications, name: 'notification_idem_unique', keys: { accountId: 1, sourceEventId: 1, templateKey: 1 }, options: { unique: true } },
  { collection: NOTIFICATIONS_COLLECTIONS.notifications, name: 'notification_account_created', keys: { accountId: 1, createdAt: -1, _id: 1 } },
  { collection: NOTIFICATIONS_COLLECTIONS.notifications, name: 'notification_account_unread', keys: { accountId: 1, readAt: 1 } },

  { collection: NOTIFICATIONS_COLLECTIONS.deliveries, name: 'delivery_notification_channel_unique', keys: { notificationId: 1, channel: 1 }, options: { unique: true } },
  { collection: NOTIFICATIONS_COLLECTIONS.deliveries, name: 'delivery_due', keys: { status: 1, nextAttemptAt: 1 } },

  { collection: NOTIFICATIONS_COLLECTIONS.templates, name: 'template_key_channel_version_unique', keys: { templateKey: 1, channel: 1, version: 1 }, options: { unique: true } },
  { collection: NOTIFICATIONS_COLLECTIONS.enablements, name: 'enablement_unique', keys: { tournamentId: 1, templateKey: 1 }, options: { unique: true } }
];
