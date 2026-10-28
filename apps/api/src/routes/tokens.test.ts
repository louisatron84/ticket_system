import {
  apiTokens,
  auditEvents,
  cliLogins,
  organisationMemberships,
  roles,
  users,
} from '@forge/db';
import {
  apiErrorSchema,
  apiTokenSchema,
  cliLoginStartSchema,
  cliTokenPollSchema,
  cliWhoAmISchema,
  createdTokenSchema,
} from '@forge/shared';
import { and, eq, sql } from 'drizzle-orm';
import { createToken } from '../auth/tokens';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;
let f: Facts;

beforeAll(async () => {
  ctx = await startIntegration();
});

beforeEach(async () => {
  await ctx.reseed();
  f = await loadFacts(ctx.db);
});

afterAll(async () => {
  await ctx.close();
});

const makeToken = async (
  options: { as?: string; scope?: 'read' | 'write'; org?: string; days?: number } = {},
) => {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/me/tokens',
    headers: { cookie: await ctx.cookieFor(options.as ?? 'developer') },
    payload: {
      name: 'Laptop',
      organisationId: options.org ?? f.acmeId,
      scope: options.scope ?? 'write',
      expiresInDays: options.days ?? 30,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return createdTokenSchema.parse(response.json());
};

const withToken = (
  token: string,
  method: 'GET' | 'PATCH' | 'POST' | 'DELETE' | 'PUT',
  url: string,
  payload?: unknown,
) =>
  ctx.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload: payload as never } : {}),
  });

const messageOf = (response: { json(): unknown }) =>
  apiErrorSchema.parse(response.json()).error.message;

describe('making and listing tokens', () => {
  it('shows the token once and stores only its hash', async () => {
    const made = await makeToken();
    expect(made.token).toMatch(/^forge_pat_[A-Za-z0-9_-]{43}$/);
    expect(made.details).toMatchObject({ name: 'Laptop', scope: 'write', createdVia: 'page' });
    expect(made.details.hint).toBe(`${made.token.slice(0, 14)}…`);

    const [row] = await ctx.db.select().from(apiTokens).where(eq(apiTokens.id, made.details.id));
    expect(JSON.stringify(row)).not.toContain(made.token.slice(14));

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me/tokens',
      headers: { cookie: await ctx.cookieFor('developer') },
    });
    const tokens = apiTokenSchema.array().parse(list.json());
    expect(tokens.map((t) => t.id)).toEqual([made.details.id]);
    expect(list.body).not.toContain(made.token);
  });

  it('every token expires, within a year', async () => {
    for (const days of [0, 366]) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/me/tokens',
        headers: { cookie: await ctx.cookieFor('developer') },
        payload: { name: 'x', organisationId: f.acmeId, scope: 'read', expiresInDays: days },
      });
      expect(response.statusCode).toBe(422);
    }
    const year = await makeToken({ days: 365 });
    const left = Date.parse(year.details.expiresAt) - Date.now();
    expect(left).toBeGreaterThan(364 * 86_400_000);
  });

  it('only for a workspace you are in; nobody sees or revokes another person’s', async () => {
    const foreign = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/tokens',
      headers: { cookie: await ctx.cookieFor('reviewer') },
      payload: { name: 'x', organisationId: f.northwindId, scope: 'read', expiresInDays: 1 },
    });
    expect(foreign.statusCode).toBe(404);

    const mine = await makeToken();
    const theirs = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/me/tokens/${mine.details.id}`,
      headers: { cookie: await ctx.cookieFor('reviewer') },
    });
    expect(theirs.statusCode).toBe(404);
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me/tokens',
      headers: { cookie: await ctx.cookieFor('reviewer') },
    });
    expect(list.json()).toEqual([]);
  });

  it('a token cannot make, list or revoke tokens, nor reach account routes', async () => {
    const { token } = await makeToken();
    for (const [method, url] of [
      ['GET', '/api/v1/me/tokens'],
      ['POST', '/api/v1/me/tokens'],
      ['GET', '/api/v1/me'],
      ['GET', '/api/v1/me/preferences'],
      ['POST', '/api/v1/auth/logout'],
      ['POST', '/api/v1/cli/login/decision'],
    ] as const) {
      const response = await withToken(token, method, url, method === 'GET' ? undefined : {});
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});

describe('using a token', () => {
  it('works in its own workspace, as its owner, with the owner’s role', async () => {
    const { token } = await makeToken();
    const read = await withToken(token, 'GET', `/api/v1/orgs/${f.acmeId}/tickets/WEB-1`);
    expect(read.statusCode).toBe(200);
    const comment = await withToken(
      token,
      'POST',
      `/api/v1/orgs/${f.acmeId}/tickets/WEB-1/comments`,
      {
        body: 'From the terminal',
      },
    );
    expect(comment.statusCode).toBe(201);
    expect((comment.json() as { author: { id: string } }).author.id).toBe(f.userId('developer'));
    // A developer cannot manage projects, whatever the token's scope.
    const project = await withToken(token, 'POST', `/api/v1/orgs/${f.acmeId}/projects`, {
      key: 'CLI',
      name: 'From a token',
    });
    expect(project.statusCode).toBe(403);
  });

  it('only does ticket work, even for an owner: never manages the workspace', async () => {
    const { token } = await makeToken({ as: 'owner' });
    const org = `/api/v1/orgs/${f.acmeId}`;
    const rename = await withToken(token, 'PATCH', org, { name: 'Taken over' });
    expect(rename.statusCode).toBe(403);
    expect(messageOf(rename)).toBe('Command-line tokens cannot do that. Use the web app.');
    const role = await withToken(token, 'PATCH', `${org}/members/${f.userId('developer')}`, {
      roleId: f.userId('developer'),
    });
    expect(role.statusCode).toBe(403);
    const project = await withToken(token, 'POST', `${org}/projects`, {
      key: 'CLI',
      name: 'From a token',
    });
    expect(project.statusCode).toBe(403);
    expect((await withToken(token, 'GET', `${org}/members`)).statusCode).toBe(403);
    // Ticket work is fine.
    expect((await withToken(token, 'GET', `${org}/tickets/WEB-1`)).statusCode).toBe(200);
  });

  it('leaving a workspace takes the tokens for it along', async () => {
    // A fresh member with nothing else to their name, so the membership can be removed.
    const [user] = await ctx.db
      .insert(users)
      .values({ email: 'leaver@acme.test', displayName: 'Lee Leaver' })
      .returning({ id: users.id });
    const [role] = await ctx.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organisationId, f.acmeId), eq(roles.key, 'readonly')));
    await ctx.db
      .insert(organisationMemberships)
      .values({ organisationId: f.acmeId, userId: user!.id, roleId: role!.id });
    const made = await ctx.db.transaction((tx) =>
      createToken(tx, {
        userId: user!.id,
        organisationId: f.acmeId,
        name: 'Leaving',
        scope: 'read',
        expiresInDays: 1,
        createdVia: 'page',
        requestId: 'test',
      }),
    );
    await ctx.db
      .delete(organisationMemberships)
      .where(
        and(
          eq(organisationMemberships.organisationId, f.acmeId),
          eq(organisationMemberships.userId, user!.id),
        ),
      );
    expect(await ctx.db.select().from(apiTokens).where(eq(apiTokens.id, made.id))).toEqual([]);
    expect((await withToken(made.token, 'GET', '/api/v1/cli/whoami')).statusCode).toBe(401);
  });

  it('another workspace looks absent, even one its owner belongs to', async () => {
    // Dana is a member of Northwind too, but this token is for Acme.
    const { token } = await makeToken({ as: 'developer' });
    const response = await withToken(token, 'GET', `/api/v1/orgs/${f.northwindId}/projects`);
    expect(response.statusCode).toBe(404);
  });

  it('a read token reads but never changes', async () => {
    const { token } = await makeToken({ scope: 'read' });
    expect(
      (await withToken(token, 'GET', `/api/v1/orgs/${f.acmeId}/tickets/WEB-1`)).statusCode,
    ).toBe(200);
    const write = await withToken(
      token,
      'POST',
      `/api/v1/orgs/${f.acmeId}/tickets/WEB-1/comments`,
      {
        body: 'No',
      },
    );
    expect(write.statusCode).toBe(403);
    expect(messageOf(write)).toBe('This token is read-only.');
  });

  it('revoked, expired, tampered and unknown tokens are refused', async () => {
    const revoked = await makeToken();
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/me/tokens/${revoked.details.id}`,
      headers: { cookie: await ctx.cookieFor('developer') },
    });
    const expired = await makeToken();
    await ctx.db
      .update(apiTokens)
      .set({
        expiresAt: sql`now() - interval '1 second'`,
        createdAt: sql`now() - interval '1 day'`,
      })
      .where(eq(apiTokens.id, expired.details.id));
    const good = await makeToken();
    const tampered = `${good.token.slice(0, -1)}${good.token.endsWith('A') ? 'B' : 'A'}`;
    for (const token of [revoked.token, expired.token, tampered, 'forge_pat_short', 'nonsense']) {
      const response = await withToken(token, 'GET', `/api/v1/orgs/${f.acmeId}/tickets/WEB-1`);
      expect(response.statusCode, token.slice(0, 16)).toBe(401);
    }
  });

  it('a token stops working when its owner leaves the workspace or loses the permission', async () => {
    const { token } = await makeToken({ as: 'developer' });
    await ctx.db.execute(
      sql`update organisation_memberships set role_id = (select id from roles where organisation_id = ${f.acmeId} and key = 'readonly') where organisation_id = ${f.acmeId} and user_id = ${f.userId('developer')}`,
    );
    const write = await withToken(
      token,
      'POST',
      `/api/v1/orgs/${f.acmeId}/tickets/WEB-1/comments`,
      {
        body: 'Now read-only',
      },
    );
    expect(write.statusCode).toBe(403);
  });

  it('a cookie and a token together are refused', async () => {
    const { token } = await makeToken();
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-1`,
      headers: { authorization: `Bearer ${token}`, cookie: await ctx.cookieFor('owner') },
    });
    expect(response.statusCode).toBe(401);
  });

  it('records first use in the audit log, with creation and revocation', async () => {
    const made = await makeToken();
    await withToken(made.token, 'GET', `/api/v1/orgs/${f.acmeId}/tickets/WEB-1`);
    await withToken(made.token, 'GET', `/api/v1/orgs/${f.acmeId}/tickets/WEB-2`);
    await withToken(made.token, 'POST', '/api/v1/cli/logout');
    const rows = await ctx.db
      .select({ action: auditEvents.action, after: auditEvents.after })
      .from(auditEvents)
      .where(eq(auditEvents.targetId, made.details.id))
      .orderBy(auditEvents.createdAt);
    expect(rows.map((r) => r.action)).toEqual([
      'token.created',
      'token.first_used',
      'token.revoked',
    ]);
    expect(JSON.stringify(rows)).not.toContain(made.token);
    const after = await withToken(made.token, 'GET', '/api/v1/cli/whoami');
    expect(after.statusCode).toBe(401);
  });

  it('whoami names the owner, workspace and scope', async () => {
    const { token } = await makeToken({ scope: 'read' });
    const me = cliWhoAmISchema.parse((await withToken(token, 'GET', '/api/v1/cli/whoami')).json());
    expect(me).toMatchObject({
      user: { displayName: 'Dana Developer' },
      workspace: { slug: 'acme' },
      scope: 'read',
    });
  });
});

describe('signing the command line in from the browser', () => {
  const start = async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/cli/login',
      payload: { machine: 'dana-laptop' },
    });
    expect(response.statusCode, response.body).toBe(201);
    return cliLoginStartSchema.parse(response.json());
  };
  const poll = async (deviceCode: string) =>
    cliTokenPollSchema.parse(
      (
        await ctx.app.inject({ method: 'POST', url: '/api/v1/cli/token', payload: { deviceCode } })
      ).json(),
    );
  const decide = async (body: Record<string, unknown>, as = 'developer') =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/v1/cli/login/decision',
      headers: { cookie: await ctx.cookieFor(as) },
      payload: body,
    });
  const lookup = async (userCode: string, as = 'developer') =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/v1/cli/login/lookup',
      headers: { cookie: await ctx.cookieFor(as) },
      payload: { userCode },
    });
  const backdatePoll = (deviceCode: string) =>
    ctx.db
      .update(cliLogins)
      .set({ lastPolledAt: sql`now() - interval '10 seconds'` })
      .where(sql`${cliLogins.deviceCodeHash} = encode(sha256(${deviceCode}::bytea), 'hex')`);

  it('waits, is approved, hands over its token once, and the token works', async () => {
    const login = await start();
    expect(login.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(login.verificationUrl).toBe(`http://localhost:3000/cli/approve?code=${login.userCode}`);
    expect(await poll(login.deviceCode)).toEqual({ status: 'pending' });
    // Asking again at once is too soon.
    expect(await poll(login.deviceCode)).toEqual({ status: 'slow_down' });

    const seen = await lookup(login.userCode.toLowerCase().replace('-', ' '));
    expect(seen.statusCode).toBe(200);
    expect(seen.json()).toMatchObject({ machine: 'dana-laptop', userCode: login.userCode });

    expect(
      (
        await decide({
          decision: 'allow',
          userCode: login.userCode,
          organisationId: f.acmeId,
          scope: 'write',
        })
      ).statusCode,
    ).toBe(204);
    await backdatePoll(login.deviceCode);
    const approved = await poll(login.deviceCode);
    expect(approved.status).toBe('approved');
    const token = approved.status === 'approved' ? approved.token : '';
    expect(await poll(login.deviceCode)).toEqual({ status: 'expired' });

    const me = cliWhoAmISchema.parse((await withToken(token, 'GET', '/api/v1/cli/whoami')).json());
    expect(me.user.displayName).toBe('Dana Developer');
    const [row] = await ctx.db.select().from(apiTokens).where(eq(apiTokens.createdVia, 'login'));
    expect(row!.name).toBe('forge login on dana-laptop');
    // The approved row keeps no secret.
    const [stored] = await ctx.db.select().from(cliLogins);
    expect(JSON.stringify(stored)).not.toContain(token.slice(10));
  });

  it('a denied login gets no token, and a code is decided once', async () => {
    const login = await start();
    expect((await decide({ decision: 'deny', userCode: login.userCode })).statusCode).toBe(204);
    expect(await poll(login.deviceCode)).toEqual({ status: 'denied' });
    const again = await decide({
      decision: 'allow',
      userCode: login.userCode,
      organisationId: f.acmeId,
      scope: 'write',
    });
    expect(again.statusCode).toBe(404);
  });

  it('an expired code can be neither approved nor collected', async () => {
    const login = await start();
    await ctx.db.update(cliLogins).set({ expiresAt: sql`now() - interval '1 second'` });
    expect((await lookup(login.userCode)).statusCode).toBe(404);
    expect(await poll(login.deviceCode)).toEqual({ status: 'expired' });
  });

  it('approving for a workspace you are not in is refused', async () => {
    const login = await start();
    const response = await decide(
      {
        decision: 'allow',
        userCode: login.userCode,
        organisationId: f.northwindId,
        scope: 'read',
      },
      'reviewer',
    );
    expect(response.statusCode).toBe(404);
  });

  it('guessing codes is limited', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await lookup('AAAA-AAAA', 'admin')).statusCode);
    expect(statuses.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('approving needs a browser session, not a token', async () => {
    const login = await start();
    const { token } = await makeToken();
    const response = await withToken(token, 'POST', '/api/v1/cli/login/decision', {
      decision: 'allow',
      userCode: login.userCode,
      organisationId: f.acmeId,
      scope: 'write',
    });
    expect(response.statusCode).toBe(403);
  });
});
