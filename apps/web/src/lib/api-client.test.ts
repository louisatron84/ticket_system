import { describe, expect, it } from 'vitest';
import { ApiRequestError, apiFetch } from './api-client';

const respond = (status: number, body?: unknown) => async () =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('apiFetch', () => {
  it('returns parsed JSON for a successful response', async () => {
    expect(await apiFetch('/api/v1/x', {}, respond(200, { ok: true }))).toEqual({ ok: true });
  });

  it('returns undefined for 204 No Content', async () => {
    expect(await apiFetch('/api/v1/x', { method: 'POST' }, respond(204))).toBeUndefined();
  });

  it('sends JSON bodies with the right header and same-origin credentials', async () => {
    let seen: RequestInit | undefined;
    await apiFetch('/api/v1/x', { method: 'PATCH', json: { a: 1 } }, async (_url, init) => {
      seen = init;
      return new Response('{}', { status: 200 });
    });
    expect(seen?.method).toBe('PATCH');
    expect(seen?.body).toBe('{"a":1}');
    expect(new Headers(seen?.headers).get('content-type')).toBe('application/json');
    expect(seen?.credentials).toBe('same-origin');
  });

  it('turns the shared error shape into an ApiRequestError', async () => {
    const error = await apiFetch(
      '/api/v1/x',
      {},
      respond(403, { error: { code: 'forbidden', message: 'No.', requestId: 'req-1' } }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 403, code: 'forbidden', message: 'No.' });
  });

  it('still throws a useful error when the body is not the shared shape', async () => {
    const error = await apiFetch(
      '/api/v1/x',
      {},
      async () => new Response('<html>', { status: 502 }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 502, code: 'internal_error' });
  });

  it('reports a network failure as an ApiRequestError with status 0', async () => {
    const error = await apiFetch('/api/v1/x', {}, async () => {
      throw new TypeError('Failed to fetch');
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 0 });
  });
});
