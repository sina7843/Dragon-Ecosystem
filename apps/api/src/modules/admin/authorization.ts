import type { Db } from 'mongodb';
import type { FastifyRequest } from 'fastify';
import { ForbiddenError } from '../../shared/errors.ts';
import { permissionsForRoles, type Permission } from '../../shared/authz/permissions.ts';
import { EffectivePermissions, type Grant, type ResourceScope } from '../../shared/authz/policy.ts';
import { requireIdentity } from '../identity/index.ts';
import { activeAssignments, GLOBAL_SCOPE_TYPE } from './store.ts';
import type { EntityId } from '../../shared/ids.ts';

/**
 * Resolves an account's effective permissions from its active role assignments
 * and enforces them at the route boundary (Requirements section 16).
 *
 * The decision itself is the pure `EffectivePermissions.can`; this service only
 * turns database rows into grants and maps a denied decision to 403.
 */
export class AuthorizationService {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Builds the grant list for an account: one grant per assignment, global or scoped. */
  async effectivePermissions(accountId: EntityId): Promise<EffectivePermissions> {
    const assignments = await activeAssignments(this.#db, accountId);
    const grants: Grant[] = assignments.map((assignment) => {
      const permissions = permissionsForRoles([assignment.role]) as ReadonlySet<Permission>;
      const scope: ResourceScope | null =
        assignment.scopeType === GLOBAL_SCOPE_TYPE
          ? null
          : { type: assignment.scopeType, id: assignment.scopeId };
      return { permissions, scope };
    });
    return new EffectivePermissions(grants);
  }
}

/** Extracts a resource scope from the request, when the action targets a resource. */
export type ScopeExtractor = (request: FastifyRequest) => ResourceScope | undefined;

/**
 * Builds a preHandler that enforces one permission. It runs after the session
 * guard, so the caller is already authenticated and non-suspended. A denied
 * request is a 403 (the resource is known to exist); routes that must hide a
 * resource's existence return 404 in their own handler instead.
 */
export function requirePermission(
  service: AuthorizationService,
  permission: Permission,
  scopeOf?: ScopeExtractor
): (request: FastifyRequest) => Promise<void> {
  return async (request: FastifyRequest): Promise<void> => {
    const identity = requireIdentity(request);
    const effective = await service.effectivePermissions(identity.account._id);
    const scope = scopeOf?.(request);

    if (!effective.can(scope === undefined ? { permission } : { permission, scope })) {
      // Repeated forbidden access should raise a security signal (section 16.4).
      // The signal is the logged warning here plus the audit trail on any mutation.
      request.log.warn(
        { accountId: identity.account._id, permission, scope },
        'authorization denied'
      );
      throw new ForbiddenError();
    }

    // Cache so a handler needing the same set again does not re-query.
    request.effectivePermissions = effective;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    effectivePermissions?: EffectivePermissions;
  }
}
