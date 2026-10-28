import fastifyCookie from '@fastify/cookie';
import type { Db } from '@forge/db';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config';
import { AppError } from '../errors';
import { assertAllowedOrigin } from './origin';
import { SESSION_COOKIE, resolveSession, type ResolvedSession } from './sessions';
import { resolveToken, type TokenGrant } from './tokens';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in session, or null. Set for every /api request. */
    auth: ResolvedSession | null;
    /**
     * A command-line token, or null. It is honoured only by `orgAccess` (its own workspace) and the
     * `/api/v1/cli` routes; everything else needs a browser session.
     */
    token: TokenGrant | null;
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
  app.decorateRequest('token', null);

  // 1. Writes must come from our own web app (see origin.ts).
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    if (!assertAllowedOrigin(request.headers.origin, deps.config.webOrigins)) {
      throw new AppError('forbidden', 'Cross-origin requests are not allowed.', 403);
    }
  });

  // 2. Identify the caller: a session cookie (the browser) or a bearer token (the command line).
  app.addHook('onRequest', async (request) => {
    if (!isApiPath(request.url)) return;
    const cookie = request.cookies[SESSION_COOKIE];
    const header = request.headers.authorization;
    if (header !== undefined) {
      // One identity per request: a cookie and a token together could only confuse the checks.
      if (cookie) {
        throw new AppError('unauthenticated', 'Send a session cookie or a token, not both.', 401);
      }
      const bearer = /^Bearer (\S+)$/.exec(header)?.[1];
      request.token = bearer
        ? await resolveToken(deps.db, bearer, { ip: request.ip, requestId: request.id })
        : null;
      return;
    }
    request.auth = cookie ? await resolveSession(deps.db, cookie) : null;
  });

  // 3. Responses differ per identity, so no cache may keep them.
  app.addHook('onSend', async (request, reply) => {
    if (isApiPath(request.url) && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
  });
}
