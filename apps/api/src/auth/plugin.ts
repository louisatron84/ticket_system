import fastifyCookie from '@fastify/cookie';
import type { Db } from '@forge/db';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config';
import { AppError } from '../errors';
import { assertAllowedOrigin } from './origin';
import { SESSION_COOKIE, resolveSession, type ResolvedSession } from './sessions';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in session, or null. Set for every /api request. */
    auth: ResolvedSession | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const isApiPath = (url: string) => url.startsWith('/api/');

export async function registerAuth(
  app: FastifyInstance,
  deps: { config: AppConfig; db: Db },
): Promise<void> {
  await app.register(fastifyCookie);
  app.decorateRequest('auth', null);
  app.decorateRequest('org', null);

  // 1. Writes must come from our own web app (see origin.ts).
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    if (!assertAllowedOrigin(request.headers.origin, deps.config.webOrigins)) {
      throw new AppError('forbidden', 'Cross-origin requests are not allowed.', 403);
    }
  });

  // 2. Identify the caller from the session cookie, if any.
  app.addHook('onRequest', async (request) => {
    if (!isApiPath(request.url)) return;
    const token = request.cookies[SESSION_COOKIE];
    request.auth = token ? await resolveSession(deps.db, token) : null;
  });

  // 3. Responses differ per identity, so no cache may keep them.
  app.addHook('onSend', async (request, reply) => {
    if (isApiPath(request.url) && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
  });
}
