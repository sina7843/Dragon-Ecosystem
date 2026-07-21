import type { Db } from 'mongodb';
import { ADMIN_COLLECTIONS } from './collections.ts';
import type { EntityId } from '../../shared/ids.ts';
import type { Permission } from '../../shared/authz/permissions.ts';

/**
 * Document shapes for the administration module. No other module reads these
 * collections directly (section 32.1).
 */

export interface RoleAssignmentRecord {
  _id: EntityId;
  accountId: EntityId;
  role: string;
  /** Null scope columns encode the global grant; the unique index needs concrete values. */
  scopeType: string;
  scopeId: string;
  grantedBy: EntityId;
  grantedAt: string;
  revokedAt: string | null;
}

/** Sentinels so the unique index can enforce one active global grant per (account, role). */
export const GLOBAL_SCOPE_TYPE = '_global';
export const GLOBAL_SCOPE_ID = '_global';

export type ConfigurationState = 'pending_approval' | 'active' | 'superseded' | 'rejected';

export interface ConfigurationVersionRecord {
  _id: EntityId;
  key: string;
  version: number;
  value: unknown;
  state: ConfigurationState;
  highRisk: boolean;
  reason: string;
  createdBy: EntityId;
  createdAt: string;
  approvedBy: EntityId | null;
  approvedAt: string | null;
  activatedAt: string | null;
}

export function roleAssignments(db: Db) {
  return db.collection<RoleAssignmentRecord>(ADMIN_COLLECTIONS.roleAssignments);
}

export function configurationVersions(db: Db) {
  return db.collection<ConfigurationVersionRecord>(ADMIN_COLLECTIONS.configurationVersions);
}

/** Active global role codes for an account, used to resolve effective permissions. */
export async function activeAssignments(db: Db, accountId: EntityId): Promise<RoleAssignmentRecord[]> {
  return roleAssignments(db)
    .find({ accountId, revokedAt: null })
    .toArray();
}

export type { Permission };
