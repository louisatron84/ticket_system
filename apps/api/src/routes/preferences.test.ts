import { apiErrorSchema, preferencesSchema, viewerSchema } from '@forge/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;

beforeAll(async () => {
  ctx = await startIntegration();
});

beforeEach(async () => {
  await ctx.reseed();
});

afterAll(async () => {
  await ctx.close();
});

const get = (cookie?: string) =>
  ctx.app.inject({
    method: 'GET',
    url: '/api/v1/me/preferences',
    headers: cookie ? { cookie } : {},
  });
const patch = (
  cookie: string | undefined,
  payload: unknown,
  headers: Record<string, string> = {},
) =>
  ctx.app.inject({
    method: 'PATCH',
    url: '/api/v1/me/preferences',
    payload: payload as object,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });

describe('/api/v1/me/preferences', () => {
  it('answers 401 when nobody is signed in', async () => {
    expect((await get()).statusCode).toBe(401);
    const response = await patch(undefined, { sidebarCollapsed: true });
    expect(response.statusCode).toBe(401);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('unauthenticated');
  });

  it('starts empty', async () => {
    const response = await get(await ctx.cookieFor('owner'));
    expect(response.statusCode).toBe(200);
    expect(preferencesSchema.parse(response.json())).toEqual({});
  });

  it('stores a change and shows it in /me too', async () => {
    const cookie = await ctx.cookieFor('owner');
    const response = await patch(cookie, { sidebarCollapsed: true });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sidebarCollapsed: true });

    expect((await get(cookie)).json()).toEqual({ sidebarCollapsed: true });
    const me = await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(viewerSchema.parse(me.json()).preferences).toEqual({ sidebarCollapsed: true });
  });

  it('merges: an empty patch keeps what was stored, and a later patch overrides it', async () => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { sidebarCollapsed: true });
    expect((await patch(cookie, {})).json()).toEqual({ sidebarCollapsed: true });
    expect((await patch(cookie, { sidebarCollapsed: false })).json()).toEqual({
      sidebarCollapsed: false,
    });
  });

  it.each([
    ['an unknown key', { theme: 'light' }],
    ['a wrong type', { sidebarCollapsed: 'yes' }],
    ['a nested object', { sidebarCollapsed: { deep: true } }],
    ['no body', undefined],
  ])('refuses %s with 422 and keeps the stored value', async (_label, payload) => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { sidebarCollapsed: true });
    const response = await patch(cookie, payload);
    expect(response.statusCode).toBe(422);
    expect((await get(cookie)).json()).toEqual({ sidebarCollapsed: true });
  });

  it("never mixes two people's preferences", async () => {
    const owner = await ctx.cookieFor('owner');
    const admin = await ctx.cookieFor('admin');
    await patch(owner, { sidebarCollapsed: true });
    expect((await get(admin)).json()).toEqual({});
    await patch(admin, { sidebarCollapsed: false });
    expect((await get(owner)).json()).toEqual({ sidebarCollapsed: true });
  });

  it('refuses a write from a foreign Origin', async () => {
    const cookie = await ctx.cookieFor('owner');
    const response = await patch(
      cookie,
      { sidebarCollapsed: true },
      { origin: 'http://evil.test' },
    );
    expect(response.statusCode).toBe(403);
    expect((await get(cookie)).json()).toEqual({});
  });
});
