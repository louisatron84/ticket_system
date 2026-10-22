import { describe, expect, it } from 'vitest';
import { fetchReadiness } from './api';

const readyOk = {
  status: 'ok',
  checks: { database: { status: 'ok', latencyMs: 3 }, migrations: { status: 'ok', latencyMs: 4 } },
};
const readyDegraded = {
  status: 'degraded',
  checks: { database: { status: 'failed', detail: 'timeout' }, migrations: { status: 'ok' } },
};

const respond = (status: number, body: unknown) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('fetchReadiness', () => {
  it('returns ok for a healthy 200 response', async () => {
    const result = await fetchReadiness('http://api', respond(200, readyOk));
    expect(result).toEqual({ kind: 'ok', body: readyOk });
  });

  it('returns degraded for a 503 with a valid report', async () => {
    const result = await fetchReadiness('http://api', respond(503, readyDegraded));
    expect(result).toEqual({ kind: 'degraded', body: readyDegraded });
  });

  it('asks the right URL without caching', async () => {
    let seen: { url: string; cache?: RequestCache } | undefined;
    await fetchReadiness('http://api:4000', async (input, init) => {
      seen = { url: String(input), cache: init?.cache };
      return new Response(JSON.stringify(readyOk), { status: 200 });
    });
    expect(seen).toEqual({ url: 'http://api:4000/health/ready', cache: 'no-store' });
  });

  it('treats a 200 with an unexpected body as unreachable', async () => {
    const result = await fetchReadiness('http://api', respond(200, { foo: 1 }));
    expect(result).toEqual({ kind: 'unreachable', reason: 'unexpected response' });
  });

  it('treats a non-JSON body as unreachable', async () => {
    const result = await fetchReadiness('http://api', respond(502, '<html>Bad gateway</html>'));
    expect(result).toEqual({ kind: 'unreachable', reason: 'unexpected response' });
  });

  it('treats an unexpected status as unreachable even with a valid body', async () => {
    const result = await fetchReadiness('http://api', respond(500, readyOk));
    expect(result).toEqual({ kind: 'unreachable', reason: 'unexpected response' });
  });

  it('treats a network failure as unreachable', async () => {
    const result = await fetchReadiness('http://api', async () => {
      throw new TypeError('fetch failed');
    });
    expect(result).toEqual({ kind: 'unreachable', reason: 'network error' });
  });

  it('gives up on a request that never settles', async () => {
    const started = Date.now();
    const result = await fetchReadiness('http://api', () => new Promise<Response>(() => {}), 40);
    expect(result).toEqual({ kind: 'unreachable', reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
