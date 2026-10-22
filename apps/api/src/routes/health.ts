import type { CheckResult, HealthLive, HealthReady } from '@forge/shared';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { CheckFailure, type ReadinessCheck } from '../readiness';

const DEFAULT_CHECK_TIMEOUT_MS = 2000;

class CheckTimeout extends Error {}

type HealthOptions = {
  checks: ReadinessCheck[];
  version: string;
  checkTimeoutMs?: number;
};

async function runCheck(
  check: ReadinessCheck,
  timeoutMs: number,
  log: FastifyBaseLogger,
): Promise<[string, CheckResult]> {
  const controller = new AbortController();
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CheckTimeout());
    }, timeoutMs);
  });

  try {
    await Promise.race([check.run(controller.signal), timeout]);
    return [check.name, { status: 'ok', latencyMs: elapsed() }];
  } catch (error) {
    log.warn({ err: error, check: check.name }, 'readiness check failed');
    const detail =
      error instanceof CheckTimeout
        ? 'timeout'
        : error instanceof CheckFailure
          ? error.message
          : 'unreachable';
    return [check.name, { status: 'failed', latencyMs: elapsed(), detail }];
  } finally {
    clearTimeout(timer);
  }
}

export function registerHealthRoutes(app: FastifyInstance, options: HealthOptions): void {
  const startedAt = Date.now();
  const timeoutMs = options.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;

  app.get('/health/live', async (_request, reply): Promise<HealthLive> => {
    reply.header('cache-control', 'no-store');
    return {
      status: 'ok',
      version: options.version,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    };
  });

  app.get('/health/ready', async (request, reply): Promise<HealthReady> => {
    reply.header('cache-control', 'no-store');
    const results = await Promise.all(
      options.checks.map((check) => runCheck(check, timeoutMs, request.log)),
    );
    const healthy = results.every(([, result]) => result.status === 'ok');
    reply.status(healthy ? 200 : 503);
    return { status: healthy ? 'ok' : 'degraded', checks: Object.fromEntries(results) };
  });
}
