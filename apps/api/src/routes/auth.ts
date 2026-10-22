import type { Db } from '@forge/db';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/guards';
import { SESSION_COOKIE, revokeSession } from '../auth/sessions';

export function registerAuthRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.post('/api/v1/auth/logout', { preHandler: requireUser }, async (request, reply) => {
    await revokeSession(deps.db, request.auth!.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });
}
