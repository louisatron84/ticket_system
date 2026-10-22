import { healthLiveSchema, healthReadySchema } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import { buildApp, type AppDeps } from '../app';
import { CheckFailure, type ReadinessCheck } from '../readiness';
import { testConfig, testDb } from '../test-utils';

const passing = (name: ReadinessCheck['name']): ReadinessCheck => ({ name, run: async () => {} });

function app(checks: ReadinessCheck[], extra: Partial<AppDeps> = {}) {
  return buildApp({ config: testConfig(), readinessChecks: checks, db: testDb(), ...extra });
}

describe('GET /health/live', () => {
  it('reports the process is up without touching dependencies', async () => {
    const server = await app([
      {
        name: 'database',
        run: async () => {
          throw new Error('must not be called');
        },
      },
    ]);
    const response = await server.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(healthLiveSchema.parse(response.json())).toMatchObject({
      status: 'ok',
      version: '0.0.0-test',
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /health/ready', () => {
  it('returns 200 with every check ok and a latency', async () => {
    const server = await app([passing('database'), passing('migrations')]);
    const response = await server.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    const body = healthReadySchema.parse(response.json());
    expect(body.status).toBe('ok');
    expect(body.checks.database).toMatchObject({ status: 'ok', latencyMs: expect.any(Number) });
    expect(body.checks.migrations).toMatchObject({ status: 'ok', latencyMs: expect.any(Number) });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 degraded when one check fails and keeps the others ok', async () => {
    const server = await app([
      passing('database'),
      {
        name: 'migrations',
        run: async () => {
          throw new CheckFailure('migrations pending');
        },
      },
    ]);
    const response = await server.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    const body = healthReadySchema.parse(response.json());
    expect(body.status).toBe('degraded');
    expect(body.checks.database?.status).toBe('ok');
    expect(body.checks.migrations).toMatchObject({
      status: 'failed',
      detail: 'migrations pending',
    });
  });

  it('returns 503 within the timeout when a check never settles', async () => {
    const server = await app([{ name: 'database', run: () => new Promise(() => {}) }], {
      readinessTimeoutMs: 50,
    });
    const started = Date.now();
    const response = await server.inject({ method: 'GET', url: '/health/ready' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(response.statusCode).toBe(503);
    expect(healthReadySchema.parse(response.json()).checks.database).toMatchObject({
      status: 'failed',
      detail: 'timeout',
    });
  });

  it('aborts the signal handed to a check that times out', async () => {
    let signal: AbortSignal | undefined;
    const server = await app(
      [
        {
          name: 'database',
          run: (s) => {
            signal = s;
            return new Promise(() => {});
          },
        },
      ],
      { readinessTimeoutMs: 20 },
    );
    await server.inject({ method: 'GET', url: '/health/ready' });
    expect(signal?.aborted).toBe(true);
  });

  it('never leaks a driver error message that contains a connection string', async () => {
    const server = await app([
      {
        name: 'database',
        run: async () => {
          throw new Error('connect ECONNREFUSED postgres://forge:hunter2@10.0.0.5:5432/forge');
        },
      },
    ]);
    const response = await server.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('hunter2');
    expect(response.body).not.toContain('postgres://');
    expect(healthReadySchema.parse(response.json()).checks.database?.detail).toBe('unreachable');
  });

  it('runs checks concurrently rather than one after another', async () => {
    const slow = (name: ReadinessCheck['name']): ReadinessCheck => ({
      name,
      run: () => new Promise((resolve) => setTimeout(resolve, 150)),
    });
    const server = await app([slow('database'), slow('migrations')]);
    const started = Date.now();
    await server.inject({ method: 'GET', url: '/health/ready' });
    expect(Date.now() - started).toBeLessThan(290);
  });
});
