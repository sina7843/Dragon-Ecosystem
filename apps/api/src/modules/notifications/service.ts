import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork, type UnitOfWork } from '../../shared/db/unit-of-work.ts';
import { createRequestContext, SYSTEM_ACTOR, type RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import { COLLECTIONS } from '../../shared/db/collections.ts';
import type { OutboxRecord } from '../../shared/db/outbox.ts';
import type { Environment } from '../../config.ts';
import { NOTIFICATIONS_COLLECTIONS } from './collections.ts';
import { KNOWN_TEMPLATE_KEYS, renderTemplate, templateForEvent, type EventTemplate, type NotificationCategory } from './templates.ts';
import { MockSmsChannel, MockEmailChannel, maskRecipient, type NotificationChannelAdapter } from './channels.ts';
import {
  DEFAULT_PREFERENCES,
  isNotificationLocale,
  type BoundedParams,
  type Locale,
  type NotificationDeliveryRecord,
  type NotificationPreferenceRecord,
  type NotificationRecord,
  type NotificationTemplateRecord,
  type TemplateEnablementRecord
} from './state.ts';

/**
 * Notifications engine (DRAGON-13): an idempotent domain-event outbox consumer that
 * produces in-app inbox items and gated SMS/email deliveries with retry/dead-letter.
 * In-app is always active; SMS (OD-008) and email (OD-003) are fail-closed and stay
 * off unless explicitly enabled. Marketing never reuses transactional consent.
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_SECONDS = 60;
const CLAIM_LOCK_SECONDS = 120;

export interface ContactAccess {
  getContact(accountId: string): Promise<{ mobile: string | null; email: string | null; locale: Locale } | null>;
}
export interface NotificationsConfigView {
  smsEnabled: boolean;
  emailEnabled: boolean;
}

function pickParams(payload: Record<string, unknown>, fields: readonly string[]): BoundedParams {
  const params: Record<string, string | number> = {};
  for (const field of fields) {
    const value = payload[field];
    if (typeof value === 'string' || typeof value === 'number') params[field] = value;
  }
  return params;
}

export class NotificationsService {
  readonly #database: Database;
  readonly #config: NotificationsConfigView;
  readonly #contacts: ContactAccess;
  readonly #sms: NotificationChannelAdapter;
  readonly #email: NotificationChannelAdapter;

  constructor(database: Database, config: NotificationsConfigView, env: Environment, contacts: ContactAccess) {
    this.#database = database;
    this.#config = config;
    this.#contacts = contacts;
    this.#sms = new MockSmsChannel();
    this.#email = new MockEmailChannel(database.db, env);
  }

  get #db(): Db {
    return this.#database.db;
  }
  #notifications(db: Db = this.#db) {
    return db.collection<NotificationRecord>(NOTIFICATIONS_COLLECTIONS.notifications);
  }
  #deliveries(db: Db = this.#db) {
    return db.collection<NotificationDeliveryRecord>(NOTIFICATIONS_COLLECTIONS.deliveries);
  }
  #templates(db: Db = this.#db) {
    return db.collection<NotificationTemplateRecord>(NOTIFICATIONS_COLLECTIONS.templates);
  }
  #enablements(db: Db = this.#db) {
    return db.collection<TemplateEnablementRecord>(NOTIFICATIONS_COLLECTIONS.enablements);
  }
  #preferences(db: Db = this.#db) {
    return db.collection<NotificationPreferenceRecord>(NOTIFICATIONS_COLLECTIONS.preferences);
  }
  #outbox(db: Db = this.#db) {
    return db.collection<OutboxRecord>(COLLECTIONS.domainEventOutbox);
  }

  // --- Outbox consumer (idempotent, bounded) ---

  /**
   * Consumes pending domain events into in-app notifications and gated channel
   * deliveries, marking each event dispatched — all atomically per event. Idempotent:
   * the unique (account, sourceEvent, template) index makes a concurrent or replayed
   * consume produce no duplicate notification, and a dispatched event is not re-read.
   */
  async processOutbox(context: RequestContext, options: { limit?: number } = {}): Promise<{ processed: number; notified: number }> {
    const limit = Math.min(200, Math.max(1, options.limit ?? 100));
    const events = await this.#outbox().find({ state: 'pending' }).sort({ 'event.occurredAt': 1 }).limit(limit).toArray();
    let processed = 0;
    let notified = 0;
    for (const record of events) {
      try {
        const created = await runUnitOfWork(this.#database, context, async (uow) => this.#consumeEvent(uow, record));
        processed += 1;
        if (created) notified += 1;
      } catch (error) {
        // A concurrent consumer produced this notification first (unique index): the event
        // stays pending and converges on the next pass. A genuine error still surfaces.
        if (!isDuplicateKey(error)) throw error;
      }
    }
    return { processed, notified };
  }

  async #consumeEvent(uow: UnitOfWork, record: OutboxRecord): Promise<boolean> {
    const template = templateForEvent(record.event.eventName);
    let created = false;
    if (template !== undefined) {
      const payload = record.event.payload as Record<string, unknown>;
      const recipient = payload[template.recipientField];
      if (typeof recipient === 'string' && recipient.trim() !== '') {
        // Pre-check keeps a redelivery idempotent without triggering an in-transaction
        // duplicate-key abort. A rare concurrent insert still hits the unique index and
        // aborts, which withTransaction retries — the retry then sees the committed row.
        const existing = await this.#notifications(uow.db).findOne({ accountId: recipient, sourceEventId: record._id, templateKey: template.templateKey }, { session: uow.session });
        if (existing === null) {
          const notificationId = newId();
          const now = utcNow();
          await this.#notifications(uow.db).insertOne(
            { _id: notificationId, accountId: recipient, sourceEventId: record._id, templateKey: template.templateKey, category: template.category, params: pickParams(payload, template.paramFields), correlationId: record.event.correlationId, readAt: null, createdAt: now },
            { session: uow.session }
          );
          created = true;
          for (const channel of template.channels) {
            if (channel === 'in_app') continue;
            await this.#enqueueDelivery(uow, notificationId, recipient, template, channel, record.event.correlationId);
          }
          uow.audit({ action: 'notification.created', resourceType: 'notification', resourceId: notificationId, after: { accountId: recipient, templateKey: template.templateKey } });
        }
      }
    }
    await this.#outbox(uow.db).updateOne({ _id: record._id, state: 'pending' }, { $set: { state: 'dispatched' } }, { session: uow.session });
    return created;
  }

  async #enqueueDelivery(uow: UnitOfWork, notificationId: EntityId, accountId: EntityId, template: EventTemplate, channel: 'sms' | 'email', correlationId: string): Promise<void> {
    const contact = await this.#contacts.getContact(accountId);
    const address = contact === null ? null : channel === 'sms' ? contact.mobile : contact.email;
    const locale: Locale = contact?.locale ?? 'fa';
    const gateOn = channel === 'sms' ? this.#config.smsEnabled : this.#config.emailEnabled;
    const prefs = (await this.#preferences(uow.db).findOne({ _id: accountId }, { session: uow.session }))?.categories ?? DEFAULT_PREFERENCES;
    const consent = prefs[template.category][channel];

    let status: NotificationDeliveryRecord['status'] = 'pending';
    let suppressedReason: string | null = null;
    if (address === null || address === '') { status = 'suppressed'; suppressedReason = 'no_contact'; }
    else if (!gateOn) { status = 'suppressed'; suppressedReason = 'channel_disabled'; }
    else if (!consent) { status = 'suppressed'; suppressedReason = 'no_consent'; }

    const now = utcNow();
    await this.#deliveries(uow.db).insertOne(
      { _id: newId(), notificationId, accountId, channel, templateKey: template.templateKey, category: template.category, recipientMasked: address === null ? '***' : maskRecipient(address), locale, status, attempts: 0, maxAttempts: MAX_ATTEMPTS, lastError: null, suppressedReason, nextAttemptAt: now, correlationId, createdAt: now, updatedAt: now },
      { session: uow.session }
    );
  }

  // --- Delivery processor (retry / dead-letter) ---

  /** Sends due pending deliveries; retries failures up to the cap, then dead-letters. Bounded. */
  async processDeliveries(context: RequestContext, options: { limit?: number } = {}): Promise<{ sent: number; failed: number; dead: number }> {
    const limit = Math.min(200, Math.max(1, options.limit ?? 100));
    const now = utcNow();
    const due = await this.#deliveries().find({ status: 'pending', nextAttemptAt: { $lte: now } }).sort({ nextAttemptAt: 1 }).limit(limit).toArray();
    let sent = 0;
    let failed = 0;
    let dead = 0;
    for (const delivery of due) {
      // Atomically claim so concurrent processors cannot double-send.
      const claimAt = new Date(Date.now() + CLAIM_LOCK_SECONDS * 1000).toISOString();
      const claimed = await this.#deliveries().findOneAndUpdate(
        { _id: delivery._id, status: 'pending', nextAttemptAt: { $lte: now } },
        { $set: { nextAttemptAt: claimAt, updatedAt: now }, $inc: { attempts: 1 } },
        { returnDocument: 'after' }
      );
      if (claimed === null) continue;

      const template = await this.#latestApprovedTemplate(claimed.templateKey, claimed.channel);
      const contact = await this.#contacts.getContact(claimed.accountId);
      const address = contact === null ? null : claimed.channel === 'sms' ? contact.mobile : contact.email;
      const notification = await this.#notifications().findOne({ _id: claimed.notificationId });

      if (template === null || address === null) {
        await this.#settleDelivery(context, claimed._id, 'suppressed', template === null ? 'no_template' : 'no_contact', null);
        continue;
      }
      const localized = template.locales[claimed.locale];
      const body = renderTemplate(localized.body, notification?.params ?? {});
      const outcome = await this.#channel(claimed.channel).send({ recipient: address, locale: claimed.locale, subject: localized.subject, body, correlationId: claimed.correlationId });
      if (outcome === 'sent') {
        await this.#settleDelivery(context, claimed._id, 'sent', null, null);
        sent += 1;
      } else if (claimed.attempts >= claimed.maxAttempts) {
        await this.#settleDelivery(context, claimed._id, 'dead', null, 'max_attempts_exhausted');
        dead += 1;
      } else {
        // Requeue for another attempt after the backoff.
        await this.#deliveries().updateOne({ _id: claimed._id }, { $set: { status: 'pending', nextAttemptAt: new Date(Date.now() + RETRY_BACKOFF_SECONDS * 1000).toISOString(), lastError: 'delivery_failed', updatedAt: utcNow() } });
        failed += 1;
      }
    }
    return { sent, failed, dead };
  }

  #channel(channel: 'sms' | 'email'): NotificationChannelAdapter {
    return channel === 'sms' ? this.#sms : this.#email;
  }

  async #settleDelivery(context: RequestContext, deliveryId: EntityId, status: NotificationDeliveryRecord['status'], suppressedReason: string | null, lastError: string | null): Promise<void> {
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#deliveries(uow.db).updateOne({ _id: deliveryId }, { $set: { status, suppressedReason, lastError, updatedAt: utcNow() } }, { session: uow.session });
      uow.audit({ action: `notification.delivery_${status}`, resourceType: 'notification_delivery', resourceId: deliveryId });
    });
  }

  async #latestApprovedTemplate(templateKey: string, channel: 'sms' | 'email'): Promise<NotificationTemplateRecord | null> {
    return this.#templates().findOne({ templateKey, channel, status: 'approved' }, { sort: { version: -1 } });
  }

  // --- Inbox reads / read state ---

  async listInbox(accountId: EntityId, query: { cursor?: string; limit?: number } = {}): Promise<Page<NotificationRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { accountId };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    const rows = await this.#notifications().find(filter).sort({ createdAt: -1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as NotificationRecord), nextCursor: page.nextCursor };
  }

  async unreadCount(accountId: EntityId): Promise<{ unread: number }> {
    return { unread: await this.#notifications().countDocuments({ accountId, readAt: null }) };
  }

  async markRead(context: RequestContext, accountId: EntityId, notificationId: EntityId): Promise<NotificationRecord> {
    const notification = await this.#notifications().findOne({ _id: notificationId, accountId });
    if (notification === null) throw new NotFoundError('Unknown notification.');
    if (notification.readAt !== null) return notification;
    const now = utcNow();
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#notifications(uow.db).updateOne({ _id: notificationId, accountId, readAt: null }, { $set: { readAt: now } }, { session: uow.session });
    });
    return { ...notification, readAt: now };
  }

  async markAllRead(context: RequestContext, accountId: EntityId): Promise<{ updated: number }> {
    let updated = 0;
    await runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#notifications(uow.db).updateMany({ accountId, readAt: null }, { $set: { readAt: utcNow() } }, { session: uow.session });
      updated = result.modifiedCount;
    });
    return { updated };
  }

  // --- Preferences (OD-008 gated) ---

  async getPreferences(accountId: EntityId): Promise<NotificationPreferenceRecord['categories']> {
    return (await this.#preferences().findOne({ _id: accountId }))?.categories ?? DEFAULT_PREFERENCES;
  }

  /**
   * Updates channel preferences. Under OD-008 every class except transactional in-app
   * is disabled, so enabling any SMS/email/marketing class is refused — a client can
   * never opt into a gated class, and marketing can never inherit transactional consent.
   */
  async updatePreferences(context: RequestContext, accountId: EntityId, input: Partial<{ transactional: Partial<Record<'sms' | 'email', boolean>>; marketing: Partial<Record<'in_app' | 'sms' | 'email', boolean>> }>): Promise<NotificationPreferenceRecord['categories']> {
    const wantsGatedClass =
      input.transactional?.sms === true ||
      input.transactional?.email === true ||
      input.marketing?.in_app === true ||
      input.marketing?.sms === true ||
      input.marketing?.email === true;
    if (wantsGatedClass) throw new ConflictError('NOTIFICATION_CLASS_DISABLED', 'That notification class is not available yet.');
    // The only mutable settings today are turning gated classes back off (idempotent) — persist defaults.
    const now = utcNow();
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#preferences(uow.db).updateOne({ _id: accountId }, { $set: { categories: DEFAULT_PREFERENCES, updatedAt: now } }, { upsert: true, session: uow.session });
    });
    return DEFAULT_PREFERENCES;
  }

  // --- Admin: templates + enablement + operator visibility ---

  async createTemplate(context: RequestContext, input: { templateKey: string; channel: 'sms' | 'email'; category: NotificationCategory; locales: Record<Locale, { subject: string; body: string }> }): Promise<NotificationTemplateRecord> {
    if (!KNOWN_TEMPLATE_KEYS.includes(input.templateKey)) throw new ValidationError('The template key is not recognized.', [{ field: 'templateKey', code: 'UNKNOWN_TEMPLATE_KEY', message: 'Use a mapped template key.' }]);
    for (const locale of ['fa', 'en'] as const) {
      if (!isNotificationLocale(locale) || input.locales[locale] === undefined || input.locales[locale].body.trim() === '') throw new ValidationError('Every locale needs a body.', [{ field: 'locales', code: 'INCOMPLETE_TEMPLATE', message: 'Provide fa and en bodies.' }]);
    }
    const priorVersion = (await this.#templates().find({ templateKey: input.templateKey, channel: input.channel }).sort({ version: -1 }).limit(1).toArray())[0]?.version ?? 0;
    const now = utcNow();
    const template: NotificationTemplateRecord = { _id: newId(), templateKey: input.templateKey, channel: input.channel, version: priorVersion + 1, category: input.category, status: 'draft', locales: input.locales, createdBy: context.actor.accountId ?? 'system', approvedBy: null, createdAt: now, updatedAt: now };
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#templates(uow.db).insertOne(template, { session: uow.session });
      uow.audit({ action: 'notification.template_created', resourceType: 'notification_template', resourceId: template._id, after: { templateKey: template.templateKey, channel: template.channel, version: template.version } });
    });
    return template;
  }

  async approveTemplate(context: RequestContext, templateId: EntityId): Promise<NotificationTemplateRecord> {
    const template = await this.#templates().findOne({ _id: templateId });
    if (template === null) throw new NotFoundError('Unknown template.');
    if (template.status === 'approved') return template;
    const now = utcNow();
    await runUnitOfWork(this.#database, context, async (uow) => {
      const updated = await this.#templates(uow.db).updateOne({ _id: templateId, status: 'draft' }, { $set: { status: 'approved', approvedBy: context.actor.accountId ?? 'system', updatedAt: now } }, { session: uow.session });
      if (updated.matchedCount === 0) throw new ConflictError('TEMPLATE_NOT_DRAFT', 'The template is no longer a draft.');
      uow.audit({ action: 'notification.template_approved', resourceType: 'notification_template', resourceId: templateId, after: { templateKey: template.templateKey } });
    });
    return { ...template, status: 'approved', approvedBy: context.actor.accountId ?? 'system', updatedAt: now };
  }

  async enableTournamentTemplate(context: RequestContext, input: { tournamentId: EntityId; templateKey: string }): Promise<TemplateEnablementRecord> {
    if (!KNOWN_TEMPLATE_KEYS.includes(input.templateKey)) throw new ValidationError('The template key is not recognized.', [{ field: 'templateKey', code: 'UNKNOWN_TEMPLATE_KEY', message: 'Use a mapped template key.' }]);
    const record: TemplateEnablementRecord = { _id: newId(), tournamentId: input.tournamentId, templateKey: input.templateKey, enabledBy: context.actor.accountId ?? 'system', createdAt: utcNow() };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#enablements(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'notification.template_enabled', resourceType: 'notification_template_enablement', resourceId: record._id, after: { tournamentId: input.tournamentId, templateKey: input.templateKey } });
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictError('TEMPLATE_ALREADY_ENABLED', 'This template is already enabled for the tournament.');
      throw error;
    }
    return record;
  }

  async listTemplates(): Promise<NotificationTemplateRecord[]> {
    return this.#templates().find({}).sort({ templateKey: 1, channel: 1, version: -1 }).limit(200).toArray();
  }

  /** Operator delivery visibility. Recipients are already masked in storage. */
  async listDeliveries(query: { status?: string; cursor?: string; limit?: number } = {}): Promise<Page<NotificationDeliveryRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined && query.status !== '') filter['status'] = query.status;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    const rows = await this.#deliveries().find(filter).sort({ createdAt: -1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as NotificationDeliveryRecord), nextCursor: page.nextCursor };
  }

  /** A system-actor context for background consume/deliver passes. */
  systemContext(): RequestContext {
    return createRequestContext(newId(), SYSTEM_ACTOR);
  }
}
