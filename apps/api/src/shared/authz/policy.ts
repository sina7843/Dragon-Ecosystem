import { WILDCARD, type Permission } from './permissions.ts';

/**
 * Deny-by-default policy evaluation (Requirements section 16.2).
 *
 * Authorization combines global permission, resource-scoped assignment, and
 * account state. This module is the pure decision core: it takes already-resolved
 * grants and answers yes/no. Resolving a user's grants from the database lives in
 * the admin module's AuthorizationService; keeping the decision pure makes the
 * matrix directly testable.
 */

export interface ResourceScope {
  readonly type: string;
  readonly id: string;
}

export interface AccessRequest {
  readonly permission: Permission;
  /** When present, the permission must hold for this specific resource. */
  readonly scope?: ResourceScope;
}

/** A grant is either global (scope null) or bound to one resource. */
export interface Grant {
  readonly permissions: ReadonlySet<Permission>;
  readonly scope: ResourceScope | null;
}

function grantAllows(grant: Grant, permission: Permission): boolean {
  return grant.permissions.has(WILDCARD) || grant.permissions.has(permission);
}

/**
 * Effective authorization for one actor: the grants resolved from their role
 * assignments. `can` is the only decision point every protected route uses.
 */
export class EffectivePermissions {
  readonly #grants: readonly Grant[];

  constructor(grants: readonly Grant[]) {
    this.#grants = grants;
  }

  /** True only when a grant explicitly allows the request; nothing is implied. */
  can(request: AccessRequest): boolean {
    for (const grant of this.#grants) {
      if (!grantAllows(grant, request.permission)) continue;

      // A global grant (scope null) applies to any resource.
      if (grant.scope === null) return true;

      // A scoped grant only satisfies a request for the same resource, and only
      // when the request is actually scoped — a scoped grant never authorizes a
      // platform-wide (unscoped) action.
      if (
        request.scope !== undefined &&
        grant.scope.type === request.scope.type &&
        grant.scope.id === request.scope.id
      ) {
        return true;
      }
    }
    return false;
  }

  /** Flat list of globally held permissions, for building the admin capability list. */
  globalPermissions(): Set<Permission> {
    const result = new Set<Permission>();
    for (const grant of this.#grants) {
      if (grant.scope === null) for (const permission of grant.permissions) result.add(permission);
    }
    return result;
  }

  hasAnyGlobal(): boolean {
    return this.#grants.some((grant) => grant.scope === null && grant.permissions.size > 0);
  }

  isSuperAdmin(): boolean {
    return this.#grants.some((grant) => grant.scope === null && grant.permissions.has(WILDCARD));
  }
}
