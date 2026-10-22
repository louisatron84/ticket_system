import { apiErrorSchema, PERMISSIONS, viewerSchema } from '@forge/shared';
import { sessions, userPreferences, users } from '@forge/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;

beforeAll(async () => {
  ctx = await startIntegration();
});

afterAll(async () => {
  await ctx.close();
});

const me = (cookie?: string) =>
  ctx.app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: cookie ? { cookie } : {},
  });

describe('GET /api/v1/me', () => {
  it('answers 401 in the shared error shape without a cookie', async () => {
    const response = await me();
    expect(response.statusCode).toBe(401);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('unauthenticated');
  });

  it.each([
    ['a garbage cookie', 'forge_session=garbage'],
    ['an unissued token', `forge_session=${'A'.repeat(43)}`],
    ['an empty cookie', 'forge_session='],
    ['an unrelated cookie', 'theme=dark'],
  ])('answers 401 for %s', async (_label, cookie) => {
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('answers 401 for a real token with one character changed', async () => {
    const cookie = await ctx.cookieFor('owner');
    const last = cookie.at(-1)!;
    const tampered = cookie.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    expect((await me(tampered)).statusCode).toBe(401);
  });

  it('describes the owner and their permissions', async () => {
    const response = await me(await ctx.cookieFor('owner'));
    expect(response.statusCode).toBe(200);
    const viewer = viewerSchema.parse(response.json());
    expect(viewer.user).toMatchObject({ email: 'owner@acme.test', displayName: 'Olivia Owner' });
    expect(viewer.memberships).toHaveLength(1);
    expect(viewer.memberships[0]).toMatchObject({
      organisation: { slug: 'acme', name: 'Acme Robotics' },
      role: { key: 'owner' },
    });
    expect([...viewer.memberships[0]!.permissions].sort()).toEqual([...PERMISSIONS].sort());
    expect(viewer.preferences).toEqual({});
  });

  it('lists a developer in both workspaces, ordered by name', async () => {
    const viewer = viewerSchema.parse((await me(await ctx.cookieFor('developer'))).json());
    expect(viewer.memberships.map((m) => [m.organisation.slug, m.role.key])).toEqual([
      ['acme', 'developer'],
      ['northwind', 'readonly'],
    ]);
  });

  it('gives a restricted member no permissions', async () => {
    const viewer = viewerSchema.parse((await me(await ctx.cookieFor('restricted'))).json());
    expect(viewer.memberships[0]).toMatchObject({ role: { key: 'restricted' }, permissions: [] });
  });

  it("includes the person's stored preferences", async () => {
    const [admin] = await ctx.db.select().from(users).where(eq(users.email, 'admin@acme.test'));
    await ctx.db
      .insert(userPreferences)
      .values({ userId: admin!.id, data: { sidebarCollapsed: true } });
    const viewer = viewerSchema.parse((await me(await ctx.cookieFor('admin'))).json());
    expect(viewer.preferences).toEqual({ sidebarCollapsed: true });
  });

  it('answers 401 after the session has expired or been revoked', async () => {
    const expired = await ctx.cookieFor('owner');
    await ctx.db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` });
    expect((await me(expired)).statusCode).toBe(401);

    const revoked = await ctx.cookieFor('owner');
    await ctx.db.update(sessions).set({ revokedAt: sql`now()` });
    expect((await me(revoked)).statusCode).toBe(401);
  });

  it('is never cached, because it differs per identity', async () => {
    const response = await me(await ctx.cookieFor('owner'));
    expect(response.headers['cache-control']).toBe('no-store');
    const unauthenticated = await me();
    expect(unauthenticated.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /api/v1/auth/logout', () => {
  const logout = (cookie: string, origin?: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, ...(origin ? { origin } : {}) },
    });

  it('revokes the session on the server and clears the cookie', async () => {
    const cookie = await ctx.cookieFor('owner');
    expect((await me(cookie)).statusCode).toBe(200);

    const response = await logout(cookie);
    expect(response.statusCode).toBe(204);
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/forge_session=;/);
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);

    // Replaying the old cookie must fail: the session is dead on the server, not just in the browser.
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('answers 401 when nobody is signed in', async () => {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a foreign Origin before doing anything', async () => {
    const cookie = await ctx.cookieFor('owner');
    const response = await logout(cookie, 'http://evil.test');
    expect(response.statusCode).toBe(403);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('forbidden');
    expect((await me(cookie)).statusCode).toBe(200);
  });

  it('accepts the web app origin', async () => {
    const cookie = await ctx.cookieFor('owner');
    expect((await logout(cookie, 'http://localhost:3000')).statusCode).toBe(204);
  });
});
