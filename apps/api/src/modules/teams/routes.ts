import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import type { TeamsService } from './service.ts';

/**
 * Teams HTTP surface. The management side is session-gated and authorizes each
 * action against the caller's membership in the target team (owner-only actions
 * require the active owner membership); the read side has a privacy-aware public
 * view. No global admin permission gates team actions — team authority is
 * resource-scoped to the team itself (TEAM-012).
 */

export interface TeamsDeps {
  identity: IdentityService;
  teams: TeamsService;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' }
} as const;

const okObject = { 200: { type: 'object', additionalProperties: true }, ...errorResponses } as const;

function actorId(request: FastifyRequest): string {
  return requireIdentity(request).account._id;
}

export function registerTeamsRoutes(app: FastifyInstance, deps: TeamsDeps): void {
  const guards = createSessionGuards(deps.identity);
  const authed = () => ({ preHandler: [guards.requireSession] });
  const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };

  // --- Public read side ---

  app.get(
    '/public/teams/:slug',
    {
      schema: {
        tags: ['teams'],
        summary: 'Public team by slug. Private or disbanded teams return 404.',
        params: { type: 'object', required: ['slug'], additionalProperties: false, properties: { slug: { type: 'string' } } },
        response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const team = await deps.teams.getPublicTeam((request.params as { slug: string }).slug);
      if (team === null) throw new NotFoundError();
      return team;
    }
  );

  app.get(
    '/public/players/:username/gaming-identities',
    {
      schema: {
        tags: ['teams'],
        summary: 'Public gaming identities for a player. A private profile returns 404.',
        params: { type: 'object', required: ['username'], additionalProperties: false, properties: { username: { type: 'string' } } },
        response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const identities = await deps.teams.getPublicGamingIdentities((request.params as { username: string }).username);
      if (identities === null) throw new NotFoundError();
      return { identities };
    }
  );

  // --- Authenticated management side ---

  app.post(
    '/teams',
    {
      ...authed(),
      schema: {
        tags: ['teams'],
        summary: 'Create a team; the creator becomes the owner.',
        body: {
          type: 'object',
          required: ['name', 'gameId'],
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            gameId: { type: 'string' },
            description: { type: 'string' },
            slug: { type: 'string' },
            visibility: { type: 'string', enum: ['private', 'public'] }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const team = await deps.teams.createTeam(request.requestContext, actorId(request), request.body as Parameters<TeamsService['createTeam']>[2]);
      reply.status(201);
      const { _id, ...rest } = team;
      return { id: _id, ...rest };
    }
  );

  app.get('/teams/mine', { ...authed(), schema: { tags: ['teams'], summary: 'Teams the caller belongs to.', response: okObject } }, async (request) => ({
    items: await deps.teams.listMyTeams(actorId(request))
  }));

  app.get(
    '/teams/:id',
    { ...authed(), schema: { tags: ['teams'], summary: 'Team-private view for a member.', params: idParam, response: okObject } },
    async (request) => deps.teams.getTeamForActor(actorId(request), (request.params as { id: string }).id)
  );

  app.put(
    '/teams/:id',
    {
      ...authed(),
      schema: {
        tags: ['teams'],
        summary: 'Update a team (owner only).',
        params: idParam,
        body: { type: 'object', additionalProperties: true, properties: {} },
        response: okObject
      }
    },
    async (request) => {
      const team = await deps.teams.updateTeam(
        request.requestContext,
        actorId(request),
        (request.params as { id: string }).id,
        request.body as Parameters<TeamsService['updateTeam']>[3]
      );
      const { _id, ...rest } = team;
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/teams/:id/disband',
    {
      ...authed(),
      schema: {
        tags: ['teams'],
        summary: 'Disband a team (owner only); non-destructive.',
        params: idParam,
        body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } },
        response: { 204: { type: 'null' }, ...errorResponses }
      }
    },
    async (request, reply) => {
      await deps.teams.disbandTeam(request.requestContext, actorId(request), (request.params as { id: string }).id, (request.body as { reason: string }).reason);
      reply.status(204);
    }
  );

  app.post(
    '/teams/:id/invitations',
    {
      ...authed(),
      schema: {
        tags: ['teams'],
        summary: 'Invite a player by username (owner only).',
        params: idParam,
        body: { type: 'object', required: ['username'], additionalProperties: false, properties: { username: { type: 'string' } } },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const invitation = await deps.teams.invite(request.requestContext, actorId(request), (request.params as { id: string }).id, (request.body as { username: string }).username);
      reply.status(201);
      const { _id, ...rest } = invitation;
      return { id: _id, ...rest };
    }
  );

  app.get(
    '/teams/:id/invitations',
    { ...authed(), schema: { tags: ['teams'], summary: 'Pending invitations for a team (owner only).', params: idParam, response: okObject } },
    async (request) => ({ items: await deps.teams.listTeamInvitations(actorId(request), (request.params as { id: string }).id) })
  );

  app.post(
    '/teams/:id/transfer',
    {
      ...authed(),
      schema: {
        tags: ['teams'],
        summary: 'Transfer ownership to an active member (owner only); atomic.',
        params: idParam,
        body: { type: 'object', required: ['accountId'], additionalProperties: false, properties: { accountId: { type: 'string' } } },
        response: { 204: { type: 'null' }, ...errorResponses }
      }
    },
    async (request, reply) => {
      await deps.teams.transferOwnership(request.requestContext, actorId(request), (request.params as { id: string }).id, (request.body as { accountId: string }).accountId);
      reply.status(204);
    }
  );

  app.post(
    '/teams/:id/members/:accountId/remove',
    {
      ...authed(),
      schema: {
        tags: ['teams'],
        summary: 'Remove a member (owner only).',
        params: { type: 'object', required: ['id', 'accountId'], additionalProperties: false, properties: { id: { type: 'string' }, accountId: { type: 'string' } } },
        body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } },
        response: { 204: { type: 'null' }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const params = request.params as { id: string; accountId: string };
      await deps.teams.removeMember(request.requestContext, actorId(request), params.id, params.accountId, (request.body as { reason: string }).reason);
      reply.status(204);
    }
  );

  app.post(
    '/teams/:id/leave',
    { ...authed(), schema: { tags: ['teams'], summary: 'Leave a team (members only; the owner must transfer or disband).', params: idParam, response: { 204: { type: 'null' }, ...errorResponses } } },
    async (request, reply) => {
      await deps.teams.leaveTeam(request.requestContext, actorId(request), (request.params as { id: string }).id);
      reply.status(204);
    }
  );

  app.post(
    '/teams/:id/snapshots',
    {
      ...authed(),
      schema: {
        tags: ['teams'],
        summary: 'Capture an immutable roster snapshot (owner only).',
        params: idParam,
        body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const snapshot = await deps.teams.captureRosterSnapshot(request.requestContext, actorId(request), (request.params as { id: string }).id, (request.body as { reason: string }).reason);
      reply.status(201);
      const { _id, ...rest } = snapshot;
      return { id: _id, ...rest };
    }
  );

  // --- Invitations addressed to the caller ---

  app.get('/invitations/mine', { ...authed(), schema: { tags: ['teams'], summary: 'Pending invitations addressed to the caller.', response: okObject } }, async (request) => ({
    items: await deps.teams.listMyInvitations(actorId(request))
  }));

  app.post(
    '/invitations/:id/accept',
    { ...authed(), schema: { tags: ['teams'], summary: 'Accept an invitation (idempotent).', params: idParam, response: okObject } },
    async (request) => {
      const membership = await deps.teams.acceptInvitation(request.requestContext, actorId(request), (request.params as { id: string }).id);
      const { _id, ...rest } = membership;
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/invitations/:id/decline',
    { ...authed(), schema: { tags: ['teams'], summary: 'Decline an invitation.', params: idParam, response: { 204: { type: 'null' }, ...errorResponses } } },
    async (request, reply) => {
      await deps.teams.declineInvitation(request.requestContext, actorId(request), (request.params as { id: string }).id);
      reply.status(204);
    }
  );

  // --- Gaming identities ---

  app.get('/account/gaming-identities', { ...authed(), schema: { tags: ['teams'], summary: 'The caller’s gaming identities.', response: okObject } }, async (request) => ({
    items: await deps.teams.listMyGamingIdentities(actorId(request))
  }));

  app.put(
    '/account/gaming-identities',
    {
      ...authed(),
      schema: {
        tags: ['teams'],
        summary: 'Create or update a game-specific player identity.',
        body: {
          type: 'object',
          required: ['gameId', 'inGameName'],
          additionalProperties: false,
          properties: { gameId: { type: 'string' }, inGameName: { type: 'string' }, visibility: { type: 'string', enum: ['private', 'public'] } }
        },
        response: okObject
      }
    },
    async (request) => deps.teams.saveGamingIdentity(request.requestContext, actorId(request), request.body as Parameters<TeamsService['saveGamingIdentity']>[2])
  );
}
