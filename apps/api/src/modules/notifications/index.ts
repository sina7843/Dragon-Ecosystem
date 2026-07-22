/** Public surface of the notifications module (section 32.1). */
export { NotificationsService, type ContactAccess, type NotificationsConfigView } from './service.ts';
export { registerNotificationsRoutes, type NotificationsDeps } from './routes.ts';
export { notificationsMigration } from './migrations.ts';
export { NOTIFICATIONS_COLLECTIONS, NOTIFICATIONS_INDEXES } from './collections.ts';
export { EVENT_TEMPLATES, templateForEvent, renderTemplate, KNOWN_TEMPLATE_KEYS, type NotificationChannel, type NotificationCategory } from './templates.ts';
export { MockSmsChannel, MockEmailChannel, maskRecipient, type NotificationChannelAdapter } from './channels.ts';
export type { NotificationRecord, NotificationDeliveryRecord, NotificationTemplateRecord, NotificationPreferenceRecord, Locale } from './state.ts';
