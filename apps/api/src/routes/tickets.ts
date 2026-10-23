import type { Db } from '@forge/db';
import {
  createTicketBodySchema,
  normalizeProjectKey,
  parseTicketKey,
  updateTicketBodySchema,
  type Board,
  type TicketDetail,
  type TicketList,
} from '@forge/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { orgAccess } from '../auth/guards';
import { AppError } from '../errors';
import { loadBoard } from '../tickets/board';
import { filtersFromQuery, listTickets } from '../tickets/query';
import { loadTicketDetail } from '../tickets/read';
import { createTicket, updateTicket, type TicketContext } from '../tickets/service';
import { parseBody } from '../validation';

/** The ticket key in the address, in canonical form, or a 404 for anything that is not one. */
export function ticketKeyParam(request: { params: unknown }): string {
  const parsed = parseTicketKey((request.params as { ticketKey: string }).ticketKey);
  if (!parsed) throw new AppError('not_found', 'Not found.', 404);
  return `${parsed.projectKey}-${parsed.number}`;
}

export function registerTicketRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  const context = (request: FastifyRequest): TicketContext => {
    const org = request.org!;
    return {
      organisationId: org.organisationId,
      actorUserId: org.actorUserId,
      permissions: org.permissions,
    };
  };

  app.post(
    '/api/v1/orgs/:orgId/projects/:projectKey/tickets',
    { preHandler: orgAccess(db, 'tickets.create') },
    async (request, reply): Promise<TicketDetail> => {
      const body = parseBody(createTicketBodySchema, request.body);
      const ticket = await createTicket(db, {
        context: context(request),
        projectKey: (request.params as { projectKey: string }).projectKey,
        body,
      });
      reply.status(201);
      return ticket;
    },
  );

  app.get(
    '/api/v1/orgs/:orgId/tickets',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<TicketList> => {
      const org = request.org!;
      return listTickets(
        db,
        { organisationId: org.organisationId, userId: org.actorUserId },
        filtersFromQuery(request.query),
      );
    },
  );

  app.get(
    '/api/v1/orgs/:orgId/projects/:projectKey/board',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<Board> => {
      const projectKey = normalizeProjectKey((request.params as { projectKey: string }).projectKey);
      if (!projectKey) throw new AppError('not_found', 'Not found.', 404);
      const org = request.org!;
      return loadBoard(
        db,
        { organisationId: org.organisationId, userId: org.actorUserId },
        projectKey,
        filtersFromQuery(request.query),
      );
    },
  );

  app.get(
    '/api/v1/orgs/:orgId/tickets/:ticketKey',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<TicketDetail> => {
      const ticket = await loadTicketDetail(
        db,
        request.org!.organisationId,
        ticketKeyParam(request),
      );
      if (!ticket) throw new AppError('not_found', 'Not found.', 404);
      return ticket;
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId/tickets/:ticketKey',
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request): Promise<TicketDetail> => {
      const ticketKey = ticketKeyParam(request);
      const body = parseBody(updateTicketBodySchema, request.body);
      return updateTicket(db, { context: context(request), ticketKey, body });
    },
  );
}
