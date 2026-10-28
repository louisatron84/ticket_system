import {
  apiErrorSchema,
  projectDetailSchema,
  projectSchema,
  ticketConfigSchema,
} from '@forge/shared';
import { auditEvents, organisations, users } from '@forge/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;
let acmeId: string;
let northwindId: string;

beforeAll(async () => {
  ctx = await startIntegration();
});

beforeEach(async () => {
  await ctx.reseed();
  const orgs = await ctx.db.select().from(organisations);
  acmeId = orgs.find((o) => o.slug === 'acme')!.id;
  northwindId = orgs.find((o) => o.slug === 'northwind')!.id;
});

afterAll(async () => {
  await ctx.close();
});

type Call = { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: object; cookie?: string };
const call = ({ cookie, ...rest }: Call) =>
  ctx.app.inject({ ...rest, headers: cookie ? { cookie } : {} });

const list = (orgId: string, cookie?: string) =>
  call({ method: 'GET', url: `/api/v1/orgs/${orgId}/projects`, ...(cookie ? { cookie } : {}) });
const create = (orgId: string, payload: unknown, cookie?: string) =>
  call({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/projects`,
    payload: payload as object,
    ...(cookie ? { cookie } : {}),
  });

describe('permission matrix on projects', () => {
  const matrix: [string, number, number][] = [
    // identity, list status, create status
    ['owner', 200, 201],
    ['admin', 200, 201],
    ['developer', 200, 403],
    ['reviewer', 200, 403],
    ['readonly', 200, 403],
    ['restricted', 403, 403],
    ['other-owner', 404, 404],
  ];

  it.each(matrix)('%s: list %i, create %i', async (identity, listStatus, createStatus) => {
    const cookie = await ctx.cookieFor(identity);
    expect((await list(acmeId, cookie)).statusCode).toBe(listStatus);
    const created = await create(acmeId, { key: 'NEWP', name: 'New project' }, cookie);
    expect(created.statusCode).toBe(createStatus);
  });

  it('answers 401 to someone who is not signed in', async () => {
    expect((await list(acmeId)).statusCode).toBe(401);
    expect((await create(acmeId, { key: 'NEWP', name: 'New' })).statusCode).toBe(401);
  });

  it('shows a foreign workspace exactly like one that does not exist', async () => {
    const cookie = await ctx.cookieFor('other-owner');
    const bodies = [];
    for (const orgId of [acmeId, '01a1656b-1a49-7146-94ac-1c72df43ddb4', 'not-a-uuid']) {
      const response = await list(orgId, cookie);
      expect(response.statusCode).toBe(404);
      const { requestId: _requestId, ...rest } = apiErrorSchema.parse(response.json()).error;
      bodies.push(rest);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });
});

describe('listing projects', () => {
  it('lists the workspace’s projects with ticket counts', async () => {
    const response = await list(acmeId, await ctx.cookieFor('owner'));
    const projects = projectSchema.array().parse(response.json());
    expect(projects.map((p) => p.key)).toEqual(['API', 'WEB']);
    expect(projects.find((p) => p.key === 'WEB')).toMatchObject({
      name: 'Web App',
      ticketCount: 12,
      openCount: 9,
      archived: false,
    });
    expect(projects.find((p) => p.key === 'API')).toMatchObject({ ticketCount: 8, openCount: 7 });
  });

  it('never shows another workspace’s projects', async () => {
    const nora = await list(northwindId, await ctx.cookieFor('other-owner'));
    expect(
      projectSchema
        .array()
        .parse(nora.json())
        .map((p) => p.key),
    ).toEqual(['OPS']);
    const olivia = await list(acmeId, await ctx.cookieFor('owner'));
    expect(
      projectSchema
        .array()
        .parse(olivia.json())
        .map((p) => p.key),
    ).not.toContain('OPS');
  });
});

describe('creating a project', () => {
  it('creates it with the default workflow and records an audit event', async () => {
    const owner = await ctx.cookieFor('owner');
    const response = await create(
      acmeId,
      { key: 'OPS2', name: 'Ops two', description: 'More ops' },
      owner,
    );
    expect(response.statusCode).toBe(201);
    expect(projectSchema.parse(response.json())).toMatchObject({
      key: 'OPS2',
      name: 'Ops two',
      ticketCount: 0,
      openCount: 0,
    });

    const detail = projectDetailSchema.parse(
      (
        await call({ method: 'GET', url: `/api/v1/orgs/${acmeId}/projects/OPS2`, cookie: owner })
      ).json(),
    );
    expect(detail.statuses.map((s) => s.key)).toEqual([
      'backlog',
      'open',
      'in_progress',
      'in_review',
      'blocked',
      'done',
      'cancelled',
    ]);
    expect(detail.statuses.filter((s) => s.initial).map((s) => s.key)).toEqual(['backlog']);
    expect(detail.transitions).toHaveLength(21);

    const [olivia] = await ctx.db.select().from(users).where(eq(users.email, 'owner@acme.test'));
    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'project.created'));
    expect(event).toMatchObject({
      organisationId: acmeId,
      actorUserId: olivia!.id,
      outcome: 'success',
      source: 'user',
      after: { key: 'OPS2', name: 'Ops two' },
    });
  });

  it('refuses a key already used in the workspace, naming it, but allows it in another', async () => {
    const dup = await create(
      acmeId,
      { key: 'WEB', name: 'Another web' },
      await ctx.cookieFor('owner'),
    );
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.message).toContain('WEB');

    const other = await create(
      northwindId,
      { key: 'WEB', name: 'Their web' },
      await ctx.cookieFor('other-owner'),
    );
    expect(other.statusCode).toBe(201);
  });

  it.each([
    ['a lower-case key', { key: 'web2', name: 'X' }],
    ['a one-letter key', { key: 'W', name: 'X' }],
    ['a key with a dash', { key: 'WE-B', name: 'X' }],
    ['a blank name', { key: 'WEB2', name: '   ' }],
    ['a name with a control character', { key: 'WEB2', name: 'a\u0000b' }],
    ['a counter smuggled in', { key: 'WEB2', name: 'X', nextTicketNumber: 500 }],
    [
      'an organisation smuggled in',
      { key: 'WEB2', name: 'X', organisationId: '01a1656b-1a49-7146-94ac-1c72df43ddb4' },
    ],
  ])('refuses %s with 422 and creates nothing', async (_label, payload) => {
    const response = await create(acmeId, payload, await ctx.cookieFor('owner'));
    expect(response.statusCode).toBe(422);
    const projects = projectSchema
      .array()
      .parse((await list(acmeId, await ctx.cookieFor('owner'))).json());
    expect(projects).toHaveLength(2);
  });
});

describe('reading one project', () => {
  const get = (orgId: string, key: string, cookie: string) =>
    call({ method: 'GET', url: `/api/v1/orgs/${orgId}/projects/${key}`, cookie });

  it('returns statuses, transitions and components, and finds the key in any case', async () => {
    const owner = await ctx.cookieFor('owner');
    for (const key of ['WEB', 'web', 'Web']) {
      const response = await get(acmeId, key, owner);
      expect(response.statusCode, key).toBe(200);
      const detail = projectDetailSchema.parse(response.json());
      expect(detail.key).toBe('WEB');
      expect(detail.statuses).toHaveLength(7);
      expect(detail.transitions).toHaveLength(21);
      expect(detail.components.map((c) => c.name).sort()).toEqual(['Checkout', 'Frontend']);
    }
  });

  it.each(['WEB-1', '%2E%2E', 'NOPE', 'A', 'ABCDEFGHIJK', 'WEB%00', 'we b'])(
    'answers 404 for the project key %j',
    async (key) => {
      const response = await get(acmeId, key, await ctx.cookieFor('owner'));
      expect(response.statusCode).toBe(404);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('not_found');
    },
  );

  it('does not reveal a project through another workspace’s url', async () => {
    const nora = await ctx.cookieFor('other-owner');
    expect((await get(northwindId, 'WEB', nora)).statusCode).toBe(404);
    expect((await get(acmeId, 'WEB', nora)).statusCode).toBe(404);
    expect((await get(northwindId, 'OPS', nora)).statusCode).toBe(200);
  });
});

describe('changing a project', () => {
  const patch = (key: string, payload: unknown, cookie: string) =>
    call({
      method: 'PATCH',
      url: `/api/v1/orgs/${acmeId}/projects/${key}`,
      payload: payload as object,
      cookie,
    });

  it('lets an owner rename a project and archive it, which moves it to the end of the list', async () => {
    const owner = await ctx.cookieFor('owner');
    const renamed = await patch('API', { name: 'Platform API v2', description: 'New text' }, owner);
    expect(renamed.statusCode).toBe(200);
    expect(projectSchema.parse(renamed.json())).toMatchObject({ name: 'Platform API v2' });

    expect((await patch('API', { archived: true }, owner)).statusCode).toBe(200);
    const projects = projectSchema.array().parse((await list(acmeId, owner)).json());
    expect(projects.map((p) => [p.key, p.archived])).toEqual([
      ['WEB', false],
      ['API', true],
    ]);

    expect((await patch('API', { archived: false }, owner)).statusCode).toBe(200);
  });

  it('never lets the key, the counter or anything else structural be edited', async () => {
    const owner = await ctx.cookieFor('owner');
    for (const payload of [
      { key: 'NEW' },
      { nextTicketNumber: 1 },
      { organisationId: acmeId },
      {},
    ]) {
      expect((await patch('WEB', payload, owner)).statusCode, JSON.stringify(payload)).toBe(422);
    }
  });

  it('is refused for people who may only look', async () => {
    for (const identity of ['developer', 'reviewer', 'readonly']) {
      expect((await patch('WEB', { name: 'Mine' }, await ctx.cookieFor(identity))).statusCode).toBe(
        403,
      );
    }
    expect(
      (await patch('WEB', { name: 'Mine' }, await ctx.cookieFor('other-owner'))).statusCode,
    ).toBe(404);
  });

  it('answers 404 for a project that does not exist', async () => {
    expect((await patch('NOPE', { name: 'X' }, await ctx.cookieFor('owner'))).statusCode).toBe(404);
  });
});

describe('ticket configuration', () => {
  const config = (orgId: string, cookie: string) =>
    call({ method: 'GET', url: `/api/v1/orgs/${orgId}/ticket-config`, cookie });

  it('returns ordered types and priorities, and only this workspace’s labels and components', async () => {
    const response = await config(acmeId, await ctx.cookieFor('developer'));
    expect(response.statusCode).toBe(200);
    const parsed = ticketConfigSchema.parse(response.json());
    expect(parsed.types.map((t) => t.key)).toEqual([
      'task',
      'bug',
      'feature',
      'improvement',
      'epic',
      'documentation',
      'support',
    ]);
    expect(parsed.priorities.map((p) => [p.key, p.rank])).toEqual([
      ['lowest', 1],
      ['low', 2],
      ['normal', 3],
      ['high', 4],
      ['critical', 5],
    ]);
    expect(parsed.labels.map((l) => l.name)).toEqual([
      'backend',
      'bug',
      'docs',
      'frontend',
      'performance',
      'security',
    ]);
    expect(parsed.components).toHaveLength(4);
  });

  it('gives Northwind its own labels, not Acme’s', async () => {
    const parsed = ticketConfigSchema.parse(
      (await config(northwindId, await ctx.cookieFor('other-owner'))).json(),
    );
    expect(parsed.labels.map((l) => l.name)).toEqual(['bug', 'ops']);
    expect(parsed.components).toHaveLength(0);
  });

  it('is closed to restricted members and to outsiders', async () => {
    expect((await config(acmeId, await ctx.cookieFor('restricted'))).statusCode).toBe(403);
    expect((await config(acmeId, await ctx.cookieFor('other-owner'))).statusCode).toBe(404);
  });
});
