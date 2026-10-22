import { REQUEST_ID_HEADER } from '@forge/shared';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { AppConfig } from './config';
import { registerErrorHandling } from './errors';
import type { ReadinessCheck } from './readiness';
import { resolveRequestId } from './request-id';
import { registerHealthRoutes } from './routes/health';

export type { ReadinessCheck } from './readiness';

export type AppDeps = {
  config: AppConfig;
  readinessChecks: ReadinessCheck[];
  /** Per-check deadline for /health/ready; defaults to 2000 ms. */
  readinessTimeoutMs?: number;
};

const BODY_LIMIT_BYTES = 1_048_576;

/** Builds the app without starting it, so tests can add routes before the first request. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;

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
    // Never trust the client's header directly; genReqId validates it.
    requestIdHeader: false,
    genReqId: (request) => resolveRequestId(request.headers[REQUEST_ID_HEADER]),
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  registerErrorHandling(app);
  registerHealthRoutes(app, {
    checks: deps.readinessChecks,
    version: config.version,
    ...(deps.readinessTimeoutMs !== undefined ? { checkTimeoutMs: deps.readinessTimeoutMs } : {}),
  });

  return app;
}
