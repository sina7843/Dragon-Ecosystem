import type { Db } from 'mongodb';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppConfig } from '../../config.ts';
import { NotFoundError } from '../../shared/errors.ts';
import { normalizeIranianMobile } from './mobile.ts';
import { readDevInbox } from './sms.ts';
import { createSessionGuards, requireIdentity, SESSION_COOKIE } from './session-guard.ts';
import type { IdentityService } from './service.ts';
import type { AccountRecord } from './store.ts';

/**
 * Identity HTTP surface.
 *
 * Session state travels in an httpOnly cookie (section 16.1). `SameSite=Lax`
 * blocks cross-site form posts, which is the baseline CSRF control for this
 * design (SEC-006); the full token-based scheme belongs to DRAGON-16b.
 */

function setSessionCookie(reply: FastifyReply, token: string, config: AppConfig): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // TLS is mandatory in production (SEC-001), so the Secure flag is set there.
    // Development and automated test both run over plain HTTP on loopback, where a
    // Secure cookie would simply never be returned.
    secure: config.env === 'production',
    path: '/',
    maxAge: config.auth.sessionTtlHours * 3600
  });
}

const accountSchema = {
  type: 'object',
  required: ['id', 'state', 'locale', 'timeZone'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    state: { type: 'string' },
    locale: { type: 'string' },
    timeZone: { type: 'string' }
  }
} as const;

const profileSchema = {
  type: 'object',
  required: ['username', 'displayName', 'birthDate', 'bio', 'visibility'],
  additionalProperties: false,
  properties: {
    username: { type: 'string' },
    displayName: { type: 'string' },
    birthDate: { type: 'string' },
    bio: { type: 'string' },
    visibility: { type: 'string', enum: ['private', 'public'] }
  }
} as const;

function toAccountView(account: AccountRecord) {
  return { id: account._id, state: account.state, locale: account.locale, timeZone: account.timeZone };
}

function toProfileView(profile: {
  username: string;
  displayName: string;
  birthDate: string;
  bio: string;
  visibility: string;
}) {
  return {
    username: profile.username,
    displayName: profile.displayName,
    birthDate: profile.birthDate,
    bio: profile.bio,
    visibility: profile.visibility
  };
}

export function registerIdentityRoutes(
  app: FastifyInstance,
  service: IdentityService,
  config: AppConfig,
  db: Db
): void {
  const { loadSession, requireSession } = createSessionGuards(service);

  app.post(
    '/auth/otp/request',
    {
      schema: {
        tags: ['identity'],
        summary: 'Request a login code. The response is identical for known and unknown numbers.',
        body: {
          type: 'object',
          required: ['mobile'],
          additionalProperties: false,
          properties: {
            mobile: { type: 'string', minLength: 3, maxLength: 20 },
            locale: { type: 'string', enum: ['fa', 'en'] }
          }
        },
        response: {
          202: {
            type: 'object',
            required: ['resendAfterSeconds'],
            additionalProperties: false,
            properties: { resendAfterSeconds: { type: 'integer' } }
          },
          422: { $ref: 'ErrorResponse#' },
          429: { $ref: 'ErrorResponse#' }
        }
      }
    },
    async (request, reply) => {
      const body = request.body as { mobile: string; locale?: string };
      const result = await service.requestOtp({
        mobile: body.mobile,
        locale: body.locale ?? 'fa',
        ip: request.ip,
        correlationId: String(request.id)
      });
      reply.status(202);
      return result;
    }
  );

  app.post(
    '/auth/otp/verify',
    {
      schema: {
        tags: ['identity'],
        summary: 'Verify a login code and start a session.',
        body: {
          type: 'object',
          required: ['mobile', 'code'],
          additionalProperties: false,
          properties: {
            mobile: { type: 'string', minLength: 3, maxLength: 20 },
            code: { type: 'string', minLength: 4, maxLength: 10 }
          }
        },
        response: {
          200: {
            type: 'object',
            required: ['account', 'profileComplete'],
            additionalProperties: false,
            properties: { account: accountSchema, profileComplete: { type: 'boolean' } }
          },
          422: { $ref: 'ErrorResponse#' },
          429: { $ref: 'ErrorResponse#' }
        }
      }
    },
    async (request, reply) => {
      const body = request.body as { mobile: string; code: string };
      const result = await service.verifyOtp({
        mobile: body.mobile,
        code: body.code,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? '',
        correlationId: String(request.id)
      });

      setSessionCookie(reply, result.token, config);
      return { account: toAccountView(result.account), profileComplete: result.profileComplete };
    }
  );

  app.get(
    '/auth/session',
    {
      schema: {
        tags: ['identity'],
        summary: 'Current session state.',
        response: {
          200: {
            type: 'object',
            required: ['authenticated', 'profileComplete'],
            additionalProperties: false,
            properties: {
              authenticated: { type: 'boolean' },
              profileComplete: { type: 'boolean' },
              account: accountSchema
            }
          }
        }
      }
    },
    async (request) => {
      await loadSession(request);
      if (request.identity === undefined) return { authenticated: false, profileComplete: false };

      const profile = await service.getProfile(request.identity.account._id);
      return {
        authenticated: true,
        profileComplete: profile !== null,
        account: toAccountView(request.identity.account)
      };
    }
  );

  app.post(
    '/auth/logout',
    { schema: { tags: ['identity'], summary: 'End the current session.', response: { 204: { type: 'null' } } } },
    async (request, reply) => {
      await loadSession(request);
      if (request.identity !== undefined) {
        await service.logout(
          request.identity.session._id,
          request.identity.account._id,
          String(request.id)
        );
      }
      // The cookie is cleared even when no session was found, so a stale cookie never lingers.
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      reply.status(204);
      return null;
    }
  );

  app.get(
    '/account/profile',
    {
      preHandler: requireSession,
      schema: {
        tags: ['identity'],
        summary: 'Own profile.',
        response: { 200: profileSchema, 401: { $ref: 'ErrorResponse#' }, 404: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const profile = await service.getProfile(requireIdentity(request).account._id);
      if (profile === null) throw new NotFoundError('The profile has not been created yet.');
      return toProfileView(profile);
    }
  );

  app.put(
    '/account/profile',
    {
      preHandler: requireSession,
      schema: {
        tags: ['identity'],
        summary: 'Create or update the profile.',
        body: {
          type: 'object',
          required: ['username', 'displayName', 'birthDate'],
          additionalProperties: false,
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 40 },
            displayName: { type: 'string', minLength: 1, maxLength: 80 },
            birthDate: { type: 'string', minLength: 4, maxLength: 20 },
            bio: { type: 'string', maxLength: 500 },
            visibility: { type: 'string', enum: ['private', 'public'] },
            locale: { type: 'string', enum: ['fa', 'en'] },
            timeZone: { type: 'string', maxLength: 60 }
          }
        },
        response: { 200: profileSchema, 401: { $ref: 'ErrorResponse#' }, 422: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const profile = await service.saveProfile(
        requireIdentity(request).account,
        request.body as Parameters<IdentityService['saveProfile']>[1],
        String(request.id)
      );
      return toProfileView(profile);
    }
  );

  app.get(
    '/account/sessions',
    {
      preHandler: requireSession,
      schema: {
        tags: ['identity'],
        summary: 'Active sessions for the current account.',
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'createdAt', 'lastSeenAt', 'current'],
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                createdAt: { type: 'string' },
                lastSeenAt: { type: 'string' },
                userAgent: { type: 'string' },
                current: { type: 'boolean' }
              }
            }
          },
          401: { $ref: 'ErrorResponse#' }
        }
      }
    },
    async (request) => {
      const identity = requireIdentity(request);
      const list = await service.listSessions(identity.account._id);
      return list.map((session) => ({
        id: session._id,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        userAgent: session.userAgent,
        current: session._id === identity.session._id
      }));
    }
  );

  app.post(
    '/account/sessions/revoke-others',
    {
      preHandler: requireSession,
      schema: {
        tags: ['identity'],
        summary: 'Revoke every other session. Requires recent authentication.',
        response: {
          200: {
            type: 'object',
            required: ['revoked'],
            additionalProperties: false,
            properties: { revoked: { type: 'integer' } }
          },
          401: { $ref: 'ErrorResponse#' }
        }
      }
    },
    async (request) => service.revokeOtherSessions(requireIdentity(request).session, String(request.id))
  );

  app.get(
    '/account/security-events',
    {
      preHandler: requireSession,
      schema: {
        tags: ['identity'],
        summary: 'Own security history (AUTH-013).',
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type', 'occurredAt'],
              additionalProperties: true,
              properties: { type: { type: 'string' }, occurredAt: { type: 'string' } }
            }
          },
          401: { $ref: 'ErrorResponse#' }
        }
      }
    },
    async (request) => service.listSecurityEvents(requireIdentity(request).account._id)
  );

  app.get(
    '/players',
    {
      schema: {
        tags: ['identity'],
        summary: 'Search the public player directory (public profiles only).',
        querystring: { type: 'object', additionalProperties: false, properties: { q: { type: 'string', maxLength: 100 }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
        response: { 200: { type: 'object', additionalProperties: true }, 400: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const query = request.query as { q?: string; cursor?: string; limit?: number };
      return service.searchPublicProfiles({
        ...(query.q === undefined ? {} : { q: query.q }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit })
      });
    }
  );

  app.get(
    '/players/:username',
    {
      schema: {
        tags: ['identity'],
        summary: 'Public player identity. Private profiles return 404.',
        params: {
          type: 'object',
          required: ['username'],
          additionalProperties: false,
          properties: { username: { type: 'string', minLength: 1, maxLength: 40 } }
        },
        response: {
          200: {
            type: 'object',
            required: ['username', 'displayName'],
            additionalProperties: false,
            properties: { username: { type: 'string' }, displayName: { type: 'string' } }
          },
          404: { $ref: 'ErrorResponse#' }
        }
      }
    },
    async (request) => {
      const { username } = request.params as { username: string };
      const profile = await service.getPublicProfile(username);
      // A private profile is indistinguishable from a missing one (section 16.4).
      if (profile === null) throw new NotFoundError();
      return profile;
    }
  );

  // DEC-041: the mock inbox is a development and test facility. The route is not
  // registered at all in production, so it cannot be reached there.
  if (config.env !== 'production') {
    app.get(
      '/dev/sms-inbox',
      {
        schema: {
          tags: ['identity'],
          summary: 'Development and test only: messages produced by the mock SMS provider.',
          querystring: {
            type: 'object',
            required: ['mobile'],
            additionalProperties: false,
            properties: { mobile: { type: 'string', minLength: 3, maxLength: 20 } }
          },
          response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } } }
        }
      },
      async (request) => {
        const { mobile } = request.query as { mobile: string };
        return readDevInbox(db, normalizeIranianMobile(mobile));
      }
    );
  }
}
