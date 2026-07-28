import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { createRequestContext, SYSTEM_ACTOR } from '../../shared/context.ts';
import { decodeCursor } from '../../shared/pagination.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, type SessionGuards } from '../identity/index.ts';
import type { IdentityService } from '../identity/index.ts';
import type { AuthorizationService} from './authorization.ts';
import { requirePermission } from './authorization.ts';
import type { AdminService} from './service.ts';
import { type Actor } from './service.ts';

/**
 * Administration HTTP surface (Requirements sections 9.3, 16, 28).
 *
 * Every route is deny-by-default: an unauthenticated caller gets 401 (session
 * guard), and an authenticated caller without the required permission gets 403
 * (permission guard). Both run before the handler.
 */

export interface AdminDeps {
  readonly identity: IdentityService;
  readonly authorization: AuthorizationService;
  readonly admin: AdminService;
  /**
   * Whether the development-only grant helper is registered. Comes from
   * `config.devRoutesEnabled`, which is false in production and false unless
   * `ENABLE_DEV_ROUTES=true` is explicitly set.
   */
  readonly devRoutesEnabled: boolean;
}

const errorResponses = {
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' }
} as const;

/** Builds the domain Actor from the request the guards have already populated. */
function actorOf(request: FastifyRequest): Actor {
  return {
    context: request.requestContext,
    isSuperAdmin: request.effectivePermissions?.isSuperAdmin() ?? false
  };
}

/** Presents a stored record with `id` instead of the internal `_id` (section 15.1). */
function presentId<T extends { _id: string }>(record: T): Omit<T, '_id'> & { id: string } {
  const { _id, ...rest } = record;
  return { id: _id, ...rest };
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): void {
  const guards: SessionGuards = createSessionGuards(deps.identity);
  const perm = (permission: Parameters<typeof requirePermission>[1], scopeOf?: Parameters<typeof requirePermission>[2]) =>
    requirePermission(deps.authorization, permission, scopeOf);

  /** Session first, then the permission — order matters so 401 precedes 403. */
  const gate = (permission: Parameters<typeof requirePermission>[1]) => ({
    preHandler: [guards.requireSession, perm(permission)]
  });

  /**
   * Adds the acting account's display identity to a page of audit events.
   *
   * The audit console's whole purpose is answering "who did this", and it was answering
   * with a raw account UUID that an operator had to look up by hand. Resolution is a
   * single batched query over the page (the same `getIdentitySummaries` the teams module
   * uses), and the raw `actor` is left untouched so filtering and export are unaffected.
   * An account with no profile, or a deleted one, resolves to null and the client falls
   * back to the id — the log never invents an identity it cannot prove.
   */
  async function withActorNames<T extends { items: readonly { actor: { accountId?: string | null } }[] }>(
    page: T
  ): Promise<T & { items: unknown[] }> {
    const accountIds = [...new Set(page.items.map((e) => e.actor.accountId).filter((id): id is string => typeof id === 'string' && id !== ''))];
    const names = await deps.identity.getIdentitySummaries(accountIds);
    return {
      ...page,
      items: page.items.map((event) => {
        const resolved = event.actor.accountId === undefined || event.actor.accountId === null ? undefined : names.get(event.actor.accountId);
        return { ...event, actorName: resolved === undefined ? null : { username: resolved.username, displayName: resolved.displayName } };
      })
    };
  }

  // Capability list drives the admin navigation from effective permissions (section 9.4).
  app.get(
    '/admin/capabilities',
    {
      ...gate(PERMISSIONS.adminAccess),
      schema: {
        tags: ['admin'],
        summary: 'Effective administration permissions for the current user.',
        response: {
          200: {
            type: 'object',
            required: ['permissions', 'isSuperAdmin'],
            additionalProperties: false,
            properties: {
              permissions: { type: 'array', items: { type: 'string' } },
              isSuperAdmin: { type: 'boolean' }
            }
          },
          ...errorResponses
        }
      }
    },
    async (request) => {
      const effective = request.effectivePermissions;
      return {
        permissions: [...(effective?.globalPermissions() ?? [])],
        isSuperAdmin: effective?.isSuperAdmin() ?? false
      };
    }
  );

  // --- Users ---

  app.get(
    '/admin/users',
    {
      ...gate(PERMISSIONS.usersRead),
      schema: {
        tags: ['admin'],
        summary: 'Masked, paginated account list.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            cursor: { type: 'string' },
            state: { type: 'string' }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const query = request.query as { limit?: number; cursor?: string; state?: string };
      return deps.identity.listAccountsForAdmin({
        limit: query.limit ?? 20,
        cursor: decodeCursor(query.cursor),
        ...(query.state === undefined ? {} : { state: query.state as never })
      });
    }
  );

  for (const [action, to] of [
    ['suspend', 'suspended'],
    ['reactivate', 'active']
  ] as const) {
    app.post(
      `/admin/users/:id/${action}`,
      {
        ...gate(PERMISSIONS.usersSuspend),
        schema: {
          tags: ['admin'],
          summary: `${action[0]?.toUpperCase()}${action.slice(1)} an account.`,
          params: {
            type: 'object',
            required: ['id'],
            additionalProperties: false,
            properties: { id: { type: 'string' } }
          },
          body: {
            type: 'object',
            required: ['reason'],
            additionalProperties: false,
            properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
          },
          response: { 204: { type: 'null' }, ...errorResponses }
        }
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const { reason } = request.body as { reason: string };
        await deps.identity.transitionAccountState(id, to, request.requestContext, reason, {
          emergency: actorOf(request).isSuperAdmin
        });
        reply.status(204);
        return null;
      }
    );
  }

  // --- Roles ---

  app.get(
    '/admin/users/:id/roles',
    {
      ...gate(PERMISSIONS.rolesRead),
      schema: {
        tags: ['admin'],
        summary: 'Active role assignments for an account.',
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
        response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } }, ...errorResponses }
      }
    },
    async (request) =>
      (await deps.admin.listRoleAssignments((request.params as { id: string }).id)).map(presentId)
  );

  app.post(
    '/admin/users/:id/roles',
    {
      ...gate(PERMISSIONS.rolesAssign),
      schema: {
        tags: ['admin'],
        summary: 'Assign a role, optionally scoped to a resource.',
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          required: ['role', 'reason'],
          additionalProperties: false,
          properties: {
            role: { type: 'string', minLength: 1, maxLength: 60 },
            reason: { type: 'string', minLength: 1, maxLength: 500 },
            scope: {
              type: 'object',
              required: ['type', 'id'],
              additionalProperties: false,
              properties: { type: { type: 'string', maxLength: 60 }, id: { type: 'string', maxLength: 100 } }
            }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { role: string; reason: string; scope?: { type: string; id: string } };
      if (!(await deps.identity.accountExists(id))) throw new NotFoundError('Unknown account.');

      const record = await deps.admin.assignRole(actorOf(request), {
        accountId: id,
        role: body.role,
        reason: body.reason,
        ...(body.scope === undefined ? {} : { scope: body.scope })
      });
      reply.status(201);
      return presentId(record);
    }
  );

  app.post(
    '/admin/roles/:assignmentId/revoke',
    {
      ...gate(PERMISSIONS.rolesAssign),
      schema: {
        tags: ['admin'],
        summary: 'Revoke a role assignment.',
        params: {
          type: 'object',
          required: ['assignmentId'],
          additionalProperties: false,
          properties: { assignmentId: { type: 'string' } }
        },
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
        },
        response: { 204: { type: 'null' }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const { reason } = request.body as { reason: string };
      await deps.admin.revokeRole(actorOf(request), assignmentId, reason);
      reply.status(204);
      return null;
    }
  );

  // --- Configuration ---

  app.get(
    '/admin/configuration',
    {
      ...gate(PERMISSIONS.configRead),
      schema: {
        tags: ['admin'],
        summary: 'Every configuration key with its active value and any pending proposal.',
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async () => ({
      items: (await deps.admin.listConfigurationKeys()).map((entry) => ({
        key: entry.key,
        active: entry.active === null ? null : presentId(entry.active),
        pending: entry.pending === null ? null : presentId(entry.pending)
      }))
    })
  );

  app.get(
    '/admin/configuration/:key',
    {
      ...gate(PERMISSIONS.configRead),
      schema: {
        tags: ['admin'],
        summary: 'Version history for a configuration key.',
        params: { type: 'object', required: ['key'], additionalProperties: false, properties: { key: { type: 'string' } } },
        response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } }, ...errorResponses }
      }
    },
    async (request) =>
      (await deps.admin.listConfigurationVersions((request.params as { key: string }).key)).map(presentId)
  );

  app.post(
    '/admin/configuration',
    {
      ...gate(PERMISSIONS.configPropose),
      schema: {
        tags: ['admin'],
        summary: 'Propose a configuration value. High-risk keys require separate approval.',
        body: {
          type: 'object',
          required: ['key', 'value', 'reason'],
          additionalProperties: false,
          properties: {
            key: { type: 'string', minLength: 1, maxLength: 100 },
            value: {},
            reason: { type: 'string', minLength: 1, maxLength: 500 }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { key: string; value: unknown; reason: string };
      const record = await deps.admin.proposeConfiguration(actorOf(request), body);
      reply.status(201);
      return presentId(record);
    }
  );

  app.post(
    '/admin/configuration/:id/approve',
    {
      ...gate(PERMISSIONS.configApprove),
      schema: {
        tags: ['admin'],
        summary: 'Approve and activate a pending high-risk configuration version (dual control).',
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { reason } = request.body as { reason: string };
      return presentId(await deps.admin.approveConfiguration(actorOf(request), id, reason));
    }
  );

  // --- Audit ---

  const auditQuerystring = {
    type: 'object',
    additionalProperties: false,
    properties: {
      actorAccountId: { type: 'string' },
      action: { type: 'string' },
      resourceType: { type: 'string' },
      emergency: { type: 'boolean' },
      cursor: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 }
    }
  } as const;

  app.get(
    '/admin/audit',
    {
      ...gate(PERMISSIONS.auditRead),
      schema: {
        tags: ['admin'],
        summary: 'Search immutable audit events (read-only, paginated).',
        querystring: auditQuerystring,
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => withActorNames(await deps.admin.searchAudit(request.query as Record<string, never>))
  );

  app.get(
    '/admin/audit/emergency',
    {
      ...gate(PERMISSIONS.auditRead),
      schema: {
        tags: ['admin'],
        summary: 'Oversight queue: emergency super-administrator actions (ADMIN-010, MOD-009).',
        querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const query = request.query as { cursor?: string; limit?: number };
      return withActorNames(await deps.admin.searchAudit({ ...query, emergency: true }));
    }
  );

  app.post(
    '/admin/audit/export',
    {
      ...gate(PERMISSIONS.auditExport),
      schema: {
        tags: ['admin'],
        summary: 'Export audit events; the export itself is audited (AUDIT-007).',
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: {
            reason: { type: 'string', minLength: 1, maxLength: 500 },
            actorAccountId: { type: 'string' },
            action: { type: 'string' },
            resourceType: { type: 'string' },
            emergency: { type: 'boolean' }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => deps.admin.exportAudit(actorOf(request), request.body as { reason: string })
  );

  // Development and test only: grant a role to an account by mobile number, so the
  // browser tests can set up an administrator without a seeded one. Routed through
  // the audited assignRole with a system super-actor. Registered only when
  // ENABLE_DEV_ROUTES=true and not in production (fail-closed).
  if (deps.devRoutesEnabled) {
    app.post(
      '/dev/grant-role',
      {
        schema: {
          tags: ['admin'],
          summary: 'Development and test only: grant a role to an account by mobile.',
          body: {
            type: 'object',
            required: ['mobile', 'role'],
            additionalProperties: false,
            properties: { mobile: { type: 'string' }, role: { type: 'string' } }
          },
          response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } }
        }
      },
      async (request) => {
        const { mobile, role } = request.body as { mobile: string; role: string };
        const accountId = await deps.identity.findAccountIdByMobile(mobile);
        if (accountId === null) throw new NotFoundError('Unknown account.');
        await deps.admin.assignRole(
          { context: createRequestContext(String(request.id), SYSTEM_ACTOR), isSuperAdmin: true },
          { accountId, role, reason: 'development role grant' }
        );
        return { granted: true, role };
      }
    );
  }
}
