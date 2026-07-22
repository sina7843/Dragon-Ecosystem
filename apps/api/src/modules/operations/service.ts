import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import { createRequestContext, SYSTEM_ACTOR, type RequestContext } from '../../shared/context.ts';
import { NotFoundError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import { OPERATIONS_COLLECTIONS } from './collections.ts';
import type { AlertCategory, AlertRecord, AlertSeverity, AnalyticsErrorRecord, AnalyticsEventRecord, BoundedProps, JobExecutionRecord } from './state.ts';

/**
 * Operations service (DRAGON-14): consent-aware pseudonymous analytics, redacted
 * error capture, a bounded job runner with observability, and failure alerts +
 * metrics. No external analytics tracker is activated (OD-026); everything lands in
 * the internal sink.
 */

const PSEUDONYM_SALT = 'dragon-analytics-pseudonym-v1';
// OD-026: no external analytics tracker is integrated. An event is forwarded externally
// only when the gate is enabled AND a tracker exists — the latter is never true today,
// so nothing is ever forwarded regardless of the gate.
const EXTERNAL_TRACKER_INTEGRATED = false;
function pseudonym(accountId: string): string {
  return createHash('sha256').update(`${PSEUDONYM_SALT}:${accountId}`).digest('hex').slice(0, 32);
}
function boundProps(props: Readonly<Record<string, unknown>> | undefined): BoundedProps {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}
/** Strips stack traces / control chars and truncates — never a raw stack or secret. */
function redact(message: string): string {
  const firstLine = message.split(String.fromCharCode(10))[0] ?? '';
  let result = '';
  for (const ch of firstLine) {
    if (ch.charCodeAt(0) >= 32 && result.length < 300) result += ch;
  }
  return result;
}

export interface JobRunner {
  readonly name: string;
  run(context: RequestContext, limit: number): Promise<BoundedProps>;
}
export interface OperationsConfigView {
  analyticsExternalEnabled: boolean;
}

export class OperationsService {
  readonly #database: Database;
  readonly #config: OperationsConfigView;
  readonly #jobs: readonly JobRunner[];

  constructor(database: Database, config: OperationsConfigView, jobs: readonly JobRunner[]) {
    this.#database = database;
    this.#config = config;
    this.#jobs = jobs;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #events(db: Db = this.#db) {
    return db.collection<AnalyticsEventRecord>(OPERATIONS_COLLECTIONS.analyticsEvents);
  }
  #errors(db: Db = this.#db) {
    return db.collection<AnalyticsErrorRecord>(OPERATIONS_COLLECTIONS.analyticsErrors);
  }
  #alerts(db: Db = this.#db) {
    return db.collection<AlertRecord>(OPERATIONS_COLLECTIONS.alerts);
  }
  #jobExecutions(db: Db = this.#db) {
    return db.collection<JobExecutionRecord>(OPERATIONS_COLLECTIONS.jobExecutions);
  }

  systemContext(): RequestContext {
    return createRequestContext(newId(), SYSTEM_ACTOR);
  }

  // --- Analytics (consent-aware, pseudonymous, internal-only) ---

  /**
   * Records an analytics event. An essential event is always recorded; a nonessential
   * event is dropped without consent. Accounts are stored under a pseudonym, never the
   * raw id. External forwarding is never performed (OD-026); the gate only governs a
   * would-be forward that stays disabled.
   */
  async track(context: RequestContext, input: { name: string; essential: boolean; accountId?: string; props?: Readonly<Record<string, unknown>>; consented?: boolean }): Promise<{ recorded: boolean; forwardedExternally: boolean }> {
    if (!input.essential && input.consented !== true) return { recorded: false, forwardedExternally: false };
    const record: AnalyticsEventRecord = { _id: newId(), name: input.name, essential: input.essential, pseudonymId: input.accountId === undefined ? null : pseudonym(input.accountId), props: boundProps(input.props), correlationId: context.correlationId, createdAt: utcNow() };
    await this.#events().insertOne(record);
    // The event is always in the internal sink above. External forwarding requires both
    // the OD-026 gate and an integrated tracker; the latter does not exist, so this is
    // false today. Reading the gate here keeps it wired for when a tracker is added.
    const forwardedExternally = this.#config.analyticsExternalEnabled && EXTERNAL_TRACKER_INTEGRATED;
    return { recorded: true, forwardedExternally };
  }

  async captureError(context: RequestContext, input: { code: string; message: string; context?: Readonly<Record<string, unknown>> }): Promise<void> {
    await this.#errors().insertOne({ _id: newId(), code: input.code.slice(0, 64), message: redact(input.message), context: boundProps(input.context), correlationId: context.correlationId, createdAt: utcNow() });
  }

  // --- Jobs (bounded runner with observability) ---

  /** Runs each registered job once, recording a job execution and alerting on failure. */
  async runJobs(context: RequestContext, options: { limit?: number } = {}): Promise<Array<{ jobName: string; status: 'succeeded' | 'failed'; result?: BoundedProps; error?: string }>> {
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    const summary: Array<{ jobName: string; status: 'succeeded' | 'failed'; result?: BoundedProps; error?: string }> = [];
    for (const job of this.#jobs) {
      const executionId = newId();
      const startedAt = utcNow();
      await this.#jobExecutions().insertOne({ _id: executionId, jobName: job.name, status: 'running', startedAt, finishedAt: null, result: null, error: null, correlationId: context.correlationId });
      try {
        const result = await job.run(context, limit);
        await this.#jobExecutions().updateOne({ _id: executionId }, { $set: { status: 'succeeded', finishedAt: utcNow(), result } });
        summary.push({ jobName: job.name, status: 'succeeded', result });
      } catch (error) {
        const message = redact(error instanceof Error ? error.message : String(error));
        await this.#jobExecutions().updateOne({ _id: executionId }, { $set: { status: 'failed', finishedAt: utcNow(), error: message } });
        await this.raiseAlert(context, { category: 'queue', severity: 'critical', message: `job ${job.name} failed`, detail: { jobName: job.name, error: message } });
        summary.push({ jobName: job.name, status: 'failed', error: message });
      }
    }
    return summary;
  }

  // --- Alerts + health/metrics ---

  async raiseAlert(context: RequestContext, input: { category: AlertCategory; severity: AlertSeverity; message: string; detail?: Readonly<Record<string, unknown>> }): Promise<AlertRecord> {
    const now = utcNow();
    const record: AlertRecord = { _id: newId(), category: input.category, severity: input.severity, message: input.message.slice(0, 300), detail: boundProps(input.detail), status: 'open', acknowledgedBy: null, correlationId: context.correlationId, createdAt: now, updatedAt: now };
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#alerts(uow.db).insertOne(record, { session: uow.session });
      uow.audit({ action: 'ops.alert_raised', resourceType: 'ops_alert', resourceId: record._id, after: { category: record.category, severity: record.severity } });
    });
    return record;
  }

  /** Inspects failure signals (Mongo, dead-letter queue, failed jobs) and raises alerts. */
  async checkHealth(context: RequestContext): Promise<{ metrics: Awaited<ReturnType<OperationsService['metrics']>>; raised: number }> {
    let raised = 0;
    let mongoOk = true;
    try {
      mongoOk = await this.#database.ping();
    } catch {
      mongoOk = false;
    }
    if (!mongoOk) {
      await this.raiseAlert(context, { category: 'mongo', severity: 'critical', message: 'MongoDB persistence check failed' });
      raised += 1;
    }
    const metrics = await this.metrics();
    if (metrics.deadLetterDeliveries > 0) {
      await this.raiseAlert(context, { category: 'queue', severity: 'warning', message: 'notification deliveries in dead-letter', detail: { count: metrics.deadLetterDeliveries } });
      raised += 1;
    }
    return { metrics, raised };
  }

  async metrics(): Promise<{ pendingOutbox: number; deadLetterDeliveries: number; failedJobs: number; openAlerts: number }> {
    const [pendingOutbox, deadLetterDeliveries, failedJobs, openAlerts] = await Promise.all([
      this.#db.collection('domain_event_outbox').countDocuments({ state: 'pending' }),
      this.#db.collection('notification_deliveries').countDocuments({ status: 'dead' }),
      this.#jobExecutions().countDocuments({ status: 'failed' }),
      this.#alerts().countDocuments({ status: 'open' })
    ]);
    return { pendingOutbox, deadLetterDeliveries, failedJobs, openAlerts };
  }

  async listAlerts(query: { status?: string; category?: string; cursor?: string; limit?: number } = {}): Promise<Page<AlertRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = {};
    if (query.status) filter['status'] = query.status;
    if (query.category) filter['category'] = query.category;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    const rows = await this.#alerts().find(filter).sort({ createdAt: -1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as AlertRecord), nextCursor: page.nextCursor };
  }

  async acknowledgeAlert(context: RequestContext, alertId: EntityId): Promise<AlertRecord> {
    const alert = await this.#alerts().findOne({ _id: alertId });
    if (alert === null) throw new NotFoundError('Unknown alert.');
    if (alert.status === 'acknowledged') return alert;
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#alerts(uow.db).updateOne({ _id: alertId, status: 'open' }, { $set: { status: 'acknowledged', acknowledgedBy: context.actor.accountId ?? 'system', updatedAt: now } }, { session: uow.session });
      // A concurrent acknowledge won the race — do not write a false audit for a no-op.
      if (result.matchedCount === 0) return (await this.#alerts(uow.db).findOne({ _id: alertId }, { session: uow.session })) ?? alert;
      uow.audit({ action: 'ops.alert_acknowledged', resourceType: 'ops_alert', resourceId: alertId });
      return { ...alert, status: 'acknowledged', acknowledgedBy: context.actor.accountId ?? 'system', updatedAt: now };
    });
  }

  async listJobExecutions(query: { jobName?: string; limit?: number } = {}): Promise<JobExecutionRecord[]> {
    const filter: Record<string, unknown> = {};
    if (query.jobName) filter['jobName'] = query.jobName;
    return this.#jobExecutions().find(filter).sort({ startedAt: -1 }).limit(clampLimit(query.limit)).toArray();
  }
}
