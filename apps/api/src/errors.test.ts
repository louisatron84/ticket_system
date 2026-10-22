import { apiErrorSchema } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { AppError } from './errors';
import { testConfig } from './test-utils';

async function appWithRoutes() {
  const app = await buildApp({ config: testConfig(), readinessChecks: [] });
  app.get('/boom', async () => {
    throw new Error('SELECT secret FROM users WHERE password = hunter2');
  });
  app.get('/forbidden', async () => {
    throw new AppError('forbidden', 'You cannot do that.', 403);
  });
  app.get('/invalid', async () => {
    throw new AppError('validation_failed', 'Invalid input.', 400, [
      { path: 'title', message: 'Required' },
    ]);
  });
  app.post('/echo', async (request) => ({ received: request.body }));
  return app;
}

describe('error handling', () => {
  it('answers an unknown route with the shared 404 shape', async () => {
    const app = await appWithRoutes();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('not_found');
  });

  it('answers malformed JSON with 400 validation_failed', async () => {
    const app = await appWithRoutes();
    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{bad json',
    });
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('validation_failed');
  });

  it('answers a body over 1 MiB with 413 payload_too_large', async () => {
    const app = await appWithRoutes();
    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ filler: 'x'.repeat(1_048_576) }),
    });
    expect(response.statusCode).toBe(413);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('payload_too_large');
  });

  it('hides the details of an unexpected error behind internal_error', async () => {
    const app = await appWithRoutes();
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('internal_error');
    for (const leaked of ['SELECT', 'secret', 'hunter2', 'stack', 'at ']) {
      expect(response.body).not.toContain(leaked);
    }
  });

  it('returns an AppError with its own status and code', async () => {
    const app = await appWithRoutes();
    const response = await app.inject({ method: 'GET', url: '/forbidden' });
    expect(response.statusCode).toBe(403);
    expect(apiErrorSchema.parse(response.json()).error).toMatchObject({
      code: 'forbidden',
      message: 'You cannot do that.',
    });
  });

  it('includes field-level details when provided', async () => {
    const app = await appWithRoutes();
    const response = await app.inject({ method: 'GET', url: '/invalid' });
    expect(apiErrorSchema.parse(response.json()).error.details).toEqual([
      { path: 'title', message: 'Required' },
    ]);
  });
});

describe('request ids', () => {
  it('puts the request id in both the response header and the error body', async () => {
    const app = await appWithRoutes();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    const header = response.headers['x-request-id'];
    expect(header).toEqual(expect.any(String));
    expect(response.json().error.requestId).toBe(header);
  });

  it('echoes a well-formed client request id', async () => {
    const app = await appWithRoutes();
    const response = await app.inject({
      method: 'GET',
      url: '/nope',
      headers: { 'x-request-id': 'client-req-0001' },
    });
    expect(response.headers['x-request-id']).toBe('client-req-0001');
    expect(response.json().error.requestId).toBe('client-req-0001');
  });

  it('does not echo a hostile client request id', async () => {
    const app = await appWithRoutes();
    const hostile = 'a'.repeat(10_000);
    const response = await app.inject({
      method: 'GET',
      url: '/nope',
      headers: { 'x-request-id': hostile },
    });
    expect(response.headers['x-request-id']).not.toBe(hostile);
    expect(String(response.headers['x-request-id']).length).toBeLessThanOrEqual(128);
  });
});
