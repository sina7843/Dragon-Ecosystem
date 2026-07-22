import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, NotFoundError, RateLimitError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import { consumeRateLimit } from '../identity/rate-limit.ts';
import { MODERATION_COLLECTIONS } from './collections.ts';
import {
  canCaseTransition,
  canSupportTransition,
  maskAccountId,
  type CaseState,
  type ModerationAction,
  type ModerationCaseRecord,
  type ModerationSubjectType,
  type RecoveryRequestRecord,
  type ReportRecord,
  type Severity,
  type SupportCaseRecord
} from './state.ts';

/**
 * Moderation, support, and recovery workflows (DRAGON-14). Reports collapse into one
 * open case per subject; moderators assign, set severity/emergency, and act
 * (suspend/remove/dismiss) with an audited reason. Support and recovery keep strict
 * boundaries — recovery is triage-only (no approval, OD-029) and never bypasses auth.
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export interface ModerationIdentityAccess {
  suspendAccount(accountId: EntityId, context: RequestContext, reason: string, emergency: boolean): Promise<void>;
}

export class ModerationService {
  readonly #database: Database;
  readonly #identity: ModerationIdentityAccess;

  constructor(database: Database, identity: ModerationIdentityAccess) {
    this.#database = database;
    this.#identity = identity;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #reports(db: Db = this.#db) {
    return db.collection<ReportRecord>(MODERATION_COLLECTIONS.reports);
  }
  #cases(db: Db = this.#db) {
    return db.collection<ModerationCaseRecord>(MODERATION_COLLECTIONS.cases);
  }
  #support(db: Db = this.#db) {
    return db.collection<SupportCaseRecord>(MODERATION_COLLECTIONS.supportCases);
  }
  #recovery(db: Db = this.#db) {
    return db.collection<RecoveryRequestRecord>(MODERATION_COLLECTIONS.recovery);
  }

  // --- Report intake + case creation ---

  /** Files a report; collapses into (or opens) exactly one open case for the subject. */
  async fileReport(context: RequestContext, reporterId: EntityId, input: { subjectType: ModerationSubjectType; subjectId: EntityId; reason: string; details?: string }): Promise<ReportRecord> {
    if (input.reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    const decision = await consumeRateLimit(this.#db, `moderation_report:${reporterId}`, 10, 3600);
    if (!decision.allowed) throw new RateLimitError();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const existing = await this.#cases().findOne({ subjectType: input.subjectType, subjectId: input.subjectId, state: { $in: ['open', 'assigned'] } });
      const caseId = existing?._id ?? newId();
      try {
        return await runUnitOfWork(this.#database, context, async (uow) => {
          const now = utcNow();
          if (existing === null) {
            const record: ModerationCaseRecord = { _id: caseId, subjectType: input.subjectType, subjectId: input.subjectId, severity: 'low', state: 'open', assignedTo: null, action: null, actionReason: null, emergency: false, reportCount: 0, correlationId: context.correlationId, version: 1, createdAt: now, updatedAt: now };
            await this.#cases(uow.db).insertOne(record, { session: uow.session });
          }
          const report: ReportRecord = { _id: newId(), reporterId, subjectType: input.subjectType, subjectId: input.subjectId, reason: input.reason, details: (input.details ?? '').slice(0, 2000), status: 'linked', caseId, correlationId: context.correlationId, createdAt: now };
          await this.#reports(uow.db).insertOne(report, { session: uow.session });
          await this.#cases(uow.db).updateOne({ _id: caseId }, { $inc: { reportCount: 1 }, $set: { updatedAt: now } }, { session: uow.session });
          uow.audit({ action: 'moderation.report_filed', resourceType: 'moderation_case', resourceId: caseId, after: { subjectType: input.subjectType, subjectId: input.subjectId } });
          uow.publish({ eventName: 'moderation.report_filed', eventVersion: 1, aggregateId: caseId, payload: { subjectType: input.subjectType } });
          return report;
        });
      } catch (error) {
        // A concurrent report created the case first (partial-unique index) — retry once and link.
        if (isDuplicateKey(error) && attempt === 0) continue;
        throw error;
      }
    }
    throw new ConflictError('MODERATION_CASE_CONFLICT', 'The case changed concurrently. Retry.');
  }

  // --- Moderator case operations ---

  async getCase(caseId: EntityId): Promise<ModerationCaseRecord | null> {
    return this.#cases().findOne({ _id: caseId });
  }
  async listCaseReports(caseId: EntityId): Promise<ReportRecord[]> {
    return this.#reports().find({ caseId }).sort({ createdAt: 1 }).limit(200).toArray();
  }

  /** Searchable case list (by state, severity, subject). */
  async listCases(query: { state?: string; severity?: string; subjectType?: string; subjectId?: string; cursor?: string; limit?: number }): Promise<Page<ModerationCaseRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = {};
    if (query.state) filter['state'] = query.state;
    if (query.severity) filter['severity'] = query.severity;
    if (query.subjectType) filter['subjectType'] = query.subjectType;
    if (query.subjectId) filter['subjectId'] = query.subjectId;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    const rows = await this.#cases().find(filter).sort({ createdAt: -1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as ModerationCaseRecord), nextCursor: page.nextCursor };
  }

  async assignCase(context: RequestContext, caseId: EntityId, assignee: EntityId, expectedVersion: number): Promise<ModerationCaseRecord> {
    return this.#mutateCase(context, caseId, expectedVersion, (c) => {
      if (c.state !== 'open' && c.state !== 'assigned') throw new ConflictError('INVALID_CASE_TRANSITION', 'Only an open case can be assigned.');
      return { set: { assignedTo: assignee, state: 'assigned' }, action: 'moderation.case_assigned' };
    });
  }

  async setSeverity(context: RequestContext, caseId: EntityId, severity: Severity, expectedVersion: number): Promise<ModerationCaseRecord> {
    return this.#mutateCase(context, caseId, expectedVersion, () => ({ set: { severity }, action: 'moderation.case_severity' }));
  }

  async setEmergency(context: RequestContext, caseId: EntityId, emergency: boolean, expectedVersion: number): Promise<ModerationCaseRecord> {
    return this.#mutateCase(context, caseId, expectedVersion, () => ({ set: { emergency }, action: 'moderation.case_emergency' }));
  }

  /** Resolves a case with an action: suspend the subject account, remove content, or dismiss. */
  async actOnCase(context: RequestContext, caseId: EntityId, input: { action: ModerationAction; reason: string; emergency?: boolean }, expectedVersion: number): Promise<ModerationCaseRecord> {
    if (input.reason.trim() === '') throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    const target: CaseState = input.action === 'dismiss' ? 'dismissed' : 'actioned';
    const current = await this.#cases().findOne({ _id: caseId });
    if (current === null) throw new NotFoundError('Unknown case.');
    if (!canCaseTransition(current.state, target)) throw new ConflictError('INVALID_CASE_TRANSITION', `Cannot move a case from ${current.state} to ${target}.`);
    if (input.action === 'suspend') {
      if (current.subjectType !== 'user') throw new ValidationError('Only a user subject can be suspended.', [{ field: 'action', code: 'INVALID_MODERATION_ACTION', message: 'Suspension applies to a user.' }]);
      await this.#identity.suspendAccount(current.subjectId, context, input.reason, input.emergency ?? current.emergency);
    }
    return this.#mutateCase(context, caseId, expectedVersion, (c) => {
      if (!canCaseTransition(c.state, target)) throw new ConflictError('INVALID_CASE_TRANSITION', 'The case changed. Reload and retry.');
      return { set: { state: target, action: input.action, actionReason: input.reason }, action: `moderation.case_${input.action}`, reason: input.reason, highRisk: true };
    });
  }

  async #mutateCase(context: RequestContext, caseId: EntityId, expectedVersion: number, apply: (c: ModerationCaseRecord) => { set: Partial<ModerationCaseRecord>; action: string; reason?: string; highRisk?: boolean }): Promise<ModerationCaseRecord> {
    const current = await this.#cases().findOne({ _id: caseId });
    if (current === null) throw new NotFoundError('Unknown case.');
    const { set, action, reason } = apply(current);
    return runUnitOfWork(this.#database, context, async (uow) => {
      const now = utcNow();
      const updated = await this.#cases(uow.db).updateOne({ _id: caseId, version: expectedVersion }, { $set: { ...set, updatedAt: now }, $inc: { version: 1 } }, { session: uow.session });
      if (updated.matchedCount === 0) throw new ConflictError('STALE_CASE_VERSION', 'The case changed since you opened it. Reload and retry.');
      uow.audit({ action, resourceType: 'moderation_case', resourceId: caseId, before: { state: current.state }, after: { ...set }, reason: reason ?? null });
      return { ...current, ...set, version: current.version + 1, updatedAt: now };
    });
  }

  // --- Support cases ---

  async openSupportCase(context: RequestContext, requesterId: EntityId, input: { category: string; subject: string; body: string }): Promise<SupportCaseRecord> {
    if (input.subject.trim() === '' || input.body.trim() === '') throw new ValidationError('A subject and message are required.', [{ field: 'subject', code: 'REQUIRED', message: 'Provide a subject and message.' }]);
    const decision = await consumeRateLimit(this.#db, `support_case:${requesterId}`, 10, 3600);
    if (!decision.allowed) throw new RateLimitError();
    const now = utcNow();
    const record: SupportCaseRecord = { _id: newId(), requesterId, category: input.category.slice(0, 64), subject: input.subject.slice(0, 200), body: input.body.slice(0, 4000), state: 'open', assignedTo: null, resolutionNote: null, version: 1, createdAt: now, updatedAt: now };
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#support(uow.db).insertOne(record, { session: uow.session });
      uow.audit({ action: 'support.case_opened', resourceType: 'support_case', resourceId: record._id, after: { category: record.category } });
    });
    return record;
  }

  async getSupportCase(requesterId: EntityId, caseId: EntityId, opts: { asOperator: boolean } = { asOperator: false }): Promise<SupportCaseRecord | null> {
    return this.#support().findOne(opts.asOperator ? { _id: caseId } : { _id: caseId, requesterId });
  }
  async listMySupport(requesterId: EntityId, query: { cursor?: string; limit?: number } = {}): Promise<Page<SupportCaseRecord>> {
    return this.#pageSupport({ requesterId }, query);
  }
  async listSupport(query: { state?: string; cursor?: string; limit?: number } = {}): Promise<Page<SupportCaseRecord>> {
    const filter: Record<string, unknown> = {};
    if (query.state) filter['state'] = query.state;
    return this.#pageSupport(filter, query);
  }
  async #pageSupport(baseFilter: Record<string, unknown>, query: { cursor?: string; limit?: number }): Promise<Page<SupportCaseRecord>> {
    const limit = clampLimit(query.limit);
    const filter = { ...baseFilter };
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    const rows = await this.#support().find(filter).sort({ createdAt: -1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as unknown as SupportCaseRecord), nextCursor: page.nextCursor };
  }

  async transitionSupport(context: RequestContext, caseId: EntityId, to: 'assigned' | 'resolved' | 'closed', input: { assignee?: EntityId; note?: string; expectedVersion: number }): Promise<SupportCaseRecord> {
    const current = await this.#support().findOne({ _id: caseId });
    if (current === null) throw new NotFoundError('Unknown support case.');
    if (!canSupportTransition(current.state, to)) throw new ConflictError('INVALID_SUPPORT_TRANSITION', `Cannot move a support case from ${current.state} to ${to}.`);
    const now = utcNow();
    const set: Partial<SupportCaseRecord> = { state: to, updatedAt: now };
    if (to === 'assigned' && input.assignee !== undefined) set.assignedTo = input.assignee;
    if (to === 'resolved') set.resolutionNote = (input.note ?? '').slice(0, 2000);
    return runUnitOfWork(this.#database, context, async (uow) => {
      const updated = await this.#support(uow.db).updateOne({ _id: caseId, version: input.expectedVersion }, { $set: set, $inc: { version: 1 } }, { session: uow.session });
      if (updated.matchedCount === 0) throw new ConflictError('STALE_SUPPORT_VERSION', 'The support case changed. Reload and retry.');
      uow.audit({ action: `support.case_${to}`, resourceType: 'support_case', resourceId: caseId, before: { state: current.state }, after: { state: to } });
      return { ...current, ...set, version: current.version + 1 };
    });
  }

  // --- Account recovery review (OD-029: triage only, no approval) ---

  async createRecovery(context: RequestContext, input: { accountId: EntityId; reason: string }): Promise<RecoveryRequestRecord> {
    const now = utcNow();
    const record: RecoveryRequestRecord = { _id: newId(), accountId: input.accountId, reason: input.reason.slice(0, 2000), state: 'pending', reviewedBy: null, reviewNote: null, version: 1, createdAt: now, updatedAt: now };
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#recovery(uow.db).insertOne(record, { session: uow.session });
      uow.audit({ action: 'recovery.requested', resourceType: 'recovery_request', resourceId: record._id });
    });
    return record;
  }

  /**
   * Reviews a recovery request. Support may only triage — mark reviewed or rejected.
   * Approval that would restore access is disabled under OD-029; recovery review never
   * grants a session or bypasses authentication.
   */
  async reviewRecovery(context: RequestContext, requestId: EntityId, input: { decision: string; note: string; expectedVersion: number }): Promise<RecoveryRequestRecord> {
    if (input.decision === 'approved' || input.decision === 'approve') throw new ConflictError('RECOVERY_APPROVAL_DISABLED', 'Recovery approval is not available; escalate through the approved recovery process.');
    if (input.decision !== 'reviewed' && input.decision !== 'rejected') throw new ValidationError('The decision is not valid.', [{ field: 'decision', code: 'INVALID_RECOVERY_DECISION', message: 'Use reviewed or rejected.' }]);
    const decision: RecoveryRequestRecord['state'] = input.decision;
    const current = await this.#recovery().findOne({ _id: requestId });
    if (current === null) throw new NotFoundError('Unknown recovery request.');
    if (current.state !== 'pending') throw new ConflictError('RECOVERY_NOT_PENDING', 'This request was already handled.');
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const updated = await this.#recovery(uow.db).updateOne({ _id: requestId, state: 'pending', version: input.expectedVersion }, { $set: { state: decision, reviewedBy: context.actor.accountId ?? 'system', reviewNote: input.note.slice(0, 2000), updatedAt: now }, $inc: { version: 1 } }, { session: uow.session });
      if (updated.matchedCount === 0) throw new ConflictError('RECOVERY_NOT_PENDING', 'This request changed. Reload and retry.');
      uow.audit({ action: `recovery.${decision}`, resourceType: 'recovery_request', resourceId: requestId, reason: input.note });
      return { ...current, state: decision, reviewedBy: context.actor.accountId ?? 'system', reviewNote: input.note, version: current.version + 1, updatedAt: now };
    });
  }

  /** Support-facing recovery list with masked account identifiers (no sensitive evidence). */
  async listRecovery(query: { state?: string; cursor?: string; limit?: number } = {}): Promise<Page<Omit<RecoveryRequestRecord, 'accountId'> & { accountMasked: string }>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = {};
    if (query.state) filter['state'] = query.state;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) filter['$or'] = [{ createdAt: { $lt: cursor.sortValue } }, { createdAt: cursor.sortValue, _id: { $gt: cursor.id } }];
    const rows = await this.#recovery().find(filter).sort({ createdAt: -1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.createdAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, accountId, ...r }) => ({ ...r, accountMasked: maskAccountId(accountId) }) as unknown as Omit<RecoveryRequestRecord, 'accountId'> & { accountMasked: string }), nextCursor: page.nextCursor };
  }
}
