import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import type { ResourceScope } from '../../shared/authz/policy.ts';
import { createSessionGuards, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { TournamentsService } from '../tournaments/index.ts';
import type { RegistrationsService } from '../registrations/index.ts';
import type { CompetitionsService } from './service.ts';
import type { CompetitionRecord, MatchRecord, ParticipantRef } from './state.ts';

/**
 * Competition HTTP surface (DRAGON-09c): a public read side (current standings and
 * a paginated bracket for a published tournament) and an admin side gated on
 * `tournament.manage` scoped to the tournament in the path, so a resource-scoped
 * organizer/referee operates only their own tournament (TOURN-018, IDOR closed).
 */

export interface CompetitionsDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  tournaments: TournamentsService;
  registrations: RegistrationsService;
  competitions: CompetitionsService;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' }
} as const;

const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };
const matchParams = { type: 'object', required: ['id', 'mid'], additionalProperties: false, properties: { id: { type: 'string' }, mid: { type: 'string' } } };
const tournamentScope = (request: FastifyRequest): ResourceScope => ({ type: 'tournament', id: (request.params as { id: string }).id });

/**
 * Seed number is the competition's own participant identity and stays the payload's
 * join key; the display name is resolved separately (see `participantIdentities`) so
 * the match and standings shapes are unchanged.
 */
function seedMap(competition: CompetitionRecord): Map<string, number> {
  return new Map(competition.participants.map((p, i) => [p.registrationId, i + 1]));
}
function seedOf(seeds: Map<string, number>, ref: ParticipantRef | null): number | null {
  return ref === null ? null : seeds.get(ref.registrationId) ?? null;
}

/**
 * Display identity per seed, for a bracket or standings table that would otherwise read
 * "Seed 1 … Seed 4" and tell a spectator nothing.
 *
 * Names come from the registrations module's existing batched resolver, which is the same
 * one behind the public participant list — so privacy is resolved in exactly one place: a
 * private profile yields a null name and the client falls back to the seed label. Nothing
 * here depends on the tournament's participant-visibility switch, because a bracket is
 * already public; what it adds is the label, not the roster.
 */
async function participantIdentities(
  registrations: RegistrationsService,
  competition: CompetitionRecord
): Promise<Array<{ seed: number; name: string | null; username: string | null; teamSlug: string | null }>> {
  const ids = competition.participants.map((p) => p.registrationId);
  if (ids.length === 0) return [];
  const rows = await registrations.listByIds(ids);
  const names = await registrations.resolveNames(rows);
  return competition.participants.map((p, index) => {
    const resolved = names.get(p.registrationId);
    return {
      seed: index + 1,
      name: resolved?.name ?? null,
      username: resolved?.username ?? null,
      teamSlug: resolved?.teamSlug ?? null
    };
  });
}

export function registerCompetitionsRoutes(app: FastifyInstance, deps: CompetitionsDeps): void {
  const guards = createSessionGuards(deps.identity);
  const gate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.tournamentManage, tournamentScope)] });

  /**
   * The competition behind a publicly readable tournament. A finished event keeps its
   * bracket and standings — that record is the point of the archive — so this follows the
   * tournament's own public visibility rather than pinning to `published`.
   */
  async function publicCompetition(tournamentId: string): Promise<CompetitionRecord> {
    const tournament = await deps.tournaments.getById(tournamentId);
    if (tournament === null || !deps.tournaments.isPubliclyReadable(tournament.state)) throw new NotFoundError();
    const competition = await deps.competitions.getCompetition(tournamentId);
    if (competition === null) throw new NotFoundError();
    return competition;
  }

  // --- Public reads ---

  app.get(
    '/tournaments/:id/standings',
    { schema: { tags: ['competitions'], summary: 'Current standings for a published tournament.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } } } },
    async (request) => {
      const tournamentId = (request.params as { id: string }).id;
      const competition = await publicCompetition(tournamentId);
      const snapshot = await deps.competitions.getStandings(tournamentId);
      if (snapshot === null) throw new NotFoundError();
      const seeds = seedMap(competition);
      return {
        format: snapshot.format,
        status: snapshot.status,
        calculationVersion: snapshot.calculationVersion,
        lockState: competition.lockState,
        participants: await participantIdentities(deps.registrations, competition),
        rows: snapshot.rows.map((r) => ({ seed: seeds.get(r.participantId) ?? null, rank: r.rank, shared: r.shared, played: r.played, wins: r.wins, losses: r.losses, points: r.points, placement: r.placement }))
      };
    }
  );

  app.get(
    '/tournaments/:id/bracket',
    {
      schema: {
        tags: ['competitions'],
        summary: 'Paginated bracket for a published tournament.',
        params: idParam,
        querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
        response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const tournamentId = (request.params as { id: string }).id;
      const competition = await publicCompetition(tournamentId);
      const seeds = seedMap(competition);
      const q = request.query as { cursor?: string; limit?: number };
      const page = await deps.competitions.listMatchesPage(competition._id, q);
      return {
        format: competition.format,
        lockState: competition.lockState,
        participants: await participantIdentities(deps.registrations, competition),
        items: page.items.map((m) => ({ key: m.key, bracket: m.bracket, round: m.round, a: seedOf(seeds, m.slotA), b: seedOf(seeds, m.slotB), state: m.state, winner: seedOf(seeds, m.winner) })),
        nextCursor: page.nextCursor
      };
    }
  );

  // --- Admin (resource-scoped) ---

  app.post(
    '/admin/tournaments/:id/competition',
    { ...gate(), schema: { tags: ['competitions'], summary: 'Generate the competition from approved registrations.', params: idParam, body: { type: 'object', additionalProperties: true, properties: {} }, response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request, reply) => {
      const competition = await deps.competitions.generate(request.requestContext, (request.params as { id: string }).id, request.body as Parameters<CompetitionsService['generate']>[2]);
      reply.status(201);
      const { _id, ...rest } = competition;
      return { id: _id, ...rest };
    }
  );

  app.get(
    '/admin/tournaments/:id/competition',
    { ...gate(), schema: { tags: ['competitions'], summary: 'Competition summary and paginated matches.', params: idParam, querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request) => {
      const tournamentId = (request.params as { id: string }).id;
      const competition = await deps.competitions.getCompetition(tournamentId);
      if (competition === null) throw new NotFoundError('No competition.');
      const page = await deps.competitions.listMatchesPage(competition._id, request.query as { cursor?: string; limit?: number });
      const { _id, ...rest } = competition;
      return { competition: { id: _id, ...rest }, matches: page.items.map((m: MatchRecord) => ({ id: m._id, ...m })), nextCursor: page.nextCursor };
    }
  );

  app.post(
    '/admin/tournaments/:id/matches/:mid/result',
    {
      ...gate(),
      schema: {
        tags: ['competitions'],
        summary: 'Record a match result.',
        params: matchParams,
        body: { type: 'object', required: ['winnerSlot'], additionalProperties: false, properties: { winnerSlot: { type: 'string', enum: ['a', 'b'] }, scoreA: { type: 'integer' }, scoreB: { type: 'integer' } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const p = request.params as { id: string; mid: string };
      const match = await deps.competitions.recordResult(request.requestContext, p.id, p.mid, request.body as { winnerSlot: 'a' | 'b'; scoreA?: number; scoreB?: number });
      const { _id, ...rest } = match;
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/tournaments/:id/matches/:mid/correct',
    {
      ...gate(),
      schema: {
        tags: ['competitions'],
        summary: 'Correct an accepted match result (versioned, audited).',
        params: matchParams,
        body: {
          type: 'object',
          required: ['expectedVersion', 'winnerSlot', 'reason', 'idempotencyKey'],
          additionalProperties: false,
          properties: { expectedVersion: { type: 'integer', minimum: 1 }, winnerSlot: { type: 'string', enum: ['a', 'b'] }, scoreA: { type: 'integer' }, scoreB: { type: 'integer' }, reason: { type: 'string', minLength: 1, maxLength: 500 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const p = request.params as { id: string; mid: string };
      const correction = await deps.competitions.correctResult(request.requestContext, p.id, p.mid, request.body as Parameters<CompetitionsService['correctResult']>[3]);
      const { _id, ...rest } = correction;
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/tournaments/:id/competition/lock',
    {
      ...gate(),
      schema: {
        tags: ['competitions'],
        summary: 'Change the competition lock state.',
        params: idParam,
        body: { type: 'object', required: ['lockState', 'expectedLockVersion'], additionalProperties: false, properties: { lockState: { type: 'string', enum: ['open', 'correction_limited', 'locked'] }, expectedLockVersion: { type: 'integer', minimum: 0 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const body = request.body as { lockState: 'open' | 'correction_limited' | 'locked'; expectedLockVersion: number };
      const competition = await deps.competitions.setLockState(request.requestContext, (request.params as { id: string }).id, body.lockState, body.expectedLockVersion);
      const { _id, ...rest } = competition;
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/tournaments/:id/competition/recalculate',
    { ...gate(), schema: { tags: ['competitions'], summary: 'Recalculate standings.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request) => {
      const snapshot = await deps.competitions.recalculate(request.requestContext, (request.params as { id: string }).id);
      const { _id, ...rest } = snapshot;
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/tournaments/:id/competition/swiss-round',
    { ...gate(), schema: { tags: ['competitions'], summary: 'Generate the next Swiss round.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request) => deps.competitions.generateSwissRound(request.requestContext, (request.params as { id: string }).id)
  );

  // --- Bracket versions: history, regeneration, rollback (BRACKET-010/013/014) ---

  app.get(
    '/admin/tournaments/:id/competition/versions',
    { ...gate(), schema: { tags: ['competitions'], summary: 'Immutable bracket-version history.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request) => ({ versions: await deps.competitions.listVersions((request.params as { id: string }).id) })
  );

  app.post(
    '/admin/tournaments/:id/competition/regenerate/preview',
    {
      ...gate(),
      schema: {
        tags: ['competitions'],
        summary: 'Preview the impact of regenerating the bracket (non-mutating).',
        params: idParam,
        body: { type: 'object', additionalProperties: false, properties: { seed: { type: 'string', minLength: 1, maxLength: 200 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => deps.competitions.regeneratePreview((request.params as { id: string }).id, request.body as { seed?: string })
  );

  app.post(
    '/admin/tournaments/:id/competition/regenerate',
    {
      ...gate(),
      schema: {
        tags: ['competitions'],
        summary: 'Regenerate the bracket (destructive; confirmation + reason required).',
        params: idParam,
        body: { type: 'object', required: ['expectedVersion', 'reason', 'confirm'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 500 }, confirm: { type: 'boolean' }, seed: { type: 'string', minLength: 1, maxLength: 200 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const competition = await deps.competitions.regenerate(request.requestContext, (request.params as { id: string }).id, request.body as Parameters<CompetitionsService['regenerate']>[2]);
      const { _id, ...rest } = competition;
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/tournaments/:id/competition/rollback',
    {
      ...gate(),
      schema: {
        tags: ['competitions'],
        summary: 'Roll the bracket back to a superseded version (destructive; confirmation + reason required).',
        params: idParam,
        body: { type: 'object', required: ['expectedVersion', 'targetVersion', 'reason', 'confirm'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, targetVersion: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 500 }, confirm: { type: 'boolean' } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const competition = await deps.competitions.rollback(request.requestContext, (request.params as { id: string }).id, request.body as Parameters<CompetitionsService['rollback']>[2]);
      const { _id, ...rest } = competition;
      return { id: _id, ...rest };
    }
  );
}
