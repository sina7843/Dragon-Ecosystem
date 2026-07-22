import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { runMigrations } from '../../shared/db/migrations.ts';
import { allMigrations } from '../../migrations.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { NotificationsService, type ContactAccess } from './service.ts';
import { NOTIFICATIONS_COLLECTIONS } from './collections.ts';
import type { Locale } from './state.ts';

/**
 * Notifications integration coverage (DRAGON-13): idempotent outbox consumer,
 * in-app inbox + read state, channel gating/consent suppression, delivery
 * retry/dead-letter, template versioning + approval, preference gating (OD-008),
 * recipient masking, and index uniqueness. Requires `npm run db:test:up`.
 */

let fixture: TestDatabase;
let notifications: NotificationsService;
const contacts = new Map<string, { mobile: string | null; email: string | null; locale: Locale }>();

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  const contactAccess: ContactAccess = { getContact: (id) => Promise.resolve(contacts.get(id) ?? null) };
  // SMS gate on so the delivery mechanism is exercisable; email off.
  notifications = new NotificationsService(fixture.database, { smsEnabled: true, emailEnabled: false }, 'test', contactAccess);
});

after(async () => {
  await fixture.dispose();
});

function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

beforeEach(async () => {
  for (const name of [...Object.values(NOTIFICATIONS_COLLECTIONS), 'domain_event_outbox', 'audit_events']) {
    await coll(name).deleteMany({});
  }
  contacts.clear();
});

const ctx = (accountId: string) => createRequestContext(newId(), { kind: 'account', accountId, roles: [] });

async function enqueue(eventName: string, payload: Record<string, unknown>): Promise<string> {
  const eventId = newId();
  await coll('domain_event_outbox').insertOne({ _id: eventId, event: { eventId, eventName, aggregateId: newId(), occurredAt: utcNow(), correlationId: newId(), producer: 'test', payload }, state: 'pending', attempts: 0, lastError: null, createdAt: utcNow() });
  return eventId;
}

describe('outbox consumer', () => {
  test('a mapped event becomes an in-app notification; an unmapped event does not', async () => {
    const account = newId();
    await enqueue('payment.purchase_succeeded', { accountId: account, dragonCoin: 100 });
    await enqueue('some.unmapped.event', { accountId: account });
    const result = await notifications.processOutbox(ctx('system'));
    assert.equal(result.processed, 2);
    assert.equal(result.notified, 1);
    const inbox = await notifications.listInbox(account);
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0]?.templateKey, 'coins_added');
    assert.deepEqual(inbox.items[0]?.params, { dragonCoin: 100 });
    // Both outbox events are marked dispatched.
    assert.equal(await coll('domain_event_outbox').countDocuments({ state: 'pending' }), 0);
  });

  test('reprocessing the same event creates no duplicate notification (idempotent)', async () => {
    const account = newId();
    const eventId = await enqueue('checkout.activated', { accountId: account, tournamentId: newId(), registrationId: newId() });
    await notifications.processOutbox(ctx('system'));
    // Force the event back to pending and reprocess (simulates a redelivery / concurrent consumer).
    await coll('domain_event_outbox').updateOne({ _id: eventId }, { $set: { state: 'pending' } });
    await notifications.processOutbox(ctx('system'));
    assert.equal(await coll(NOTIFICATIONS_COLLECTIONS.notifications).countDocuments({ accountId: account }), 1);
  });

  test('two concurrent consume passes on the same event create exactly one notification', async () => {
    const account = newId();
    await enqueue('payment.purchase_succeeded', { accountId: account, dragonCoin: 42 });
    const results = await Promise.allSettled([notifications.processOutbox(ctx('system')), notifications.processOutbox(ctx('system'))]);
    assert.ok(results.every((r) => r.status === 'fulfilled'), 'neither pass fails the batch');
    assert.equal(await coll(NOTIFICATIONS_COLLECTIONS.notifications).countDocuments({ accountId: account }), 1);
  });

  test('a mapped SMS event is suppressed without transactional SMS consent (OD-008)', async () => {
    const account = newId();
    contacts.set(account, { mobile: '+989121234567', email: null, locale: 'en' });
    await enqueue('registration_confirmed_source', {}); // no template
    await enqueue('checkout.activated', { accountId: account, tournamentId: newId(), registrationId: newId() });
    await notifications.processOutbox(ctx('system'));
    const delivery = await coll(NOTIFICATIONS_COLLECTIONS.deliveries).findOne({ accountId: account, channel: 'sms' });
    assert.equal(delivery?.['status'], 'suppressed');
    assert.equal(delivery?.['suppressedReason'], 'no_consent');
    // Privacy: the stored recipient is masked, not the full mobile.
    assert.notEqual(delivery?.['recipientMasked'], '+989121234567');
    assert.match(delivery?.['recipientMasked'] as string, /\*\*\*/);
  });
});

describe('inbox read state', () => {
  test('mark one and mark all update read state and unread count', async () => {
    const account = newId();
    await enqueue('payment.purchase_succeeded', { accountId: account, dragonCoin: 10 });
    await enqueue('prize.entitlement_paid', { accountId: account, tournamentId: newId() });
    await notifications.processOutbox(ctx('system'));
    assert.equal((await notifications.unreadCount(account)).unread, 2);
    const first = (await notifications.listInbox(account)).items[0];
    await notifications.markRead(ctx(account), account, first?._id as string);
    assert.equal((await notifications.unreadCount(account)).unread, 1);
    await notifications.markAllRead(ctx(account), account);
    assert.equal((await notifications.unreadCount(account)).unread, 0);
  });

  test('a notification is not readable/markable by another account (IDOR closed)', async () => {
    const account = newId();
    await enqueue('payment.purchase_succeeded', { accountId: account, dragonCoin: 10 });
    await notifications.processOutbox(ctx('system'));
    const id = (await notifications.listInbox(account)).items[0]?._id as string;
    await assert.rejects(() => notifications.markRead(ctx('other'), 'other', id), (e: { message?: string }) => e.message === 'Unknown notification.');
  });
});

describe('templates and preferences', () => {
  test('a template must be created and approved before it can render; approval is idempotent', async () => {
    const draft = await notifications.createTemplate(ctx('ops'), { templateKey: 'registration_confirmed', channel: 'sms', category: 'transactional', locales: { fa: { subject: '', body: 'ثبت‌نام شد {tournamentId}' }, en: { subject: '', body: 'Registered {tournamentId}' } } });
    assert.equal(draft.status, 'draft');
    const approved = await notifications.approveTemplate(ctx('ops'), draft._id);
    assert.equal(approved.status, 'approved');
    assert.equal((await notifications.approveTemplate(ctx('ops'), draft._id)).status, 'approved'); // idempotent
  });

  test('an unknown template key is rejected', async () => {
    await assert.rejects(() => notifications.createTemplate(ctx('ops'), { templateKey: 'not_a_key', channel: 'sms', category: 'transactional', locales: { fa: { subject: '', body: 'x' }, en: { subject: '', body: 'x' } } }), (e: { fieldErrors?: Array<{ code: string }> }) => e.fieldErrors?.[0]?.code === 'UNKNOWN_TEMPLATE_KEY');
  });

  test('enabling a gated preference class is refused (OD-008)', async () => {
    const account = newId();
    await assert.rejects(() => notifications.updatePreferences(ctx(account), account, { transactional: { sms: true } }), (e: { code?: string }) => e.code === 'NOTIFICATION_CLASS_DISABLED');
    await assert.rejects(() => notifications.updatePreferences(ctx(account), account, { marketing: { in_app: true } }), (e: { code?: string }) => e.code === 'NOTIFICATION_CLASS_DISABLED');
    // Defaults remain transactional-in-app only.
    assert.deepEqual(await notifications.getPreferences(account), { transactional: { in_app: true, sms: false, email: false }, marketing: { in_app: false, sms: false, email: false } });
  });
});

describe('delivery retry and dead-letter', () => {
  async function pendingDelivery(mobile: string): Promise<string> {
    const account = newId();
    contacts.set(account, { mobile, email: null, locale: 'en' });
    // An approved SMS template is needed to render.
    const t = await notifications.createTemplate(ctx('ops'), { templateKey: 'registration_confirmed', channel: 'sms', category: 'transactional', locales: { fa: { subject: '', body: 'ب' }, en: { subject: '', body: 'Registered' } } });
    await notifications.approveTemplate(ctx('ops'), t._id);
    const notificationId = newId();
    await coll(NOTIFICATIONS_COLLECTIONS.notifications).insertOne({ _id: notificationId, accountId: account, sourceEventId: newId(), templateKey: 'registration_confirmed', category: 'transactional', params: {}, correlationId: newId(), readAt: null, createdAt: utcNow() });
    const id = newId();
    await coll(NOTIFICATIONS_COLLECTIONS.deliveries).insertOne({ _id: id, notificationId, accountId: account, channel: 'sms', templateKey: 'registration_confirmed', category: 'transactional', recipientMasked: '+989***67', locale: 'en', status: 'pending', attempts: 0, maxAttempts: 3, lastError: null, suppressedReason: null, nextAttemptAt: new Date(Date.now() - 1000).toISOString(), correlationId: newId(), createdAt: utcNow(), updatedAt: utcNow() });
    return id;
  }

  test('a deliverable message sends on the first attempt', async () => {
    const id = await pendingDelivery('+989121234567');
    const result = await notifications.processDeliveries(ctx('system'));
    assert.equal(result.sent, 1);
    assert.equal((await coll(NOTIFICATIONS_COLLECTIONS.deliveries).findOne({ _id: id }))?.['status'], 'sent');
  });

  test('a permanently failing message retries up to the cap then dead-letters', async () => {
    const id = await pendingDelivery('+989120000'); // ends 0000 → always fails
    // Attempt 1 and 2 requeue; between runs make it due again.
    await notifications.processDeliveries(ctx('system'));
    await coll(NOTIFICATIONS_COLLECTIONS.deliveries).updateOne({ _id: id }, { $set: { nextAttemptAt: new Date(Date.now() - 1000).toISOString() } });
    await notifications.processDeliveries(ctx('system'));
    await coll(NOTIFICATIONS_COLLECTIONS.deliveries).updateOne({ _id: id }, { $set: { nextAttemptAt: new Date(Date.now() - 1000).toISOString() } });
    const result = await notifications.processDeliveries(ctx('system'));
    assert.equal(result.dead, 1);
    assert.equal((await coll(NOTIFICATIONS_COLLECTIONS.deliveries).findOne({ _id: id }))?.['status'], 'dead');
  });
});

describe('index definitions', () => {
  test('the declared unique indexes exist', async () => {
    const nIndexes = await coll(NOTIFICATIONS_COLLECTIONS.notifications).indexes();
    assert.equal(nIndexes.find((i) => i.name === 'notification_idem_unique')?.unique, true);
    const dIndexes = await coll(NOTIFICATIONS_COLLECTIONS.deliveries).indexes();
    assert.equal(dIndexes.find((i) => i.name === 'delivery_notification_channel_unique')?.unique, true);
    const tIndexes = await coll(NOTIFICATIONS_COLLECTIONS.templates).indexes();
    assert.equal(tIndexes.find((i) => i.name === 'template_key_channel_version_unique')?.unique, true);
  });
});
