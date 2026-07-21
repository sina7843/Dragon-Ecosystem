import type { FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthenticatedError } from '../../shared/errors.ts';
import { createRequestContext } from '../../shared/context.ts';
import type { IdentityService } from './service.ts';
import type { AccountRecord, SessionRecord } from './store.ts';

/**
 * Session guards shared by the identity routes and any other module that needs an
 * authenticated caller (e.g. administration). Keeping them here means session
 * resolution stays owned by the identity module (section 32.1).
 */

export const SESSION_COOKIE = 'dragon_session';

declare module 'fastify' {
  interface FastifyRequest {
    identity?: { session: SessionRecord; account: AccountRecord };
  }
}

export interface SessionGuards {
  /** Attaches the session when a valid cookie is present. Never rejects on its own. */
  loadSession(request: FastifyRequest): Promise<void>;
  /** Requires a live, non-suspended session; throws 401 or 403 otherwise. */
  requireSession(request: FastifyRequest): Promise<void>;
}

export function createSessionGuards(service: IdentityService): SessionGuards {
  async function loadSession(request: FastifyRequest): Promise<void> {
    const token = request.cookies[SESSION_COOKIE];
    if (token === undefined || token === '') return;

    const resolved = await service.resolveSession(token);
    if (resolved === null) return;

    request.identity = resolved;
    // Upgrade the request actor from anonymous to the authenticated account. Global
    // role codes are filled in by the authorization layer when it resolves grants.
    request.requestContext = createRequestContext(String(request.id), {
      kind: 'account',
      accountId: resolved.account._id,
      roles: []
    });
  }

  async function requireSession(request: FastifyRequest): Promise<void> {
    await loadSession(request);
    if (request.identity === undefined) throw new UnauthenticatedError();
    // Suspended accounts are blocked from every protected action (AUTH-010).
    if (request.identity.account.state === 'suspended') {
      throw new ForbiddenError('This account is suspended.');
    }
  }

  return { loadSession, requireSession };
}

/** Narrows the request after a guard has run, without a non-null assertion. */
export function requireIdentity(request: FastifyRequest): { session: SessionRecord; account: AccountRecord } {
  if (request.identity === undefined) throw new UnauthenticatedError();
  return request.identity;
}
