import type { IndexDeclaration } from '../../shared/db/collections.ts';

/**
 * Collections owned by the administration module (DATA-007, DATA-086).
 * Role assignments are separate from account records (AUTH-014).
 */
export const ADMIN_COLLECTIONS = {
  roleAssignments: 'role_assignments',
  configurationVersions: 'configuration_versions'
} as const;

export const ADMIN_INDEXES: readonly IndexDeclaration[] = [
  // A user's effective permissions are resolved by reading their active assignments.
  {
    collection: ADMIN_COLLECTIONS.roleAssignments,
    name: 'role_assignment_account_active',
    keys: { accountId: 1, revokedAt: 1 }
  },
  // One active assignment per (account, role, scope). A null scope is the global grant.
  {
    collection: ADMIN_COLLECTIONS.roleAssignments,
    name: 'role_assignment_unique_active',
    keys: { accountId: 1, role: 1, scopeType: 1, scopeId: 1, revokedAt: 1 },
    options: { unique: true }
  },
  // Configuration history is read by key, newest first; the active version is unique per key.
  {
    collection: ADMIN_COLLECTIONS.configurationVersions,
    name: 'config_key_version',
    keys: { key: 1, version: -1 }
  },
  {
    collection: ADMIN_COLLECTIONS.configurationVersions,
    name: 'config_single_active',
    keys: { key: 1, state: 1 },
    // Only one active version per key (partial index over active rows).
    options: { unique: true, partialFilterExpression: { state: 'active' } }
  }
];
