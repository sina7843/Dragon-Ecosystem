import type { Db } from 'mongodb';
import { COLLECTIONS } from './collections.ts';
import { utcNow } from '../events.ts';
import { ROLE_PERMISSIONS, type Permission } from '../authz/permissions.ts';

/**
 * Production-safe seed (section 34.4).
 *
 * Contains only required system configuration and roles. No demonstration data is
 * ever inserted, and every operation is idempotent so repeated runs are harmless.
 * Permissions are intentionally empty: the permission model is owned by DRAGON-04.
 */

export type RiskClass = 'standard' | 'elevated' | 'critical';

export interface RoleDefinition {
  _id: string;
  requirementId: string;
  riskClass: RiskClass;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
}

interface SeedRole {
  readonly code: string;
  readonly requirementId: string;
  readonly riskClass: RiskClass;
}

/** Role catalogue from Requirements section 6.1. */
export const ROLE_SEED: readonly SeedRole[] = [
  { code: 'anonymous_visitor', requirementId: 'ROLE-001', riskClass: 'standard' },
  { code: 'registered_user', requirementId: 'ROLE-002', riskClass: 'standard' },
  { code: 'player', requirementId: 'ROLE-003', riskClass: 'standard' },
  { code: 'team_member', requirementId: 'ROLE-004', riskClass: 'standard' },
  { code: 'team_owner', requirementId: 'ROLE-005', riskClass: 'standard' },
  { code: 'team_captain', requirementId: 'ROLE-006', riskClass: 'standard' },
  { code: 'team_manager', requirementId: 'ROLE-007', riskClass: 'standard' },
  { code: 'tournament_organizer', requirementId: 'ROLE-008', riskClass: 'elevated' },
  { code: 'tournament_administrator', requirementId: 'ROLE-009', riskClass: 'elevated' },
  { code: 'referee', requirementId: 'ROLE-010', riskClass: 'standard' },
  { code: 'viewer', requirementId: 'ROLE-011', riskClass: 'standard' },
  { code: 'streamer', requirementId: 'ROLE-012', riskClass: 'standard' },
  { code: 'live_chat_moderator', requirementId: 'ROLE-013', riskClass: 'elevated' },
  { code: 'learner', requirementId: 'ROLE-014', riskClass: 'standard' },
  { code: 'coach', requirementId: 'ROLE-015', riskClass: 'standard' },
  { code: 'content_author', requirementId: 'ROLE-016', riskClass: 'standard' },
  { code: 'content_editor', requirementId: 'ROLE-017', riskClass: 'standard' },
  { code: 'content_publisher', requirementId: 'ROLE-018', riskClass: 'elevated' },
  { code: 'community_moderator', requirementId: 'ROLE-019', riskClass: 'elevated' },
  { code: 'support_operator', requirementId: 'ROLE-020', riskClass: 'elevated' },
  { code: 'shop_operator', requirementId: 'ROLE-021', riskClass: 'elevated' },
  { code: 'finance_operator', requirementId: 'ROLE-022', riskClass: 'critical' },
  { code: 'education_manager', requirementId: 'ROLE-023', riskClass: 'elevated' },
  { code: 'streaming_operator', requirementId: 'ROLE-024', riskClass: 'elevated' },
  { code: 'platform_administrator', requirementId: 'ROLE-025', riskClass: 'elevated' },
  { code: 'super_administrator', requirementId: 'ROLE-026', riskClass: 'critical' },
  { code: 'financial_approver', requirementId: 'ROLE-027', riskClass: 'critical' },
  { code: 'security_auditor', requirementId: 'ROLE-028', riskClass: 'elevated' }
];

/**
 * Upserts the role catalogue and returns the number of roles present afterwards.
 *
 * Role→permission mapping is code-owned system configuration (section 6.2): admins
 * assign roles to users, they do not edit a role's permissions. So the seed is
 * authoritative and rewrites `permissions` from the catalogue on every run, which
 * also lets a permission change ship as a code + redeploy rather than a data edit.
 */
export async function seedSystemConfiguration(db: Db): Promise<number> {
  const collection = db.collection<RoleDefinition>(COLLECTIONS.roleDefinitions);
  const now = utcNow();

  for (const role of ROLE_SEED) {
    await collection.updateOne(
      { _id: role.code },
      {
        $set: {
          requirementId: role.requirementId,
          riskClass: role.riskClass,
          permissions: [...(ROLE_PERMISSIONS[role.code] ?? [])],
          updatedAt: now
        },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );
  }

  return collection.countDocuments();
}
