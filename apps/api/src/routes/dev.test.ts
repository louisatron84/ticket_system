import { apiErrorSchema, devIdentitySchema, viewerSchema } from '@forge/shared';
import { DEV_IDENTITIES, auditEvents, sessions, users } from '@forge/db';
import { eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { startIntegration, type Integration } from '../test-support/integration';
import { testConfig } from '../test-utils';

let ctx: Integration;

beforeAll(async () => {
  ctx = await startIntegration({ devAuth: true });
});

beforeEach(async () => {
  await ctx.reseed();
});

afterAll(async () => {
  await ctx.close();
});

type Headers = Record<string, string>;
const listIdentities = (headers: Headers = {}) =>
  ctx.app.inject({ method: 'GET', url: '/api/dev/identities', headers });
const signInAs = (payload: unknown, headers: Headers = {}) =>
  ctx.app.inject({ method: 'POST', url: '/api/dev/session', payload: payload as object, headers });
const reset = (headers: Headers = {}) =>
  ctx.app.inject({ method: 'POST', url: '/api/dev/reset', headers });
const me = (cookie: string) =>
  ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });

/** The `name=value` part of a Set-Cookie header, usable as a request cookie. */
function cookieFrom(response: { headers: Record<string, unknown> }): string {
  return String(response.headers['set-cookie']).split(';')[0]!;
}

describe('when development sign-in is switched off', () => {
  it('does not exist: every route is a plain 404 and sets no cookie', async () => {
    const off = await buildApp({
      config: testConfig({ devAuth: false }),
      readinessChecks: [],
      db: ctx.db,
    });
    const responses = await Promise.all([
      off.inject({ method: 'GET', url: '/api/dev/identities' }),
      off.inject({ method: 'POST', url: '/api/dev/session', payload: { key: 'admin' } }),
      off.inject({ method: 'POST', url: '/api/dev/reset' }),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('not_found');
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    await off.close();
  });

  it('cannot be built at all in production', async () => {
    await expect(
      buildApp({
        config: testConfig({ nodeEnv: 'production', devAuth: true }),
        readinessChecks: [],
        db: ctx.db,
      }),
    ).rejects.toThrow(/FORGE_DEV_AUTH/);
  });
});

describe('GET /api/dev/identities', () => {
  it('lists the seven seeded identities in order, without any ids', async () => {
    const response = await listIdentities();
    expect(response.statusCode).toBe(200);
    const identities = devIdentitySchema.array().parse(response.json());
    expect(identities.map((identity) => identity.key)).toEqual(DEV_IDENTITIES.map((i) => i.key));
    for (const identity of response.json() as Record<string, unknown>[]) {
      expect(Object.keys(identity).sort()).toEqual([
        'description',
        'displayName',
        'email',
        'key',
        'label',
      ]);
    }
  });
});

describe('POST /api/dev/session', () => {
  it('signs in as the identity with that key and sets a safe cookie', async () => {
    const response = await signInAs({ key: 'admin' });
    expect(response.statusCode).toBe(200);
    expect(response.json().identity).toMatchObject({ key: 'admin', email: 'admin@acme.test' });

    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/^forge_session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Secure/i);

    const viewer = viewerSchema.parse((await me(cookieFrom(response))).json());
    expect(viewer.user.displayName).toBe('Adam Admin');
  });

  it('answers 404 for a key that is not a seeded identity, without a cookie', async () => {
    const response = await signInAs({ key: 'root' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    ['a user id instead of a key', { userId: '01a1656b-1a49-7146-94ac-1c72df43ddb4' }],
    [
      'a key plus a smuggled user id',
      { key: 'admin', userId: '01a1656b-1a49-7146-94ac-1c72df43ddb4' },
    ],
    ['an email instead of a key', { email: 'owner@acme.test' }],
    ['an empty object', {}],
    ['a non-string key', { key: 123 }],
    ['no body at all', undefined],
  ])('refuses %s with 422 and sets no cookie', async (_label, payload) => {
    const response = await signInAs(payload);
    expect(response.statusCode).toBe(422);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('validation_failed');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('replaces the session being switched away from, so one switch leaves one live session', async () => {
    const ownerCookie = await ctx.cookieFor('owner');
    expect((await me(ownerCookie)).statusCode).toBe(200);

    const switched = await signInAs({ key: 'developer' }, { cookie: ownerCookie });
    expect(switched.statusCode).toBe(200);

    expect((await me(ownerCookie)).statusCode).toBe(401);
    const viewer = viewerSchema.parse((await me(cookieFrom(switched))).json());
    expect(viewer.user.displayName).toBe('Dana Developer');

    const [owner] = await ctx.db.select().from(users).where(eq(users.email, 'owner@acme.test'));
    const live = await ctx.db.select().from(sessions).where(eq(sessions.userId, owner!.id));
    expect(live.filter((session) => session.revokedAt === null)).toEqual([]);
  });

  it('records who switched to whom in the audit log', async () => {
    const ownerCookie = await ctx.cookieFor('owner');
    await signInAs({ key: 'developer' }, { cookie: ownerCookie });

    const [owner] = await ctx.db.select().from(users).where(eq(users.email, 'owner@acme.test'));
    const [developer] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.email, 'developer@acme.test'));
    const events = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'dev.session.created'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'dev',
      outcome: 'success',
      actorUserId: owner!.id,
      targetType: 'user',
      targetId: developer!.id,
    });
    expect(JSON.stringify(events[0])).not.toMatch(/forge_session|[A-Za-z0-9_-]{43}/);
  });
});

describe('POST /api/dev/reset', () => {
  it('wipes everything, reseeds, and ends the current session', async () => {
    const cookie = await ctx.cookieFor('owner');
    await ctx.db.insert(users).values({ email: 'stray@example.test', displayName: 'Stray' });

    const response = await reset({ cookie });
    expect(response.statusCode).toBe(204);
    expect(String(response.headers['set-cookie'])).toMatch(/forge_session=;/);

    expect(await ctx.db.select().from(users).where(eq(users.email, 'stray@example.test'))).toEqual(
      [],
    );
    expect((await me(cookie)).statusCode).toBe(401);
    expect(await ctx.db.select().from(sessions).where(isNull(sessions.revokedAt))).toEqual([]);
    expect((await listIdentities()).json()).toHaveLength(7);
  });
});

describe('who may use the switcher', () => {
  const attempts = (headers: Headers) => [
    () => listIdentities(headers),
    () => signInAs({ key: 'admin' }, headers),
    () => reset(headers),
  ];

  it.each([
    ['a foreign Host', { host: 'evil.test' }],
    ['a look-alike Host', { host: 'localhost.evil.test' }],
    [
      'a foreign X-Forwarded-Host (DNS rebinding through the web proxy)',
      { 'x-forwarded-host': 'evil.test' },
    ],
    ['a look-alike X-Forwarded-Host', { 'x-forwarded-host': '127.0.0.1.evil.test' }],
    ['a mixed X-Forwarded-Host list', { 'x-forwarded-host': 'localhost, evil.test' }],
  ])('refuses all three routes for %s', async (_label, headers) => {
    for (const attempt of attempts(headers)) {
      const response = await attempt();
      expect(response.statusCode).toBe(403);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('accepts a loopback X-Forwarded-Host, as sent by the web proxy', async () => {
    const response = await signInAs({ key: 'admin' }, { 'x-forwarded-host': 'localhost:3000' });
    expect(response.statusCode).toBe(200);
  });

  it('refuses a foreign Origin and sets no cookie', async () => {
    const response = await signInAs({ key: 'admin' }, { origin: 'http://evil.test' });
    expect(response.statusCode).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('accepts the web app origin', async () => {
    const response = await signInAs({ key: 'admin' }, { origin: 'http://localhost:3000' });
    expect(response.statusCode).toBe(200);
  });
});
