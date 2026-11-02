import { developmentFixtures, reseedDevelopmentData, users, type Db } from '@forge/db';
import { devResetBodySchema, devSessionBodySchema, type DevIdentity } from '@forge/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { recordAudit } from '../audit';
import { sessionCookieOptions } from '../auth/cookies';
import { requireUser } from '../auth/guards';
import { isLoopbackAddress, isLoopbackHost } from '../auth/host';
import { SESSION_COOKIE, createSession, revokeSession } from '../auth/sessions';
import type { AppConfig } from '../config';
import { AppError } from '../errors';
import { parseBody } from '../validation';

const identityColumns = {
  key: developmentFixtures.key,
  label: developmentFixtures.label,
  description: developmentFixtures.description,
  email: users.email,
  displayName: users.displayName,
};

/**
 * Development-only account switcher. Registered only when FORGE_DEV_AUTH is on (and never in
 * production). Sign-in accepts a seeded identity *key*: there is no way to name an arbitrary user.
 */
/** The database people keep their own work in. The reset button never touches it. */
const PROTECTED_DATABASE = 'forge';

export function registerDevRoutes(app: FastifyInstance, deps: { db: Db; config: AppConfig }): void {
  const { db, config } = deps;

  // Refuse requests that reached us through a non-local DNS name, including via the web proxy,
  // and any connection from another machine, whatever its headers claim (an API bound to a
  // network address would otherwise hand out sessions to anyone who sends `Host: localhost`).
  const localOnly: preHandlerAsyncHookHandler = async (request) => {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      throw new AppError('forbidden', 'The development switcher is only available locally.', 403);
    }
    const forwarded = request.headers['x-forwarded-host'];
    const forwardedOk =
      forwarded === undefined ||
      (Array.isArray(forwarded) ? forwarded.every(isLoopbackHost) : isLoopbackHost(forwarded));
    if (!isLoopbackHost(request.headers.host) || !forwardedOk) {
      throw new AppError('forbidden', 'The development switcher is only available locally.', 403);
    }
  };

  app.get('/api/dev/identities', { preHandler: localOnly }, async (): Promise<DevIdentity[]> => {
    return db
      .select(identityColumns)
      .from(developmentFixtures)
      .innerJoin(users, eq(users.id, developmentFixtures.userId))
      .orderBy(asc(developmentFixtures.sortOrder));
  });

  app.post('/api/dev/session', { preHandler: localOnly }, async (request, reply) => {
    const { key } = parseBody(devSessionBodySchema, request.body);

    const [identity] = await db
      .select({ ...identityColumns, userId: developmentFixtures.userId })
      .from(developmentFixtures)
      .innerJoin(users, eq(users.id, developmentFixtures.userId))
      .where(eq(developmentFixtures.key, key));
    if (!identity) throw new AppError('not_found', 'No such test identity.', 404);

    const previous = request.auth;
    const { token } = await db.transaction(async (tx) => {
      const created = await createSession(tx, {
        userId: identity.userId,
        ttlHours: config.sessionTtlHours,
        createdVia: 'dev',
      });
      // One switch leaves exactly one live session: the one being switched away from ends here.
      if (previous) await revokeSession(tx, previous.sessionId);
      await recordAudit(tx, {
        ...(previous ? { actorUserId: previous.user.id } : {}),
        action: 'dev.session.created',
        targetType: 'user',
        targetId: identity.userId,
        after: { identityKey: key },
        requestId: request.id,
        source: 'dev',
        outcome: 'success',
      });
      return created;
    });

    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(config));
    const { userId: _userId, ...publicIdentity } = identity;
    return { identity: publicIdentity satisfies DevIdentity };
  });

  // Wiping every table signs everyone out and deletes all data, so it is a switch of its own,
  // off unless FORGE_DEV_RESET is set. The command `npm run db:reseed` still works either way.
  if (!config.devReset) return;

  // Which database a reset would wipe: its name and the port of the server holding it, so two
  // servers on one machine with a database of the same name are told apart.
  const target = async (): Promise<{ database: string; port: number | null }> => {
    const { rows } = await db.execute<{ name: string; port: number | null }>(
      sql`select current_database() as name, inet_server_port() as port`,
    );
    return { database: rows[0]!.name, port: rows[0]!.port };
  };

  // Says which database a reset would wipe, so the caller can name it back.
  app.get('/api/dev/reset', { preHandler: localOnly }, target);

  // Only someone signed in may reset, and only by naming the database: a test run that finds some
  // other copy of Forge on its port is refused instead of wiping that copy's data.
  app.post('/api/dev/reset', { preHandler: [localOnly, requireUser] }, async (request, reply) => {
    const named = parseBody(devResetBodySchema, request.body);
    const { database: name, port } = await target();
    // The main development database is where people keep their own work: never from a button.
    if (name === PROTECTED_DATABASE) {
      throw new AppError(
        'forbidden',
        'Reset is refused on the main "forge" database. Run npm run db:reseed if you really mean it.',
        403,
      );
    }
    if (named.database !== name || named.port !== port) {
      throw new AppError(
        'conflict',
        `This server uses the database "${name}" on port ${port ?? 'none'}, not "${named.database}" on port ${named.port ?? 'none'}. Nothing was reset.`,
        409,
      );
    }
    await reseedDevelopmentData(db);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });
}
