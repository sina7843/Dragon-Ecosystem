/**
 * Engagement + operations demo data through the real services: in-app notifications
 * (produced by draining the outbox the earlier steps enqueued), moderation cases,
 * support cases, recovery triage, analytics, alerts, and a bounded jobs run. No SMS/email
 * is ever sent (gated off); recipients stay masked; recovery approval stays disabled.
 * Ownership is tracked only in the demo registry — never as a marker on a domain row.
 */
import { buildNotifications } from '../server.ts';
import type { SeedSummary } from './harness.ts';
import { demoRef } from './harness.ts';
import type { DemoRegistry } from './registry.ts';
import type { UserRegistry } from './users.ts';
import { accountContext, sysContext, type Services } from './wiring.ts';

const SMS_TEMPLATES: readonly { key: string; fa: string; en: string }[] = [
  { key: 'registration_approved', fa: 'ثبت‌نام شما در مسابقه تأیید شد.', en: 'Your tournament registration has been approved.' },
  { key: 'registration_confirmed', fa: 'ثبت‌نام شما نهایی شد.', en: 'Your tournament registration is confirmed.' }
];

/** Approved SMS templates, without which every delivery settles as `no_template`. */
async function seedNotificationTemplates(services: Services, summary: SeedSummary): Promise<void> {
  let created = 0;
  let reused = 0;
  for (const t of SMS_TEMPLATES) {
    const existing = await services.db
      .collection('notification_templates')
      .findOne({ templateKey: t.key, channel: 'sms', status: 'approved' } as never);
    if (existing !== null) {
      reused += 1;
      continue;
    }
    const draft = await services.notifications.createTemplate(sysContext(), {
      templateKey: t.key,
      channel: 'sms',
      category: 'transactional',
      locales: { fa: { subject: 'دراگون', body: t.fa }, en: { subject: 'Dragon', body: t.en } }
    });
    await services.notifications.approveTemplate(sysContext(), draft._id);
    created += 1;
  }
  summary.record('notification templates', created, reused);
}

/** Deliveries deliberately left in the gated state so it stays visible beside the sent ones. */
const KEEP_SUPPRESSED = 6;

/**
 * Gives the delivery log more than one outcome to show.
 *
 * Both notification channels are gated off by default, so every delivery the demo produced
 * settled as `suppressed / channel_disabled` — correct fail-closed behaviour, but it left
 * the admin delivery view with a single uniform status and nothing to compare. This step
 * settles all but the oldest few through a second notifications instance whose channel
 * gates are on, so the log shows delivered and gated side by side.
 *
 * That instance is pinned to the MOCK provider regardless of configuration: the mock
 * derives its outcome from the recipient and performs no network call, so the seeder can
 * never send a real message even if a live SMS provider is configured here.
 *
 * The gated slice is re-established rather than merely preserved, because an earlier run
 * settled every delivery. That is a demo-shaping write on a log the application only
 * appends to, and it is confined to this development-only step.
 */
async function seedDeliveryOutcomes(services: Services, summary: SeedSummary): Promise<void> {
  await seedNotificationTemplates(services, summary);
  const deliveries = services.db.collection('notification_deliveries');
  const all = (await deliveries
    .find({}, { projection: { _id: 1, status: 1 } })
    .sort({ createdAt: 1, _id: 1 })
    .toArray()) as unknown as Array<{ _id: string; status: string }>;
  if (all.length === 0) return;

  const gate = all.slice(0, KEEP_SUPPRESSED).filter((d) => d.status !== 'suppressed').map((d) => d._id);
  const send = all.slice(KEEP_SUPPRESSED).filter((d) => d.status === 'suppressed').map((d) => d._id);
  if (gate.length > 0) {
    await deliveries.updateMany({ _id: { $in: gate } } as never, { $set: { status: 'suppressed', suppressedReason: 'channel_disabled', lastError: null } });
  }
  if (send.length === 0) {
    summary.record('notification deliveries', 0, all.length);
    return;
  }
  const requeued = await deliveries.updateMany(
    { _id: { $in: send } } as never,
    { $set: { status: 'pending', suppressedReason: null, nextAttemptAt: new Date().toISOString() } }
  );
  const mockOnly = {
    ...services.config,
    notificationsSmsEnabled: true,
    notificationsEmailEnabled: true,
    sms: { provider: 'mock' as const, kavenegar: null }
  };
  const notifier = buildNotifications(services.database, mockOnly).service;
  // Retries are backed off, so several passes are needed to reach the dead-letter state.
  let sent = 0;
  for (let pass = 0; pass < 4; pass += 1) {
    const result = await notifier.processDeliveries(sysContext(), { limit: 200 });
    sent += result.sent;
    if (result.sent === 0 && result.failed === 0 && result.dead === 0) break;
    // Bring the backed-off retries forward so the seeder does not have to wait for them.
    await deliveries.updateMany({ status: 'pending' }, { $set: { nextAttemptAt: new Date().toISOString() } });
  }
  summary.record('notification deliveries', sent, requeued.modifiedCount - sent);
}

/**
 * Configuration keys, so the versioned-settings console has something to show.
 *
 * The propose/approve workflow existed with no data at all: every key list was empty, so
 * neither an active value nor the dual-control path was reviewable. This seeds one of
 * each — a low-risk key that activates on proposal, and a high-risk one that stays
 * `pending_approval` because approving it requires a *different* operator, which is
 * exactly the state a reviewer needs to see.
 *
 * The proposals go through the real service, so the risk classification, versioning, and
 * audit trail are the genuine ones. Guarded on the key already existing, so a rerun adds
 * no version.
 */
const CONFIG_SEED: readonly { key: string; value: unknown; reason: string }[] = [
  { key: 'platform.support_hours', value: '09:00-18:00 Asia/Tehran', reason: 'Demo: published support window.' },
  { key: 'tournaments.default_capacity', value: 16, reason: 'Demo: default field size for a new tournament.' },
  // High-risk prefix (finance.), so this one is stored awaiting a second operator.
  { key: 'finance.max_refund_toman', value: 5_000_000, reason: 'Demo: proposed refund ceiling, awaiting approval.' }
];

async function seedConfiguration(services: Services, summary: SeedSummary, users: UserRegistry): Promise<void> {
  const proposer = users.get('op-finance') ?? users.get('admin-super');
  if (proposer === undefined) return;
  const actor = { context: accountContext(proposer.accountId, ['finance_operator']), isSuperAdmin: false };
  let created = 0;
  let reused = 0;
  for (const entry of CONFIG_SEED) {
    const existing = await services.db.collection('configuration_versions').findOne({ key: entry.key } as never);
    if (existing !== null) {
      reused += 1;
      continue;
    }
    await services.admin.proposeConfiguration(actor, entry);
    created += 1;
  }
  summary.record('configuration keys', created, reused);
}

export async function seedEngagement(services: Services, registry: DemoRegistry, summary: SeedSummary, users: UserRegistry): Promise<void> {
  const db = services.db;

  // 1. Notifications: drain the outbox that approvals/purchases enqueued (idempotent:
  //    one notification per account+source-event+template). Notifications are append-only,
  //    so ownership is not marked on the row; they are preserved across reset.
  const before = await db.collection('notifications').countDocuments();
  await services.notifications.processOutbox(sysContext(), { limit: 1000 });
  const after = await db.collection('notifications').countDocuments();
  const reader = users.get('player-02');
  // Only mark read when new notifications arrived, so a rerun writes nothing.
  if (reader !== undefined && after > before) await services.notifications.markAllRead(accountContext(reader.accountId), reader.accountId);
  summary.record('notifications', Math.max(0, after - before), after - Math.max(0, after - before));

  await seedDeliveryOutcomes(services, summary);
  await seedConfiguration(services, summary, users);

  // 2. Moderation — one open case per subject (user/content/tournament), collapsed.
  const contentDoc = await db.collection('content_items').findOne({ 'slugs.en': 'weekly-recap' } as never);
  const tournamentDoc = await db.collection('tournaments').findOne({ slug: 'nova-open-cup' } as never);
  const reporter = users.get('player-03');
  const moderator = users.get('moderator');
  const subjects: { type: 'user' | 'content' | 'tournament'; id: string | undefined; reason: string }[] = [
    { type: 'user', id: users.get('player-09')?.accountId, reason: 'Demo report: unsporting conduct.' },
    { type: 'content', id: contentDoc?._id as unknown as string | undefined, reason: 'Demo report: content needs review.' },
    { type: 'tournament', id: tournamentDoc?._id as unknown as string | undefined, reason: 'Demo report: rules dispute.' }
  ];
  let cases = 0;
  if (reporter !== undefined) {
    for (const s of subjects) {
      if (s.id === undefined) continue;
      const existing = await db.collection('moderation_cases').findOne({ subjectType: s.type, subjectId: s.id } as never);
      if (existing !== null) continue;
      const report = await services.moderation.fileReport(accountContext(reporter.accountId), reporter.accountId, {
        subjectType: s.type,
        subjectId: s.id,
        reason: s.reason
      });
      // The case is mutable content — tracked as resettable; the append-only report is not.
      if (report.caseId !== null) {
        await registry.record({ demoSeedKey: demoRef('moderation', `${s.type}:${s.id}`), domainType: 'moderation_case', collection: 'moderation_cases', recordId: report.caseId, resettable: true });
      }
      cases += 1;
    }

    // Assign, prioritise, and dismiss to show varied case states.
    if (moderator !== undefined) {
      const openCases = await db.collection('moderation_cases').find({ state: 'open' } as never).limit(3).toArray();
      const modCtx = () => accountContext(moderator.accountId, ['community_moderator']);
      if (openCases[0] !== undefined) {
        try {
          await services.moderation.assignCase(modCtx(), openCases[0]._id as unknown as string, moderator.accountId, openCases[0].version as number);
          await services.moderation.setSeverity(modCtx(), openCases[0]._id as unknown as string, 'high', (openCases[0].version as number) + 1);
        } catch { /* version race: leave as-is */ }
      }
      if (openCases[1] !== undefined) {
        try {
          await services.moderation.actOnCase(modCtx(), openCases[1]._id as unknown as string, { action: 'dismiss', reason: 'Demo: no action needed.' }, openCases[1].version as number);
        } catch { /* leave as-is */ }
      }
    }
  }
  summary.record('moderation cases', cases, 0);

  // 3. Support cases + recovery triage (mutable content, tracked as resettable).
  let support = 0;
  const requester = users.get('player-04');
  if (requester !== undefined && !(await registry.has(demoRef('support', 'player-04')))) {
    const c = await services.moderation.openSupportCase(accountContext(requester.accountId), requester.accountId, {
      category: 'account',
      subject: 'Demo support request',
      body: 'Fictional demo support case for the local environment.'
    });
    await registry.record({ demoSeedKey: demoRef('support', 'player-04'), domainType: 'support_case', collection: 'support_cases', recordId: c._id, resettable: true });
    support += 1;
  }
  summary.record('support cases', support, 0);

  let recovery = 0;
  const recoverer = users.get('player-05');
  if (recoverer !== undefined) {
    const existing = await db.collection('recovery_requests').findOne({ accountId: recoverer.accountId } as never);
    if (existing === null) {
      try {
        await services.moderation.createRecovery(accountContext(recoverer.accountId), { accountId: recoverer.accountId, reason: 'Demo: lost access to device.' });
        const saved = await db.collection('recovery_requests').findOne({ accountId: recoverer.accountId } as never);
        if (saved !== null) {
          await registry.record({ demoSeedKey: demoRef('recovery', 'player-05'), domainType: 'recovery_request', collection: 'recovery_requests', recordId: saved._id as unknown as string, resettable: true });
        }
        recovery += 1;
      } catch { /* recovery disabled paths: skip */ }
    }
  }
  summary.record('recovery triage', recovery, 0);

  // 4. Operations — analytics, alerts, and a bounded jobs run. Guarded by the registry so
  //    reruns don't accumulate ops rows. Analytics/alerts are append-only (not reset).
  if (!(await registry.has(demoRef('ops', 'alert')))) {
    const opsCtx = sysContext();
    const idOf = (k: string): { accountId: string } | Record<string, never> => {
      const a = users.get(k)?.accountId;
      return a === undefined ? {} : { accountId: a };
    };
    await services.operations.track(opsCtx, { name: 'demo.page_view', essential: true, ...idOf('player-01') });
    await services.operations.track(opsCtx, { name: 'demo.feature_used', essential: false, consented: true, ...idOf('player-02') });
    await services.operations.track(opsCtx, { name: 'demo.feature_used', essential: false, consented: false, ...idOf('player-03') });
    await services.operations.raiseAlert(opsCtx, { category: 'queue', severity: 'warning', message: 'Demo alert: queue depth elevated.' });
    const ack = await services.operations.raiseAlert(opsCtx, { category: 'payment_mock', severity: 'warning', message: 'Demo alert: mock payment anomaly.' });
    const ackId = (ack as { _id?: string } | null)?._id;
    if (ackId !== undefined) {
      await registry.record({ demoSeedKey: demoRef('ops', 'alert'), domainType: 'ops_alert', collection: 'ops_alerts', recordId: ackId, resettable: false });
      try {
        await services.operations.acknowledgeAlert(opsCtx, ackId);
      } catch { /* shape differs: skip ack */ }
    }
    await services.operations.runJobs(sysContext(), { limit: 50 });
    summary.record('ops (analytics/alerts/jobs)', 1, 0);
  } else {
    summary.record('ops (analytics/alerts/jobs)', 0, 1);
  }
}
