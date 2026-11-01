import { roles, tickets } from '@forge/db';
import { queryContextSchema, ticketListSchema } from '@forge/shared';
import { and, eq } from 'drizzle-orm';
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

const get = async (path: string, as = 'owner') =>
  ctx.app.inject({ method: 'GET', url: path, headers: { cookie: await ctx.cookieFor(as) } });

const org = () => `/api/v1/orgs/${f.acmeId}`;
const list = async (query: string, as = 'owner') => {
  const response = await get(`${org()}/tickets?query=${encodeURIComponent(query)}`, as);
  expect(response.statusCode).toBe(200);
  return ticketListSchema.parse(response.json());
};

describe('the query context', () => {
  it('names the workspace’s statuses, types, projects and people', async () => {
    const response = await get(`${org()}/ticket-query/context`);
    expect(response.statusCode).toBe(200);
    const context = queryContextSchema.parse(response.json());
    expect(context.projects).toContain('WEB');
    expect(context.statuses).toContainEqual({ key: 'in_progress', name: 'In the Forge' });
    expect(context.types.map((type) => type.key)).toContain('epic');
    expect(context.people.map((person) => person.email)).toContain('developer@acme.test');
    // Statuses shared by projects appear once.
    const keys = context.statuses.map((status) => `${status.key}/${status.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('leaves people out for someone who may not see the members', async () => {
    await ctx.db
      .update(roles)
      .set({ permissions: ['workspace.view', 'tickets.view'] })
      .where(and(eq(roles.organisationId, f.acmeId), eq(roles.key, 'readonly')));
    const response = await get(`${org()}/ticket-query/context`, 'readonly');
    expect(queryContextSchema.parse(response.json()).people).toEqual([]);
    // "me" still works for them.
    expect((await list('assignee:me', 'readonly')).total).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ['restricted', 403],
    ['other-owner', 404],
  ] as const)('is refused to %s: %i', async (identity, expected) => {
    expect((await get(`${org()}/ticket-query/context`, identity)).statusCode).toBe(expected);
  });
});

describe('listing with a query', () => {
  it('narrows the list as the filters would', async () => {
    const byQuery = await list('project:WEB status:"in the forge"');
    const response = await get(`${org()}/tickets?project=WEB&statusKey=in_progress`);
    const byFilters = ticketListSchema.parse(response.json());
    expect(byQuery.total).toBe(byFilters.total);
    expect(byQuery.total).toBeGreaterThan(0);
    expect(byQuery.items.every((item) => item.status.key === 'in_progress')).toBe(true);
  });

  it('finds a person by name and orders as asked', async () => {
    const result = await list('project:WEB assignee:"Dana Developer" order:key');
    expect(result.items.length).toBeGreaterThan(0);
    const keys = result.items.map((item) => item.key);
    const numbers = keys.map((key) => Number(key.split('-')[1]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('filters by when tickets were made', async () => {
    const all = await list('project:WEB');
    await ctx.db
      .update(tickets)
      .set({ createdAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(tickets.key, 'WEB-1'));
    const recent = await list('project:WEB created:>-30d');
    expect(recent.total).toBe(all.total - 1);
    const old = await list('project:WEB created:<2021-01-01');
    expect(old.items.map((item) => item.key)).toEqual(['WEB-1']);
  });

  it('is refused with each problem named', async () => {
    const response = await get(
      `${org()}/tickets?query=${encodeURIComponent('statsu:open due:soon')}`,
    );
    expect(response.statusCode).toBe(422);
    const messages = (response.json().error.details as { message: string }[]).map((d) => d.message);
    expect(messages).toEqual([
      'There is no filter called statsu. Did you mean status?',
      expect.stringMatching(/^due: is one of/),
    ]);
  });

  it('works on the project board too', async () => {
    const response = await get(
      `${org()}/projects/WEB/board?query=${encodeURIComponent('assignee:none')}`,
    );
    expect(response.statusCode).toBe(200);
  });
});
