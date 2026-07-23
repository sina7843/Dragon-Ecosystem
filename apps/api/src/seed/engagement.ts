/**
 * Engagement + operations demo data through the real services: in-app notifications
 * (produced by draining the outbox the earlier steps enqueued), moderation cases,
 * support cases, recovery triage, analytics, alerts, and a bounded jobs run. No SMS/email
 * is ever sent (gated off); recipients stay masked; recovery approval stays disabled.
 * Ownership is tracked only in the demo registry — never as a marker on a domain row.
 */
import type { SeedSummary } from './harness.ts';
import { demoRef } from './harness.ts';
import type { DemoRegistry } from './registry.ts';
import type { UserRegistry } from './users.ts';
import { accountContext, sysContext, type Services } from './wiring.ts';

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
