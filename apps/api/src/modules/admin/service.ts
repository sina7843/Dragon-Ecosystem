import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import { COLLECTIONS } from '../../shared/db/collections.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import {
  isHighRiskConfigKey,
  isKnownRole,
  normalizeConfigKey,
  permissionsForRoles,
  WILDCARD
} from '../../shared/authz/permissions.ts';
import {
  clampLimit,
  decodeCursor,
  toPage,
  type Page
} from '../../shared/pagination.ts';
import type { AuditEvent } from '../../shared/audit.ts';
import {
  configurationVersions,
  GLOBAL_SCOPE_ID,
  GLOBAL_SCOPE_TYPE,
  roleAssignments,
  type ConfigurationVersionRecord,
  type RoleAssignmentRecord
} from './store.ts';

/**
 * Administration domain service: role assignment, versioned configuration with
 * dual control, and immutable audit search and export (Requirements sections 6, 16, 28).
 *
 * Every mutation runs through a unit of work, so its audit event is written in
 * the same transaction and can never be lost (AUDIT-004, EVENT-001).
 */

export interface Actor {
  readonly context: RequestContext;
  /** From the resolved effective permissions; drives emergency audit and escalation guards. */
  readonly isSuperAdmin: boolean;
}

export interface AssignRoleInput {
  readonly accountId: EntityId;
  readonly role: string;
  readonly scope?: { type: string; id: string };
  readonly reason: string;
}

export interface ConfigProposalInput {
  readonly key: string;
  readonly value: unknown;
  readonly reason: string;
}

const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export class AdminService {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  get #db(): Db {
    return this.#database.db;
  }

  // --- Role assignment (AUTH-014, ADMIN-004, section 6.2) ---

  async assignRole(actor: Actor, input: AssignRoleInput): Promise<RoleAssignmentRecord> {
    if (!isKnownRole(input.role)) throw new ValidationError('Unknown role.');
    if (input.reason.trim() === '') throw new ValidationError('A reason is required.');

    // Privilege-escalation guard: only a super administrator may grant a role that
    // carries the wildcard (i.e. super administrator itself).
    if (permissionsForRoles([input.role]).has(WILDCARD) && !actor.isSuperAdmin) {
      throw new ForbiddenError('Only a super administrator can grant that role.');
    }

    const scopeType = input.scope?.type ?? GLOBAL_SCOPE_TYPE;
    const scopeId = input.scope?.id ?? GLOBAL_SCOPE_ID;
    const record: RoleAssignmentRecord = {
      _id: newId(),
      accountId: input.accountId,
      role: input.role,
      scopeType,
      scopeId,
      grantedBy: actor.context.actor.accountId ?? 'system',
      grantedAt: utcNow(),
      revokedAt: null
    };

    try {
      await runUnitOfWork(this.#database, actor.context, async (uow) => {
        await roleAssignments(uow.db).insertOne(record, { session: uow.session });
        uow.audit({
          action: 'role.assigned',
          resourceType: 'account',
          resourceId: input.accountId,
          after: { role: input.role, scopeType, scopeId },
          reason: input.reason,
          emergency: actor.isSuperAdmin
        });
      });
    } catch (error) {
      // The unique index rejects a duplicate active grant of the same role+scope.
      if (isDuplicateKey(error)) throw new ConflictError('ROLE_ALREADY_ASSIGNED', 'That role is already assigned.');
      throw error;
    }
    return record;
  }

  async revokeRole(actor: Actor, assignmentId: EntityId, reason: string): Promise<void> {
    if (reason.trim() === '') throw new ValidationError('A reason is required.');
    const assignment = await roleAssignments(this.#db).findOne({ _id: assignmentId, revokedAt: null });
    if (assignment === null) throw new NotFoundError('No active assignment with that id.');

    if (permissionsForRoles([assignment.role]).has(WILDCARD) && !actor.isSuperAdmin) {
      throw new ForbiddenError('Only a super administrator can revoke that role.');
    }

    await runUnitOfWork(this.#database, actor.context, async (uow) => {
      await roleAssignments(uow.db).updateOne(
        { _id: assignmentId, revokedAt: null },
        { $set: { revokedAt: utcNow() } },
        { session: uow.session }
      );
      uow.audit({
        action: 'role.revoked',
        resourceType: 'account',
        resourceId: assignment.accountId,
        before: { role: assignment.role, scopeType: assignment.scopeType, scopeId: assignment.scopeId },
        reason,
        emergency: actor.isSuperAdmin
      });
    });
  }

  async listRoleAssignments(accountId: EntityId): Promise<RoleAssignmentRecord[]> {
    return roleAssignments(this.#db).find({ accountId, revokedAt: null }).sort({ grantedAt: -1 }).toArray();
  }

  // --- Versioned configuration with dual control (ADMIN-003, ADMIN-009, OPS-007) ---

  /**
   * Proposes a configuration value. A high-risk key (finance, security, payout)
   * is created as pending_approval and needs a different actor to approve it.
   * A low-risk key activates immediately, superseding the previous active version.
   */
  async proposeConfiguration(actor: Actor, input: ConfigProposalInput): Promise<ConfigurationVersionRecord> {
    if (input.key.trim() === '') throw new ValidationError('A configuration key is required.');
    if (input.reason.trim() === '') throw new ValidationError('A reason is required.');

    // Canonicalise before classifying and storing, so a case/whitespace variant
    // cannot be treated as a different, low-risk key (dual-control bypass).
    const key = normalizeConfigKey(input.key);
    const highRisk = isHighRiskConfigKey(key);
    const latest = await configurationVersions(this.#db)
      .find({ key })
      .sort({ version: -1 })
      .limit(1)
      .toArray();
    const nextVersion = (latest[0]?.version ?? 0) + 1;
    const now = utcNow();

    const record: ConfigurationVersionRecord = {
      _id: newId(),
      key,
      version: nextVersion,
      value: input.value,
      state: highRisk ? 'pending_approval' : 'active',
      highRisk,
      reason: input.reason,
      createdBy: actor.context.actor.accountId ?? 'system',
      createdAt: now,
      approvedBy: null,
      approvedAt: null,
      activatedAt: highRisk ? null : now
    };

    await this.#writeConfiguration(actor, record, key, highRisk);
    return record;
  }

  async #writeConfiguration(
    actor: Actor,
    record: ConfigurationVersionRecord,
    key: string,
    highRisk: boolean
  ): Promise<void> {
    try {
      await runUnitOfWork(this.#database, actor.context, async (uow) => {
        // A low-risk proposal activates now, so the previous active version is superseded first.
        if (!highRisk) await this.#supersedeActive(uow.db, key, record._id);
        await configurationVersions(uow.db).insertOne(record, { session: uow.session });
        uow.audit({
          action: highRisk ? 'config.proposed' : 'config.activated',
          resourceType: 'configuration',
          resourceId: key,
          after: { version: record.version, state: record.state, highRisk },
          reason: record.reason,
          emergency: actor.isSuperAdmin
        });
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictError('CONFIG_CONFLICT', 'The configuration changed. Retry.');
      throw error;
    }
  }

  /**
   * Approves and activates a pending high-risk configuration version. The approver
   * MUST be a different actor from the proposer (dual control, ADMIN-003, FORM-021).
   */
  async approveConfiguration(actor: Actor, versionId: EntityId, reason: string): Promise<ConfigurationVersionRecord> {
    if (reason.trim() === '') throw new ValidationError('A reason is required.');
    const version = await configurationVersions(this.#db).findOne({ _id: versionId });
    if (version === null) throw new NotFoundError('No configuration version with that id.');
    if (version.state !== 'pending_approval') {
      throw new ConflictError('CONFIG_NOT_PENDING', 'That configuration version is not awaiting approval.');
    }
    if (version.createdBy === (actor.context.actor.accountId ?? 'system')) {
      throw new ForbiddenError('The proposer cannot approve their own configuration change.');
    }

    const now = utcNow();
    try {
      await runUnitOfWork(this.#database, actor.context, async (uow) => {
        await this.#supersedeActive(uow.db, version.key, versionId);
        const result = await configurationVersions(uow.db).updateOne(
          { _id: versionId, state: 'pending_approval' },
          {
            $set: {
              state: 'active',
              approvedBy: actor.context.actor.accountId ?? 'system',
              approvedAt: now,
              activatedAt: now
            }
          },
          { session: uow.session }
        );
        if (result.modifiedCount === 0) {
          throw new ConflictError('CONFIG_NOT_PENDING', 'The configuration version changed. Retry.');
        }
        uow.audit({
          action: 'config.approved',
          resourceType: 'configuration',
          resourceId: version.key,
          before: { state: 'pending_approval' },
          after: { version: version.version, state: 'active' },
          reason,
          emergency: actor.isSuperAdmin
        });
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictError('CONFIG_CONFLICT', 'The configuration changed. Retry.');
      throw error;
    }

    return { ...version, state: 'active', approvedBy: actor.context.actor.accountId ?? 'system', approvedAt: now, activatedAt: now };
  }

  async #supersedeActive(db: Db, key: string, exceptId: EntityId): Promise<void> {
    await configurationVersions(db).updateMany(
      { key, state: 'active', _id: { $ne: exceptId } },
      { $set: { state: 'superseded' } }
    );
  }

  async listConfigurationVersions(key: string): Promise<ConfigurationVersionRecord[]> {
    return configurationVersions(this.#db)
      .find({ key: normalizeConfigKey(key) })
      .sort({ version: -1 })
      .limit(50)
      .toArray();
  }

  async activeConfiguration(key: string): Promise<ConfigurationVersionRecord | null> {
    return configurationVersions(this.#db).findOne({ key: normalizeConfigKey(key), state: 'active' });
  }

  // --- Audit search and export (AUDIT-006, AUDIT-007, section 20.3) ---

  async searchAudit(query: {
    actorAccountId?: string;
    action?: string;
    resourceType?: string;
    emergency?: boolean;
    cursor?: string;
    limit?: number;
  }): Promise<Page<AuditEvent>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = {};
    if (query.actorAccountId !== undefined) filter['actor.accountId'] = query.actorAccountId;
    if (query.action !== undefined) filter['action'] = query.action;
    if (query.resourceType !== undefined) filter['resourceType'] = query.resourceType;
    if (query.emergency !== undefined) filter['emergency'] = query.emergency;

    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) {
      filter['$or'] = [
        { occurredAt: { $lt: cursor.sortValue } },
        { occurredAt: cursor.sortValue, _id: { $lt: cursor.id } }
      ];
    }

    const rows = await this.#db
      .collection<AuditEvent>(COLLECTIONS.auditEvents)
      .find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();

    const page = toPage(
      rows.map((row) => ({ ...row, sortValue: row.occurredAt, id: row._id })),
      limit
    );
    return {
      items: page.items.map(({ sortValue: _s, id: _i, ...event }) => event),
      nextCursor: page.nextCursor
    };
  }

  /** Export records its own audit event, so who exported what and why is itself auditable (AUDIT-007). */
  async exportAudit(
    actor: Actor,
    query: { actorAccountId?: string; action?: string; resourceType?: string; emergency?: boolean; reason: string }
  ): Promise<{ generatedAt: string; filters: Record<string, unknown>; events: readonly AuditEvent[] }> {
    if (query.reason.trim() === '') throw new ValidationError('A reason is required for an export.');
    const filters = {
      actorAccountId: query.actorAccountId ?? null,
      action: query.action ?? null,
      resourceType: query.resourceType ?? null,
      emergency: query.emergency ?? null
    };

    // Export is bounded to the maximum page size; larger exports use an async job (section 20.3).
    const { items } = await this.searchAudit({ ...query, limit: 100 });
    const generatedAt = utcNow();

    await runUnitOfWork(this.#database, actor.context, async (uow) => {
      uow.audit({
        action: 'audit.exported',
        resourceType: 'audit',
        resourceId: 'audit',
        after: { filters, count: items.length, generatedAt },
        reason: query.reason,
        emergency: actor.isSuperAdmin
      });
    });

    return { generatedAt, filters, events: items };
  }
}
