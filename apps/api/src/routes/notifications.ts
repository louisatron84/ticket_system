import { tickets, type Db } from '@forge/db';
import {
  markReadBodySchema,
  type NotificationEvent,
  type NotificationList,
  type TicketDetail,
} from '@forge/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { orgAccess, requireUser } from '../auth/guards';
import { SESSION_COOKIE, resolveSession } from '../auth/sessions';
import { AppError } from '../errors';
import type { NotificationHub } from '../notifications/hub';
import {
  listNotifications,
  loadNotification,
  markRead,
  setWatching,
  unreadCount,
} from '../notifications/service';
import { loadTicketDetail } from '../tickets/read';
import { parseBody } from '../validation';
import { ticketKeyParam } from './tickets';

const HEARTBEAT_MS = 25_000;
const MAX_STREAMS_PER_PERSON = 10;

const listQuerySchema = z.object({
  filter: z.enum(['all', 'unread']).default('all'),
  before: z.string().max(80).optional(),
});

/** The inbox (per workspace, so command-line tokens can read it), the live stream, watching. */
export function registerNotificationRoutes(
  app: FastifyInstance,
  deps: { db: Db; hub: NotificationHub },
): void {
  const { db, hub } = deps;
  const me = (request: FastifyRequest) => request.org!.actorUserId;

  app.get(
    '/api/v1/orgs/:orgId/notifications',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<NotificationList> => {
      const query = listQuerySchema.safeParse(request.query);
      if (!query.success) throw new AppError('validation_failed', 'Bad query.', 422);
      return listNotifications(db, {
        organisationId: request.org!.organisationId,
        userId: me(request),
        unreadOnly: query.data.filter === 'unread',
        ...(query.data.before ? { before: query.data.before } : {}),
      });
    },
  );

  app.post(
    '/api/v1/orgs/:orgId/notifications/read',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<{ unread: number }> => {
      const body = parseBody(markReadBodySchema, request.body);
      const unread = await markRead(db, {
        organisationId: request.org!.organisationId,
        userId: me(request),
        ids: 'all' in body ? 'all' : body.ids,
      });
      return { unread };
    },
  );

  // Watching is following: anyone who can see the ticket may watch it.
  for (const [method, watching] of [
    ['PUT', true],
    ['DELETE', false],
  ] as const) {
    app.route({
      method,
      url: '/api/v1/orgs/:orgId/tickets/:ticketKey/watch',
      preHandler: orgAccess(db, 'tickets.view'),
      handler: async (request): Promise<TicketDetail> => {
        const organisationId = request.org!.organisationId;
        const key = ticketKeyParam(request);
        const [ticket] = await db
          .select({ id: tickets.id })
          .from(tickets)
          .where(and(eq(tickets.organisationId, organisationId), eq(tickets.key, key)));
        if (!ticket) throw new AppError('not_found', 'Not found.', 404);
        await setWatching(db, {
          organisationId,
          ticketId: ticket.id,
          userId: me(request),
          watching,
        });
        return (await loadTicketDetail(db, organisationId, key))!;
      },
    });
  }

  /**
   * The live stream (server-sent events) for the signed-in person. It sends the new notification
   * and that workspace's unread count; nothing else and nobody else's. Browser sessions only.
   */
  app.get('/api/v1/me/events', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.auth!.user.id;
    const cookie = request.cookies[SESSION_COOKIE]!;
    // A handful of tabs is plenty; more is something misbehaving.
    if (hub.streamsOf(userId) >= MAX_STREAMS_PER_PERSON) {
      throw new AppError(
        'rate_limited',
        'Too many open notification streams. Close some tabs.',
        429,
      );
    }
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      // no-transform: a compressing proxy (Next's included) would otherwise hold events back.
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      // Stops proxies holding events back to fill a buffer.
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const send = async (notificationId: string) => {
      const notification = await loadNotification(db, userId, notificationId);
      if (!notification) return;
      const event: NotificationEvent = {
        unread: await unreadCount(db, notification.workspace.id, userId),
        notification,
      };
      res.write(`event: notification\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = hub.subscribe(userId, (id) => {
      send(id).catch((error) => request.log.warn({ err: error }, 'live notification failed'));
    });
    // Each heartbeat checks the session still stands: signing out ends the stream too.
    const heartbeat = setInterval(() => {
      resolveSession(db, cookie)
        .then((session) => {
          if (session?.user.id === userId) res.write(': keep-alive\n\n');
          else res.end();
        })
        .catch(() => res.end());
    }, HEARTBEAT_MS);
    heartbeat.unref();
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
