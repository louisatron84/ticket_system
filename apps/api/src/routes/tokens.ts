import { organisations, users, type Db } from '@forge/db';
import {
  cliLoginDecisionBodySchema,
  cliLoginLookupBodySchema,
  cliLoginStartBodySchema,
  cliTokenPollBodySchema,
  createTokenBodySchema,
  type ApiToken,
  type CliLoginRequest,
  type CliTokenPoll,
  type CliWhoAmI,
  type CreatedToken,
} from '@forge/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { decideLogin, lookupLogin, pollLogin, startLogin } from '../auth/cli-login';
import { requireUser } from '../auth/guards';
import { rateLimiter } from '../auth/rate-limit';
import { createdToken, listTokens, loadToken, revokeToken } from '../auth/tokens';
import type { AppConfig } from '../config';
import { AppError } from '../errors';
import { parseBody } from '../validation';

/** Route guard for the command line's own routes: a valid bearer token is required. */
const requireToken: preHandlerAsyncHookHandler = async (request) => {
  if (!request.token) throw new AppError('unauthenticated', 'Sign in with `forge login`.', 401);
};

/** CLI tokens (managed from the browser only) and signing the command line in. */
export function registerTokenRoutes(
  app: FastifyInstance,
  deps: { db: Db; config: AppConfig },
): void {
  const { db, config } = deps;
  // Starting a login is open to anyone, so it is limited per address; so are guesses at a code.
  const starts = rateLimiter(10, 10 * 60_000);
  const guesses = rateLimiter(5, 60_000);
  const polls = rateLimiter(30, 60_000);

  app.get('/api/v1/me/tokens', { preHandler: requireUser }, async (request): Promise<ApiToken[]> =>
    listTokens(db, request.auth!.user.id),
  );

  app.post(
    '/api/v1/me/tokens',
    { preHandler: requireUser },
    async (request, reply): Promise<CreatedToken> => {
      const body = parseBody(createTokenBodySchema, request.body);
      const made = await createdToken(db, {
        userId: request.auth!.user.id,
        organisationId: body.organisationId,
        name: body.name,
        scope: body.scope,
        expiresInDays: body.expiresInDays,
        createdVia: 'page',
        requestId: request.id,
      });
      reply.status(201);
      return made;
    },
  );

  app.delete('/api/v1/me/tokens/:tokenId', { preHandler: requireUser }, async (request, reply) => {
    const parsed = z.uuid().safeParse((request.params as { tokenId: string }).tokenId);
    if (!parsed.success) throw new AppError('not_found', 'Not found.', 404);
    await revokeToken(db, {
      userId: request.auth!.user.id,
      tokenId: parsed.data,
      requestId: request.id,
    });
    reply.status(204).send();
  });

  app.post('/api/v1/cli/login', async (request, reply) => {
    starts.hit(`start:${request.ip}`, 'Too many sign-in attempts from here. Try again later.');
    const { machine } = parseBody(cliLoginStartBodySchema, request.body);
    reply.status(201);
    return startLogin(db, { machine, ip: request.ip, verificationBase: config.webOrigins[0]! });
  });

  app.post('/api/v1/cli/token', async (request): Promise<CliTokenPoll> => {
    const { deviceCode } = parseBody(cliTokenPollBodySchema, request.body);
    // Per login, not per address: many people may sign in from behind one address.
    polls.hit(`poll:${deviceCode}`);
    return pollLogin(db, { deviceCode, requestId: request.id });
  });

  app.post(
    '/api/v1/cli/login/lookup',
    { preHandler: requireUser },
    async (request): Promise<CliLoginRequest> => {
      guesses.hit(`code:${request.auth!.user.id}`);
      return lookupLogin(db, parseBody(cliLoginLookupBodySchema, request.body).userCode);
    },
  );

  app.post('/api/v1/cli/login/decision', { preHandler: requireUser }, async (request, reply) => {
    guesses.hit(`code:${request.auth!.user.id}`);
    const body = parseBody(cliLoginDecisionBodySchema, request.body);
    await decideLogin(db, { ...body, userId: request.auth!.user.id });
    reply.status(204).send();
  });

  app.get(
    '/api/v1/cli/whoami',
    { preHandler: requireToken },
    async (request): Promise<CliWhoAmI> => {
      const token = request.token!;
      const [user] = await db
        .select({ displayName: users.displayName, email: users.email })
        .from(users)
        .where(eq(users.id, token.userId));
      const [workspace] = await db
        .select({ id: organisations.id, slug: organisations.slug, name: organisations.name })
        .from(organisations)
        .where(eq(organisations.id, token.organisationId));
      const details = await loadToken(db, token.userId, token.tokenId);
      return {
        user: user!,
        workspace: workspace!,
        scope: token.scope,
        expiresAt: details.expiresAt,
      };
    },
  );

  app.post('/api/v1/cli/logout', { preHandler: requireToken }, async (request, reply) => {
    const token = request.token!;
    await revokeToken(db, { userId: token.userId, tokenId: token.tokenId, requestId: request.id });
    reply.status(204).send();
  });
}
