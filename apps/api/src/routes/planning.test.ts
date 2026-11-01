import { auditEvents, projects, tickets } from '@forge/db';
import { backlogSchema, type Backlog } from '@forge/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, ticketRow, type Facts } from '../test-support/facts';
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

const send = async (
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  as: string | null = 'owner',
  payload?: unknown,
) =>
  ctx.app.inject({
    method,
    url: path,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    headers: as ? { cookie: await ctx.cookieFor(as) } : {},
  });

const backlogUrl = (projectKey = 'WEB', orgId = f.acmeId) =>
  `/api/v1/orgs/${orgId}/projects/${projectKey}/backlog`;
const rankUrl = (key: string) => `/api/v1/orgs/${f.acmeId}/tickets/${key}/rank`;

const backlog = async (projectKey = 'WEB', as = 'owner'): Promise<Backlog> => {
  const response = await send('GET', backlogUrl(projectKey), as);
  expect(response.statusCode).toBe(200);
  return backlogSchema.parse(response.json());
};
const order = async (projectKey = 'WEB') => (await backlog(projectKey)).items.map((t) => t.key);

const rank = (key: string, payload: object, as = 'owner') =>
  send('POST', rankUrl(key), as, payload);

describe('the backlog', () => {
  it('lists open tickets in rank order, with estimates and the project’s system', async () => {
    const result = await backlog();
    expect(result.estimation).toBe('time');
    expect(result.items.length).toBeGreaterThan(2);
    expect(result.total).toBe(result.items.length);
    const ranks = result.items.map((item) => item.rank);
    expect([...ranks].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(ranks);
    expect(result.items.every((item) => item.status.category !== 'completed')).toBe(true);
  });

  it('puts a new ticket at the bottom', async () => {
    const response = await send('POST', `/api/v1/orgs/${f.acmeId}/projects/WEB/tickets`, 'owner', {
      title: 'Newest work',
      typeId: f.typeId('acme', 'task'),
      priorityId: f.priorityId('acme', 'high'),
    });
    expect(response.statusCode).toBe(201);
    const keys = await order();
    expect(keys.at(-1)).toBe(response.json().key);
  });

  it.each([
    ['owner', 200],
    ['readonly', 200],
    ['restricted', 403],
    ['other-owner', 404],
  ] as const)('%s may read it: %i', async (identity, expected) => {
    expect((await send('GET', backlogUrl(), identity)).statusCode).toBe(expected);
  });
});

describe('moving a ticket in the backlog', () => {
  it('moves to the top, to the bottom, and between two tickets', async () => {
    const start = await order();
    const [first, second, third] = start as [string, string, string];
    const last = start.at(-1)!;

    expect((await rank(last, { to: 'top' })).statusCode).toBe(200);
    expect((await order())[0]).toBe(last);

    expect((await rank(last, { to: 'bottom' })).statusCode).toBe(200);
    expect((await order()).at(-1)).toBe(last);

    expect((await rank(last, { after: first, before: second })).statusCode).toBe(200);
    expect((await order()).slice(0, 3)).toEqual([first, last, second]);

    expect((await rank(first, { before: third })).statusCode).toBe(200);
    expect((await order()).slice(0, 4)).toEqual([last, second, first, third]);
  });

  it('changes one row and leaves the version, updated time and history alone', async () => {
    const [first, second] = (await order()) as [string, string];
    const before = (await ticketRow(ctx.db, second))!;
    expect((await rank(second, { to: 'top' })).statusCode).toBe(200);
    const after = (await ticketRow(ctx.db, second))!;
    expect(after.version).toBe(before.version);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.rank).not.toBe(before.rank);
    expect((await order()).slice(0, 2)).toEqual([second, first]);

    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'ticket.ranked'));
    expect(audits).toHaveLength(1);
  });

  it('keeps working when ranks have run into each other', async () => {
    const keys = await order();
    // Every ticket with the same rank: the next move spreads them out first.
    await ctx.db
      .update(tickets)
      .set({ rank: 'a0' })
      .where(eq(tickets.projectId, f.projectId('WEB')));
    expect((await rank(keys[2]!, { after: keys[0]! })).statusCode).toBe(200);
    const ranks = (await backlog()).items.map((item) => item.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('goes below `after` when the two named tickets are no longer in that order', async () => {
    const [first, second, third] = (await order()) as [string, string, string];
    expect((await rank(third, { after: second, before: first })).statusCode).toBe(200);
    expect((await order()).slice(0, 3)).toEqual([first, second, third]);
  });

  it('refuses neighbours from another project, itself, and unclear places', async () => {
    const [first, second] = (await order()) as [string, string];
    const [other] = await order('API');
    expect((await rank(first, { after: other! })).statusCode).toBe(422);
    expect((await rank(first, { after: first })).statusCode).toBe(422);
    expect((await rank(first, { after: 'NOPE-1' })).statusCode).toBe(422);
    expect((await rank(first, {})).statusCode).toBe(422);
    expect((await rank(first, { to: 'top', after: second })).statusCode).toBe(422);
    expect((await rank(first, { after: second, before: second })).statusCode).toBe(422);
  });

  it.each([
    ['developer', 200],
    ['reporter', 403],
    ['readonly', 403],
    ['other-owner', 404],
  ] as const)('%s may move tickets: %i', async (identity, expected) => {
    const [first] = (await order()) as [string];
    expect((await rank(first, { to: 'bottom' }, identity)).statusCode).toBe(expected);
  });

  it('is frozen in an archived project', async () => {
    const [first] = (await order()) as [string];
    await ctx.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.key, 'WEB'));
    expect((await rank(first, { to: 'bottom' })).statusCode).toBe(409);
  });

  it('serialises moves into the same gap', async () => {
    const [first, second, third, fourth] = (await order()) as [string, string, string, string];
    const results = await Promise.all([
      rank(third, { after: first, before: second }),
      rank(fourth, { after: first, before: second }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const ranks = (await backlog()).items.map((item) => item.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect((await order())[0]).toBe(first);
  });
});

describe('sorting lists by rank', () => {
  it('orders the ticket list by backlog rank', async () => {
    const keys = await order();
    await rank(keys.at(-1)!, { to: 'top' });
    const response = await send(
      'GET',
      `/api/v1/orgs/${f.acmeId}/tickets?project=WEB&sort=rank&dir=asc&statusCategory=not_started&statusCategory=in_progress`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].key).toBe(keys.at(-1));
  });
});

describe('the project’s estimation system', () => {
  it('switches to points, and the move rule checks points', async () => {
    const response = await send('PATCH', `/api/v1/orgs/${f.acmeId}/projects/WEB`, 'owner', {
      estimation: 'points',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().estimation).toBe('points');
    expect((await backlog()).estimation).toBe('points');
  });

  it('refuses a points value off the scale', async () => {
    const [first] = (await order()) as [string];
    const { version } = (await ticketRow(ctx.db, first))!;
    const response = await send('PATCH', `/api/v1/orgs/${f.acmeId}/tickets/${first}`, 'owner', {
      version,
      estimatePoints: 4,
    });
    expect(response.statusCode).toBe(422);
  });

  it('stores points and records them in history', async () => {
    const [first] = (await order()) as [string];
    const { version } = (await ticketRow(ctx.db, first))!;
    const response = await send('PATCH', `/api/v1/orgs/${f.acmeId}/tickets/${first}`, 'owner', {
      version,
      estimatePoints: 5,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().estimatePoints).toBe(5);
    const history = await send('GET', `/api/v1/orgs/${f.acmeId}/tickets/${first}/timeline`);
    expect(JSON.stringify(history.json())).toContain('5 pts');
  });

  it.each([
    ['admin', 200],
    ['developer', 403],
  ] as const)('%s may change it: %i', async (identity, expected) => {
    const response = await send('PATCH', `/api/v1/orgs/${f.acmeId}/projects/WEB`, identity, {
      estimation: 'points',
    });
    expect(response.statusCode).toBe(expected);
  });
});
