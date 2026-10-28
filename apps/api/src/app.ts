import type { Db } from '@forge/db';
import { REQUEST_ID_HEADER } from '@forge/shared';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { registerAuth } from './auth/plugin';
import type { AppConfig } from './config';
import { registerErrorHandling } from './errors';
import type { ReadinessCheck } from './readiness';
import { resolveRequestId } from './request-id';
import { registerAuthRoutes } from './routes/auth';
import { registerDevRoutes } from './routes/dev';
import { registerHealthRoutes } from './routes/health';
import { registerMeRoutes } from './routes/me';
import { registerOrgRoutes } from './routes/orgs';
import { registerPreferencesRoutes } from './routes/preferences';
import { registerCommentRoutes } from './routes/comments';
import { registerLabelRoutes } from './routes/labels';
import { registerProjectRoutes } from './routes/projects';
import { registerTicketRoutes } from './routes/tickets';
import { registerTicketContentRoutes } from './routes/ticket-content';
import { registerTicketStructureRoutes } from './routes/ticket-structure';
import { localDiskStorage, type AttachmentStorage } from './attachments/storage';
import { registerTokenRoutes } from './routes/tokens';
import { registerNotificationRoutes } from './routes/notifications';
import { registerTriageRoutes } from './routes/triage';
import { NotificationHub } from './notifications/hub';
import { registerViewRoutes } from './routes/views';

export type { ReadinessCheck } from './readiness';

export type AppDeps = {
  config: AppConfig;
  readinessChecks: ReadinessCheck[];
  db: Db;
  /** Per-check deadline for /health/ready; defaults to 2000 ms. */
  readinessTimeoutMs?: number;
  /** Where attachment files go; local disk under `config.attachmentsDir` unless given. */
  storage?: AttachmentStorage;
  /** Live notification delivery; one is made from the config unless given. */
  hub?: NotificationHub;
};

const BODY_LIMIT_BYTES = 1_048_576;

/** Builds the app without starting it, so tests can add routes before the first request. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;

  // Belt and braces: loadConfig already refuses this, but nothing else may build such an app.
  if (config.devAuth && config.nodeEnv === 'production') {
    throw new Error('FORGE_DEV_AUTH must not be enabled when NODE_ENV=production');
  }

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      ...(config.nodeEnv === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
    bodyLimit: BODY_LIMIT_BYTES,
    // The web app proxies the browser (and the forge command) from this machine, and says who the
    // real caller is in X-Forwarded-For. Only a proxy on loopback is believed.
    trustProxy: 'loopback',
    // Never trust the client's header directly; genReqId validates it.
    requestIdHeader: false,
    genReqId: (request) => resolveRequestId(request.headers[REQUEST_ID_HEADER]),
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    // The API only ever answers with data, never a page: nothing it sends may run, be framed or
    // be second-guessed as another type. A route that sends a file sets its own stricter policy.
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('referrer-policy', 'no-referrer');
    if (config.nodeEnv === 'production') {
      reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains');
    }
  });

  registerErrorHandling(app);
  await registerAuth(app, { config, db: deps.db });
  registerMeRoutes(app, { db: deps.db });
  registerAuthRoutes(app, { db: deps.db });
  registerOrgRoutes(app, { db: deps.db });
  registerPreferencesRoutes(app, { db: deps.db });
  registerProjectRoutes(app, { db: deps.db });
  registerTicketRoutes(app, { db: deps.db });
  registerTicketStructureRoutes(app, { db: deps.db });
  registerTicketContentRoutes(app, {
    db: deps.db,
    storage: deps.storage ?? localDiskStorage(config.attachmentsDir),
  });
  registerCommentRoutes(app, { db: deps.db });
  registerLabelRoutes(app, { db: deps.db });
  registerViewRoutes(app, { db: deps.db });
  registerTokenRoutes(app, { db: deps.db, config });
  const hub =
    deps.hub ??
    new NotificationHub(config.databaseUrl, (message, error) =>
      app.log.warn({ err: error }, message),
    );
  app.decorate('notificationHub', hub);
  app.addHook('onClose', async () => hub.close());
  registerNotificationRoutes(app, { db: deps.db, hub });
  registerTriageRoutes(app, { db: deps.db });
  if (config.devAuth) registerDevRoutes(app, { db: deps.db, config });
  registerHealthRoutes(app, {
    checks: deps.readinessChecks,
    version: config.version,
    ...(deps.readinessTimeoutMs !== undefined ? { checkTimeoutMs: deps.readinessTimeoutMs } : {}),
  });

  return app;
}
