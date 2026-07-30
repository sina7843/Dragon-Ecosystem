import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import type { ResourceScope } from '../../shared/authz/policy.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { RegistrationsService } from './service.ts';
import type { RegistrationRecord, RegistrationState } from './state.ts';

/**
 * Registration HTTP surface. Participant routes are session-gated and act on the
 * caller's own entry; admin routes are gated on `tournament.manage` **scoped to the
 * tournament in the path**, so a resource-scoped organizer/referee can operate only
 * their own tournament (TOURN-018) and cannot reach another's registrations (IDOR).
 */

export interface RegistrationsDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  registrations: RegistrationsService;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' }
} as const;

const tournamentScope = (request: FastifyRequest): ResourceScope => ({ type: 'tournament', id: (request.params as { id: string }).id });

function actorId(request: FastifyRequest): string {
  return requireIdentity(request).account._id;
}

function adminView(reg: RegistrationRecord) {
  const { _id, ...rest } = reg;
  return { id: _id, ...rest };
}

/** Participant-facing status: no other participant's data, no internal decision fields. */
function statusView(reg: RegistrationRecord) {
  return {
    id: reg._id,
    tournamentId: reg.tournamentId,
    participantType: reg.participantType,
    teamId: reg.teamId,
    state: reg.state,
    seat: reg.seat,
    waitlistSeq: reg.waitlistSeq,
    createdAt: reg.createdAt
  };
}

/**
 * A participant's own registration for the account list (PAGE-017).
 *
 * Extends `statusView` with the tournament reference and the updated timestamp, and keeps
 * every one of its exclusions: no staff `reason`, no `decidedBy`/`decidedAt`, no submitted
 * `answers`, no roster snapshot id, no internal `version`. `updatedAt` is when the entry
 * last changed state, which is what a status list shows.
 */
function myRegistrationView(reg: RegistrationRecord) {
  return { ...statusView(reg), updatedAt: reg.updatedAt };
}

/**
 * One transition, as the participant may see it.
 *
 * The staff `reason` is absent by construction — it is never written to the transition
 * record. `actor` is a role, not an identity: a participant is entitled to know that staff
 * decided their entry, not which staff member did.
 */
function transitionView(t: { fromState: string | null; toState: string; actor: string; occurredAt: string; revision: number }) {
  return { fromState: t.fromState, toState: t.toState, actor: t.actor, occurredAt: t.occurredAt, revision: t.revision };
}

export function registerRegistrationsRoutes(app: FastifyInstance, deps: RegistrationsDeps): void {
  const guards = createSessionGuards(deps.identity);
  const authed = () => ({ preHandler: [guards.requireSession] });
  const adminGate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.tournamentManage, tournamentScope)] });
  const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };
  const decideParams = { type: 'object', required: ['id', 'rid'], additionalProperties: false, properties: { id: { type: 'string' }, rid: { type: 'string' } } };
  const reasonBody = { type: 'object', additionalProperties: false, properties: { reason: { type: 'string', maxLength: 500 } } };
  const reasonRequiredBody = { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } };

  // --- Public participant list (only when the organizer made it public) ---

  app.get(
    '/tournaments/:id/participants',
    {
      schema: {
        tags: ['registrations'],
        summary: 'Approved participants of a tournament, shown by name. Private/unpublished → 404.',
        params: idParam,
        querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
        response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const query = request.query as { cursor?: string; limit?: number };
      return deps.registrations.listPublicParticipants((request.params as { id: string }).id, query);
    }
  );

  // --- Participant routes ---

  app.post(
    '/tournaments/:id/registration',
    {
      ...authed(),
      schema: {
        tags: ['registrations'],
        summary: 'Register the caller (or their team) for a tournament.',
        params: idParam,
        body: {
          type: 'object',
          required: ['idempotencyKey'],
          additionalProperties: false,
          properties: {
            idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
            teamId: { type: 'string' },
            answers: { type: 'array', items: { type: 'object', required: ['key', 'value'], additionalProperties: false, properties: { key: { type: 'string' }, value: { type: 'string' } } } }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const reg = await deps.registrations.register(
        request.requestContext,
        actorId(request),
        (request.params as { id: string }).id,
        request.body as Parameters<RegistrationsService['register']>[3]
      );
      reply.status(201);
      return statusView(reg);
    }
  );

  app.get(
    '/tournaments/:id/registration/me',
    { ...authed(), schema: { tags: ['registrations'], summary: 'The caller’s registration status for a tournament.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, 401: { $ref: 'ErrorResponse#' }, 404: { $ref: 'ErrorResponse#' } } } },
    async (request) => {
      const reg = await deps.registrations.myRegistration(actorId(request), (request.params as { id: string }).id);
      if (reg === null) throw new NotFoundError('No registration.');
      return statusView(reg);
    }
  );

  /**
   * The caller's own registrations (PAGE-017). Follows the `/me/*` owned-collection
   * convention used by `/me/orders` and `/me/enrollments`, cursor-paginated newest-first.
   *
   * Tournament names are resolved for the page only, so the list stays two queries rather
   * than one per row. A tournament that has since been removed resolves to `null`, which the
   * page renders as an explicit unavailable-reference fallback instead of a dangling link.
   */
  app.get(
    '/me/tournament-registrations',
    {
      ...authed(),
      schema: {
        tags: ['registrations'],
        summary: 'The caller’s own tournament registrations, newest first.',
        querystring: { type: 'object', additionalProperties: false, properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const page = await deps.registrations.listMyRegistrations(actorId(request), request.query as { cursor?: string; limit?: number });
      const tournaments = await deps.registrations.resolveTournamentSummaries(page.items.map((r) => r.tournamentId));
      return {
        items: page.items.map((reg) => ({ ...myRegistrationView(reg), tournament: tournaments.get(reg.tournamentId) ?? null })),
        nextCursor: page.nextCursor
      };
    }
  );

  app.get(
    '/me/tournament-registrations/:id',
    {
      ...authed(),
      schema: {
        tags: ['registrations'],
        summary: 'One of the caller’s own registrations with its transition history.',
        params: idParam,
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const detail = await deps.registrations.myRegistrationDetail(actorId(request), (request.params as { id: string }).id);
      // A registration owned by someone else is reported exactly as a missing one, so the
      // refusal cannot be used to probe whether a record exists.
      if (detail === null) throw new NotFoundError('Unknown registration.');
      const tournaments = await deps.registrations.resolveTournamentSummaries([detail.registration.tournamentId]);
      return {
        ...myRegistrationView(detail.registration),
        tournament: tournaments.get(detail.registration.tournamentId) ?? null,
        history: detail.history.map(transitionView),
        /**
         * Whether the history is *complete*, not merely non-empty.
         *
         * A complete history begins with the transition that created the registration, which
         * is the only entry with no prior state. A registration that predates the history
         * migration and has since been decided has exactly one row — the decision — and a
         * bare "is it non-empty" flag would present that partial list as the whole story.
         * The page shows the rows it has *and* says the earlier ones were not recorded.
         */
        historyComplete: detail.history[0]?.fromState === null
      };
    }
  );

  app.post(
    '/tournaments/:id/registration/withdraw',
    { ...authed(), schema: { tags: ['registrations'], summary: 'Withdraw the caller’s own registration (TOURN-016).', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request) => {
      const tournamentId = (request.params as { id: string }).id;
      const mine = await deps.registrations.myRegistration(actorId(request), tournamentId);
      if (mine === null || !['pending', 'approved', 'waitlisted'].includes(mine.state)) throw new NotFoundError('No active registration.');
      return statusView(await deps.registrations.cancel(request.requestContext, actorId(request), tournamentId, mine._id, { asAdmin: false, reason: 'Withdrawn by participant.' }));
    }
  );

  // --- Administrative queue and decisions (resource-scoped) ---

  /**
   * Registration counts for a set of tournaments, for the organizer workspace.
   *
   * Gated on global `tournament.manage`, matching the admin tournament list this
   * accompanies — a caller who may list those tournaments may already see them, so this
   * exposes no tournament they could not otherwise reach. The id list is capped so it
   * cannot be turned into a scan.
   */
  app.post(
    '/admin/registration-counts',
    {
      preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.tournamentManage)],
      schema: {
        tags: ['registrations'],
        summary: 'Registration counts by state for several tournaments (organizer workspace).',
        body: {
          type: 'object',
          required: ['tournamentIds'],
          additionalProperties: false,
          properties: { tournamentIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 64 } } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { tournamentIds } = request.body as { tournamentIds: string[] };
      const counts = await deps.registrations.countsByState(tournamentIds);
      return { counts: Object.fromEntries(counts) };
    }
  );

  app.get(
    '/admin/tournaments/:id/registrations',
    {
      ...adminGate(),
      schema: {
        tags: ['registrations'],
        summary: 'Registration queue for a tournament (filterable, paginated).',
        params: idParam,
        querystring: { type: 'object', additionalProperties: false, properties: { state: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const tournamentId = (request.params as { id: string }).id;
      const q = request.query as { state?: RegistrationState; cursor?: string; limit?: number };
      const [page, seats] = await Promise.all([
        deps.registrations.listForAdmin(tournamentId, q),
        deps.registrations.seatSummary(tournamentId)
      ]);
      // Resolve display names so the queue shows who each entry is, not an opaque id.
      const names = await deps.registrations.resolveNames(page.items);
      const items = page.items.map((reg) => {
        const resolved = names.get(reg._id);
        return { ...adminView(reg), participantName: resolved?.name ?? null, username: resolved?.username ?? null, teamSlug: resolved?.teamSlug ?? null };
      });
      return { items, nextCursor: page.nextCursor, seats };
    }
  );

  const decision = (
    verb: string,
    body: Record<string, unknown>,
    call: (reg: RegistrationsService, ctx: FastifyRequest['requestContext'], adminId: string, tid: string, rid: string, reason: string) => Promise<RegistrationRecord>
  ): void => {
    app.post(
      `/admin/tournaments/:id/registrations/:rid/${verb}`,
      { ...adminGate(), schema: { tags: ['registrations'], summary: `Registration decision: ${verb}.`, params: decideParams, body, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
      async (request) => {
        const p = request.params as { id: string; rid: string };
        const reason = (request.body as { reason?: string }).reason ?? '';
        return adminView(await call(deps.registrations, request.requestContext, actorId(request), p.id, p.rid, reason));
      }
    );
  };

  decision('approve', reasonBody, (r, ctx, admin, tid, rid, reason) => r.approve(ctx, admin, tid, rid, reason === '' ? null : reason));
  decision('reject', reasonRequiredBody, (r, ctx, admin, tid, rid, reason) => r.reject(ctx, admin, tid, rid, reason));
  decision('waitlist', reasonBody, (r, ctx, admin, tid, rid, reason) => r.waitlist(ctx, admin, tid, rid, reason === '' ? null : reason));
  decision('promote', reasonBody, (r, ctx, admin, tid, rid, reason) => r.promote(ctx, admin, tid, rid, reason === '' ? null : reason));
  decision('cancel', reasonRequiredBody, (r, ctx, admin, tid, rid, reason) => r.cancel(ctx, admin, tid, rid, { asAdmin: true, reason }));
}
