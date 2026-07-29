import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { SocialService } from './service.ts';
import { FOLLOW_TARGET_TYPES, POST_VISIBILITIES, REACTION_TARGET_TYPES, type FollowTargetType, type ReactionTargetType } from './state.ts';

/**
 * Community HTTP surface (API-083..088, PAGE-034/035/036/055).
 *
 * There is no direct-message or private-group route here and none anywhere else
 * (SOCIAL-012); a route-registry guardrail in `social.test.ts` asserts that against the
 * registered Fastify paths rather than against this comment.
 *
 * Nothing here decides visibility — every read goes through the service, which evaluates
 * it against current state on each call (BR-025).
 */

export interface SocialDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  social: SocialService;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' },
  429: { $ref: 'ErrorResponse#' }
} as const;

const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };
const targetParams = {
  type: 'object',
  required: ['targetType', 'targetId'],
  additionalProperties: false,
  properties: { targetType: { type: 'string' }, targetId: { type: 'string' } }
} as const;
const reasonProperty = { type: 'string', minLength: 1, maxLength: 500 } as const;

export function registerSocialRoutes(app: FastifyInstance, deps: SocialDeps): void {
  const guards = createSessionGuards(deps.identity);
  const moderatorGate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.moderationManage)] });
  const actor = (request: FastifyRequest): string => requireIdentity(request).account._id;

  app.get(
    '/social/config',
    {
      schema: {
        tags: ['social'],
        summary: 'Which community capabilities are gated. Blocking, muting, appeals, and push are all off.',
        response: { 200: { type: 'object', additionalProperties: true } }
      }
    },
    async () => deps.social.configView()
  );

  // --- Follows (API-083) ---

  app.post(
    '/follows/:targetType/:targetId',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['social'],
        summary: 'Follow an approved entity. Idempotent.',
        params: { ...targetParams, properties: { targetType: { type: 'string', enum: [...FOLLOW_TARGET_TYPES] }, targetId: { type: 'string' } } },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const { targetType, targetId } = request.params as { targetType: FollowTargetType; targetId: string };
      const record = await deps.social.follow(request.requestContext, actor(request), targetType, targetId);
      reply.status(201);
      const { _id, ...rest } = record;
      return { id: _id, ...rest };
    }
  );

  app.delete(
    '/follows/:targetType/:targetId',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['social'],
        summary: 'Unfollow. Idempotent: unfollowing something you do not follow is a no-op.',
        params: { ...targetParams, properties: { targetType: { type: 'string', enum: [...FOLLOW_TARGET_TYPES] }, targetId: { type: 'string' } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { targetType, targetId } = request.params as { targetType: FollowTargetType; targetId: string };
      return deps.social.unfollow(request.requestContext, actor(request), targetType, targetId);
    }
  );

  app.get(
    '/me/following',
    {
      preHandler: [guards.requireSession],
      schema: { tags: ['social'], summary: 'The signed-in user’s active follows.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } }
    },
    async (request) => ({ items: (await deps.social.listFollowing(actor(request))).map(({ _id, ...rest }) => ({ id: _id, ...rest })) })
  );

  // --- Feed (API-084) ---

  app.get(
    '/feed',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['social'],
        summary: 'Visibility-aware cursor feed. Visibility is evaluated at read time, never precomputed.',
        querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => deps.social.feed(actor(request), request.query as { cursor?: string; limit?: number })
  );

  // --- Posts (API-085) ---

  app.post(
    '/posts',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['social'],
        summary: 'Create a post. Rate limited; the audience defaults to followers.',
        body: {
          type: 'object',
          required: ['body'],
          additionalProperties: false,
          properties: {
            body: { type: 'string', minLength: 1, maxLength: 4000 },
            mediaUrls: { type: 'array', maxItems: 4, items: { type: 'string' } },
            visibility: { type: 'string', enum: [...POST_VISIBILITIES] }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { body: string; mediaUrls?: string[]; visibility?: string };
      const record = await deps.social.createPost(request.requestContext, actor(request), body);
      reply.status(201);
      const { _id, ...rest } = record;
      return { id: _id, ...rest };
    }
  );

  app.get(
    '/posts/:id',
    {
      preHandler: [guards.loadSession],
      schema: {
        tags: ['social'],
        summary: 'One post. A post the viewer may not see is a 404, not a 403.',
        params: idParam,
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const viewerId = request.identity?.account._id ?? null;
      const [post, comments] = await Promise.all([deps.social.getPost(id, viewerId), deps.social.listComments(id, viewerId)]);
      return { post, comments };
    }
  );

  app.post(
    '/posts/:id/remove',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['social'],
        summary: 'Delete your own post. It keeps its place as a tombstone.',
        params: idParam,
        body: { type: 'object', additionalProperties: false, properties: { reason: { type: 'string', maxLength: 500 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { reason } = (request.body ?? {}) as { reason?: string };
      const { _id, ...rest } = await deps.social.removePost(request.requestContext, (request.params as { id: string }).id, actor(request), {
        reason: reason ?? 'Deleted by the author.',
        asModerator: false
      });
      return { id: _id, ...rest };
    }
  );

  // --- Comments (API-086) ---

  app.post(
    '/posts/:id/comments',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['social'],
        summary: 'Comment on a post the viewer can see. Rate limited.',
        params: idParam,
        body: { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', minLength: 1, maxLength: 4000 } } },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { body: string };
      const record = await deps.social.createComment(request.requestContext, (request.params as { id: string }).id, actor(request), body);
      reply.status(201);
      const { _id, ...rest } = record;
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/comments/:id/remove',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['social'],
        summary: 'Delete your own comment.',
        params: idParam,
        body: { type: 'object', additionalProperties: false, properties: { reason: { type: 'string', maxLength: 500 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { reason } = (request.body ?? {}) as { reason?: string };
      const { _id, ...rest } = await deps.social.removeComment(request.requestContext, (request.params as { id: string }).id, actor(request), {
        reason: reason ?? 'Deleted by the author.',
        asModerator: false
      });
      return { id: _id, ...rest };
    }
  );

  // --- Reactions (API-087) ---

  app.put(
    '/reactions/:targetType/:targetId',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['social'],
        summary: 'React. Idempotent: reacting twice is one reaction.',
        params: { ...targetParams, properties: { targetType: { type: 'string', enum: [...REACTION_TARGET_TYPES] }, targetId: { type: 'string' } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { targetType, targetId } = request.params as { targetType: ReactionTargetType; targetId: string };
      return deps.social.react(request.requestContext, actor(request), targetType, targetId);
    }
  );

  app.delete(
    '/reactions/:targetType/:targetId',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['social'],
        summary: 'Remove a reaction. Idempotent.',
        params: { ...targetParams, properties: { targetType: { type: 'string', enum: [...REACTION_TARGET_TYPES] }, targetId: { type: 'string' } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { targetType, targetId } = request.params as { targetType: ReactionTargetType; targetId: string };
      return deps.social.unreact(request.requestContext, actor(request), targetType, targetId);
    }
  );

  // --- Reports (API-088) ---

  // Distinct from the moderation module's `/reports`: that route takes a subject type and
  // no evidence, while this one resolves the target, checks the reporter can actually see
  // it, and snapshots the body. Sharing the path would also be a duplicate-route crash.
  app.post(
    '/social/reports',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['social'],
        summary: 'Report a post or comment into the shared moderation workflow, with the body snapshotted as evidence.',
        body: {
          type: 'object',
          required: ['targetType', 'targetId', 'reason'],
          additionalProperties: false,
          properties: {
            targetType: { type: 'string', enum: ['post', 'comment'] },
            targetId: { type: 'string' },
            reason: reasonProperty,
            details: { type: 'string', maxLength: 2000 }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { targetType: 'post' | 'comment'; targetId: string; reason: string; details?: string };
      const result = await deps.social.report(request.requestContext, actor(request), body);
      reply.status(201);
      return result;
    }
  );

  // --- Social profile (SOCIAL-001, SOCIAL-010, PAGE-035) ---

  app.put(
    '/me/social-profile',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['social'],
        summary: 'Update the Phase 4 social fields beside the existing profile. Statistics stay hidden until opted in.',
        body: { type: 'object', additionalProperties: true, properties: {} },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { _id, ...rest } = await deps.social.upsertProfile(request.requestContext, actor(request), request.body as Parameters<SocialService['upsertProfile']>[2]);
      return { id: _id, ...rest };
    }
  );

  app.get(
    '/social/profiles/:id',
    {
      preHandler: [guards.loadSession],
      schema: {
        tags: ['social'],
        summary: 'Public social profile with its statistics and their provenance.',
        params: idParam,
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const viewerId = request.identity?.account._id ?? null;
      const profile = await deps.social.getPublicProfile(id, viewerId);
      // The shared error handler renders this; building the envelope here would drift.
      if (profile === null) throw new NotFoundError('Unknown profile.');
      return { ...profile, posts: await deps.social.listAuthorPosts(id, viewerId) };
    }
  );

  app.get(
    '/social/profiles/by-username/:username',
    {
      preHandler: [guards.loadSession],
      schema: {
        tags: ['social'],
        summary: 'The same public social profile, reached by username from the player page.',
        params: { type: 'object', required: ['username'], additionalProperties: false, properties: { username: { type: 'string', maxLength: 30 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { username } = request.params as { username: string };
      const viewerId = request.identity?.account._id ?? null;
      const accountId = await deps.social.resolveUsername(username);
      const profile = accountId === null ? null : await deps.social.getPublicProfile(accountId, viewerId);
      if (accountId === null || profile === null) throw new NotFoundError('Unknown profile.');
      return { ...profile, accountId, posts: await deps.social.listAuthorPosts(accountId, viewerId) };
    }
  );

  // --- Community moderation (PAGE-055, ROLE-019) ---

  app.get(
    '/admin/community/posts',
    {
      ...moderatorGate(),
      schema: {
        tags: ['social'],
        summary: 'Recent posts including removed ones, with their retained bodies for case review.',
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async () => ({ items: (await deps.social.listRecentPostsForModerator()).map(({ _id, ...rest }) => ({ id: _id, ...rest })) })
  );

  app.post(
    '/admin/community/posts/:id/remove',
    {
      ...moderatorGate(),
      schema: {
        tags: ['social'],
        summary: 'Remove a post from public display. The body is retained as evidence.',
        params: idParam,
        body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: reasonProperty } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { reason } = request.body as { reason: string };
      const { _id, ...rest } = await deps.social.removePost(request.requestContext, (request.params as { id: string }).id, actor(request), { reason, asModerator: true });
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/community/comments/:id/remove',
    {
      ...moderatorGate(),
      schema: {
        tags: ['social'],
        summary: 'Remove a comment from public display.',
        params: idParam,
        body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: reasonProperty } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { reason } = request.body as { reason: string };
      const { _id, ...rest } = await deps.social.removeComment(request.requestContext, (request.params as { id: string }).id, actor(request), { reason, asModerator: true });
      return { id: _id, ...rest };
    }
  );
}
