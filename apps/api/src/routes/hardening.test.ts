import { organisationMemberships, roles, ticketComments } from '@forge/db';
import { apiErrorSchema } from '@forge/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';

// Holes found by the second outside review (F-002 to F-005, F-013), each kept shut by a test.

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

const as = async (
  who: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) =>
  ctx.app.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
    headers: { cookie: await ctx.cookieFor(who) },
  });

const org = () => `/api/v1/orgs/${f.acmeId}`;
const message = (response: { json(): unknown }) =>
  apiErrorSchema.parse(response.json()).error.message;

const newTicket = (statusKey?: string) => ({
  title: 'Made straight into a status',
  typeId: f.typeId('acme', 'task'),
  priorityId: f.priorityId('acme', 'normal'),
  ...(statusKey ? { statusId: f.statusId('API', statusKey) } : {}),
});

describe('creating in a status', () => {
  it('lets someone who can only create start nowhere but the first status', async () => {
    const done = await as('reporter', 'POST', `${org()}/projects/API/tickets`, newTicket('done'));
    expect(done.statusCode).toBe(403);
    expect(message(done)).toBe("You can only create tickets in the project's first status.");
    const first = await as(
      'reporter',
      'POST',
      `${org()}/projects/API/tickets`,
      newTicket('backlog'),
    );
    expect(first.statusCode, first.body).toBe(201);
    const unset = await as('reporter', 'POST', `${org()}/projects/API/tickets`, newTicket());
    expect(unset.statusCode, unset.body).toBe(201);
  });

  it('still lets an editor create in any status', async () => {
    const done = await as('developer', 'POST', `${org()}/projects/API/tickets`, newTicket('done'));
    expect(done.statusCode, done.body).toBe(201);
    expect((done.json() as { status: { key: string } }).status.key).toBe('done');
  });
});

describe('an archived project', () => {
  it('freezes its tickets: no edits, comments, criteria, files or archiving', async () => {
    const ticket = f.ticket('API-1');
    expect(
      (await as('owner', 'PATCH', `${org()}/projects/API`, { archived: true })).statusCode,
    ).toBe(200);
    const frozen = 'This project is archived. Unarchive it to change its tickets.';
    const tries = [
      await as('developer', 'PATCH', `${org()}/tickets/API-1`, {
        version: ticket.version,
        title: 'Edited in an archived project',
      }),
      await as('developer', 'POST', `${org()}/tickets/API-1/comments`, { body: 'Still here?' }),
      await as('developer', 'POST', `${org()}/tickets/API-1/criteria`, { text: 'A new one' }),
      await as('developer', 'POST', `${org()}/tickets/API-1/archive`),
    ];
    for (const response of tries) {
      expect(response.statusCode, response.body).toBe(409);
      expect(message(response)).toBe(frozen);
    }
    // Reading is untouched.
    expect((await as('readonly', 'GET', `${org()}/tickets/API-1`)).statusCode).toBe(200);
  });
});

describe('deleting comments', () => {
  it('is refused to an author whose role can no longer comment', async () => {
    const made = await as('developer', 'POST', `${org()}/tickets/WEB-1/comments`, {
      body: 'Mine, for now',
    });
    expect(made.statusCode, made.body).toBe(201);
    const commentId = (made.json() as { id: string }).id;
    const [readonly] = await ctx.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organisationId, f.acmeId), eq(roles.key, 'readonly')));
    await ctx.db
      .update(organisationMemberships)
      .set({ roleId: readonly!.id })
      .where(
        and(
          eq(organisationMemberships.organisationId, f.acmeId),
          eq(organisationMemberships.userId, f.userId('developer')),
        ),
      );
    const response = await as(
      'developer',
      'DELETE',
      `${org()}/tickets/WEB-1/comments/${commentId}`,
    );
    expect(response.statusCode).toBe(403);
    expect(
      await ctx.db.select().from(ticketComments).where(eq(ticketComments.id, commentId)),
    ).toHaveLength(1);
  });
});

describe('command-line tokens', () => {
  const makeToken = async (who: string, scope: 'read' | 'write') => {
    const response = await as(who, 'POST', '/api/v1/me/tokens', {
      name: 'laptop',
      organisationId: f.acmeId,
      scope,
      expiresInDays: 7,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { token: string; scope?: string; apiToken?: { scope: string } };
  };

  it('cannot save views, which are web settings', async () => {
    const { token } = await makeToken('developer', 'write');
    const response = await ctx.app.inject({
      method: 'POST',
      url: `${org()}/views`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'v', scope: 'personal', definition: { filters: {}, display: 'list' } },
    });
    expect(response.statusCode).toBe(403);
    expect(message(response)).toBe('Command-line tokens cannot do that. Use the web app.');
  });

  it('can only read when its owner can only read, whatever was asked for', async () => {
    const { token } = await makeToken('readonly', 'write');
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/cli/whoami',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode, me.body).toBe(200);
    expect((me.json() as { scope: string }).scope).toBe('read');
    // A role that can change tickets keeps the scope it asked for.
    const developer = await makeToken('developer', 'write');
    const theirs = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/cli/whoami',
      headers: { authorization: `Bearer ${developer.token}` },
    });
    expect((theirs.json() as { scope: string; webUrl: string }).scope).toBe('write');
    expect((theirs.json() as { webUrl: string }).webUrl).toBe(ctx.config.webOrigins[0]);
  });
});

describe('approving a command-line sign-in', () => {
  const start = async (remoteAddress: string) => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/cli/login',
      payload: { machine: 'laptop' },
      remoteAddress,
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { userCode: string }).userCode;
  };
  const decide = async (userCode: string, extra: object = {}) =>
    as('developer', 'POST', '/api/v1/cli/login/decision', {
      decision: 'allow',
      userCode,
      organisationId: f.acmeId,
      scope: 'read',
      ...extra,
    });

  it('needs a second yes when the terminal asked from another address', async () => {
    const userCode = await start('203.0.113.9');
    const lookup = await as('developer', 'POST', '/api/v1/cli/login/lookup', { userCode });
    expect((lookup.json() as { fromYourAddress: boolean }).fromYourAddress).toBe(false);
    const plain = await decide(userCode);
    expect(plain.statusCode).toBe(409);
    expect(message(plain)).toMatch(/started from another address/);
    expect((await decide(userCode, { differentAddressConfirmed: true })).statusCode).toBe(204);
  });

  it('needs no second yes from this same machine', async () => {
    const userCode = await start('127.0.0.1');
    expect((await decide(userCode)).statusCode).toBe(204);
  });
});
