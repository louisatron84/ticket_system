import type { Db } from '@forge/db';
import {
  addLinkBodySchema,
  createTicketBodySchema,
  markDuplicateBodySchema,
  setParentBodySchema,
  type TicketDetail,
} from '@forge/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { orgAccess } from '../auth/guards';
import type { TicketContext } from '../tickets/service';
import { addChild, addLink, markDuplicate, removeLink, setParent } from '../tickets/structure';
import { parseBody } from '../validation';
import { ticketKeyParam } from './tickets';

/** Parents and links: how tickets are shaped and tied together. */
export function registerTicketStructureRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  const context = (request: FastifyRequest): TicketContext => {
    const org = request.org!;
    return {
      organisationId: org.organisationId,
      actorUserId: org.actorUserId,
      permissions: org.permissions,
    };
  };

  app.put(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/parent',
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request): Promise<TicketDetail> => {
      const body = parseBody(setParentBodySchema, request.body);
      return setParent(db, {
        context: context(request),
        ticketKey: ticketKeyParam(request),
        parentKey: body.parentKey,
      });
    },
  );

  app.post(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/links',
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request, reply): Promise<TicketDetail> => {
      const body = parseBody(addLinkBodySchema, request.body);
      const ticket = await addLink(db, {
        context: context(request),
        ticketKey: ticketKeyParam(request),
        choice: body.choice,
        otherKey: body.otherKey,
      });
      reply.status(201);
      return ticket;
    },
  );

  app.delete(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/links/:linkId',
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request, reply) => {
      await removeLink(db, {
        context: context(request),
        ticketKey: ticketKeyParam(request),
        linkId: (request.params as { linkId: string }).linkId,
      });
      return reply.status(204).send();
    },
  );

  app.post(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/children',
    { preHandler: orgAccess(db, 'tickets.create') },
    async (request, reply): Promise<TicketDetail> => {
      const body = parseBody(createTicketBodySchema, request.body);
      const ticket = await addChild(db, {
        context: context(request),
        parentKey: ticketKeyParam(request),
        body,
      });
      reply.status(201);
      return ticket;
    },
  );

  app.post(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/mark-duplicate',
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request): Promise<TicketDetail> => {
      const body = parseBody(markDuplicateBodySchema, request.body);
      return markDuplicate(db, {
        context: context(request),
        ticketKey: ticketKeyParam(request),
        originalKey: body.originalKey,
      });
    },
  );
}
