/**
 * Permission catalogue and role→permission mapping (Requirements sections 6.1, 6.2, 16).
 *
 * Authorization is deny-by-default: a permission a role does not hold is denied.
 * The mapping is code-owned system configuration — admins assign roles to users,
 * they do not edit which permissions a role carries. The super-administrator role
 * holds the wildcard, which is the single explicitly controlled unrestricted role
 * allowed by CON-006.
 */

export const WILDCARD = '*';

/** The single controlled unrestricted role (CON-006). */
export const SUPER_ADMIN_ROLE = 'super_administrator';

/**
 * Every permission the platform enforces today. Domain bundles (content, tournament,
 * finance, moderation, support) are coarse now and split further as those modules
 * arrive; a later split is additive and never widens what a role already holds.
 */
export const PERMISSIONS = {
  // Administration plane
  adminAccess: 'admin.access',
  usersRead: 'users.read',
  usersSuspend: 'users.suspend',
  rolesRead: 'roles.read',
  rolesAssign: 'roles.assign',
  configRead: 'config.read',
  configPropose: 'config.propose',
  configApprove: 'config.approve',
  auditRead: 'audit.read',
  auditExport: 'audit.export',
  // Content and games (DRAGON-05)
  contentWrite: 'content.write',
  contentPublish: 'content.publish',
  gamesManage: 'games.manage',
  // Domain bundles enforced by their modules in later prompts
  tournamentManage: 'tournament.manage',
  financeManage: 'finance.manage',
  financeApprove: 'finance.approve',
  moderationManage: 'moderation.manage',
  supportManage: 'support.manage'
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS] | typeof WILDCARD;

/** Configuration keys treated as high-risk, requiring dual-control approval (ADMIN-003). */
export const HIGH_RISK_CONFIG_PREFIXES = ['finance.', 'security.', 'payout.'] as const;

/**
 * Canonical form of a configuration key. Keys are trimmed and lowercased so that
 * a case or whitespace variant (`Finance.limit`, ` finance.limit`) cannot be used
 * to dodge high-risk classification and its dual-control requirement.
 */
export function normalizeConfigKey(key: string): string {
  return key.trim().toLowerCase();
}

export function isHighRiskConfigKey(key: string): boolean {
  const normalized = normalizeConfigKey(key);
  return HIGH_RISK_CONFIG_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Role → permissions. Codes match the seeded role catalogue (DATA-006, section 6.1).
 * Roles absent here (anonymous, registered user, player, team roles, etc.) hold no
 * administrative permission — deny-by-default in action.
 */
export const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  // Emergency platform-level role: the one explicitly controlled unrestricted role.
  super_administrator: [WILDCARD],

  // Permission-specific administration; no implicit finance or super-admin powers (ROLE-025).
  platform_administrator: [
    PERMISSIONS.adminAccess,
    PERMISSIONS.usersRead,
    PERMISSIONS.usersSuspend,
    PERMISSIONS.rolesRead,
    PERMISSIONS.rolesAssign,
    PERMISSIONS.configRead,
    PERMISSIONS.configPropose,
    PERMISSIONS.auditRead
  ],

  // Finance operator initiates but cannot approve its own high-risk actions (ROLE-022).
  finance_operator: [PERMISSIONS.adminAccess, PERMISSIONS.financeManage, PERMISSIONS.configPropose, PERMISSIONS.auditRead],
  // Approver is a distinct actor for dual control (ROLE-027).
  financial_approver: [PERMISSIONS.adminAccess, PERMISSIONS.financeApprove, PERMISSIONS.configApprove, PERMISSIONS.auditRead],

  // Content roles split by capability (ROLE-016/017/018): author and editor draft
  // and edit; only the publisher can publish, schedule, unpublish, or archive.
  content_author: [PERMISSIONS.adminAccess, PERMISSIONS.contentWrite],
  content_editor: [PERMISSIONS.adminAccess, PERMISSIONS.contentWrite],
  content_publisher: [
    PERMISSIONS.adminAccess,
    PERMISSIONS.contentWrite,
    PERMISSIONS.contentPublish,
    PERMISSIONS.gamesManage
  ],
  tournament_administrator: [PERMISSIONS.adminAccess, PERMISSIONS.tournamentManage],
  tournament_organizer: [PERMISSIONS.adminAccess, PERMISSIONS.tournamentManage],
  community_moderator: [PERMISSIONS.adminAccess, PERMISSIONS.moderationManage],
  // Support sees users but with masked sensitive fields (ROLE-020, ADMIN-008).
  support_operator: [PERMISSIONS.adminAccess, PERMISSIONS.supportManage, PERMISSIONS.usersRead],
  // Read-only security/audit visibility (ROLE-028).
  security_auditor: [PERMISSIONS.adminAccess, PERMISSIONS.auditRead, PERMISSIONS.auditExport]
};

/** Permissions granted by a set of role codes, wildcard preserved. */
export function permissionsForRoles(roles: readonly string[]): Set<Permission> {
  const result = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) result.add(permission);
  }
  return result;
}

export function isKnownRole(role: string): boolean {
  return role in ROLE_PERMISSIONS;
}
