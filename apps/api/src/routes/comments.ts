import type { Db } from '@forge/db';
import { commentBodySchema, reactBodySchema, type Comment, type TimelineItem } from '@forge/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { orgAccess } from '../auth/guards';
import { AppError } from '../errors';
import {
  addComment,
  deleteComment,
  editComment,
  loadTimeline,
  setReaction,
} from '../tickets/comments';
import type { TicketContext } from '../tickets/service';
import { parseBody } from '../validation';
import { ticketKeyParam } from './tickets';

/** The comment id in the address, or a 404 for anything that cannot be one. */
function commentIdParam(request: { params: unknown }): string {
  const parsed = z.uuid().safeParse((request.params as { commentId: string }).commentId);
  if (!parsed.success) throw new AppError('not_found', 'Not found.', 404);
  return parsed.data;
}

export function registerCommentRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  const context = (request: FastifyRequest): TicketContext => {
    const org = request.org!;
    return {
      organisationId: org.organisationId,
      actorUserId: org.actorUserId,
      permissions: org.permissions,
    };
  };

  app.get(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/timeline',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<TimelineItem[]> =>
      loadTimeline(
        db,
        request.org!.organisationId,
        ticketKeyParam(request),
        request.org!.actorUserId,
      ),
  );

  app.post(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/comments',
    { preHandler: orgAccess(db, 'tickets.comment') },
    async (request, reply): Promise<Comment> => {
      const ticketKey = ticketKeyParam(request);
      const { body } = parseBody(commentBodySchema, request.body);
      const comment = await addComment(db, { context: context(request), ticketKey, body });
      reply.status(201);
      return comment;
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/comments/:commentId',
    { preHandler: orgAccess(db, 'tickets.comment') },
    async (request): Promise<Comment> => {
      const ticketKey = ticketKeyParam(request);
      const commentId = commentIdParam(request);
      const { body } = parseBody(commentBodySchema, request.body);
      return editComment(db, { context: context(request), ticketKey, commentId, body });
    },
  );

  // Anyone who can see the ticket gets as far as the rule: the author, or a holder of
  // tickets.edit, may delete. Whether this person qualifies is decided against the comment itself.
  app.delete(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/comments/:commentId',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request, reply): Promise<void> => {
      const ticketKey = ticketKeyParam(request);
      const commentId = commentIdParam(request);
      await deleteComment(db, { context: context(request), ticketKey, commentId });
      reply.status(204).send();
    },
  );

  app.put(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/comments/:commentId/reactions',
    { preHandler: orgAccess(db, 'tickets.comment') },
    async (request): Promise<Comment> => {
      const body = parseBody(reactBodySchema, request.body);
      return setReaction(db, {
        context: context(request),
        ticketKey: ticketKeyParam(request),
        commentId: commentIdParam(request),
        reaction: body.reaction,
        on: body.on,
      });
    },
  );
}
