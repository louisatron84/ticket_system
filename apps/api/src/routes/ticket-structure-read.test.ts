import { ticketDetailSchema, ticketListSchema, type ChildNode } from '@forge/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, ticketRow, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;
let f: Facts;

// The demo data: WEB-5 is an epic over WEB-8 (Warming), WEB-11 (Warming) and WEB-12 (Quenched);
// WEB-10 (Cold Steel) is a sub-task of WEB-8; API-3 (Tempering) blocks WEB-7 (Jammed).

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

const as = async (identity = 'developer') => ({ cookie: await ctx.cookieFor(identity) });

const list = async (query: string) => {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/orgs/${f.acmeId}/tickets?${query}`,
    headers: await as(),
  });
  expect(response.statusCode, response.body).toBe(200);
  return ticketListSchema.parse(response.json());
};

const keys = async (query: string) =>
  (await list(`pageSize=100&sort=key&dir=asc&${query}`)).items.map((t) => t.key);

const detail = async (key: string) => {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}`,
    headers: await as(),
  });
  expect(response.statusCode, response.body).toBe(200);
  return ticketDetailSchema.parse(response.json());
};

const summaryOf = async (key: string) =>
  (await list('pageSize=100')).items.find((t) => t.key === key)!;

const put = async (key: string, parentKey: string | null) => {
  const response = await ctx.app.inject({
    method: 'PUT',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/parent`,
    payload: { parentKey },
    headers: await as(),
  });
  expect(response.statusCode, response.body).toBe(200);
};

const move = async (key: string, statusKey: string) => {
  const row = (await ticketRow(ctx.db, key))!;
  const response = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}`,
    payload: { version: row.version, statusId: f.statusId(key.split('-')[0]!, statusKey) },
    headers: await as(),
  });
  expect(response.statusCode, response.body).toBe(200);
};

const tree = (nodes: ChildNode[]): unknown =>
  nodes.map((node) => (node.children.length ? { [node.key]: tree(node.children) } : node.key));

describe('structure in summaries', () => {
  it('carries parent, progress and open blockers', async () => {
    expect(await summaryOf('WEB-8')).toMatchObject({
      parentKey: 'WEB-5',
      progress: { completed: 0, inProgress: 0, jammed: 0, notStarted: 1 },
      openBlockerKeys: [],
    });
    expect(await summaryOf('WEB-5')).toMatchObject({
      parentKey: null,
      progress: { completed: 1, inProgress: 0, jammed: 0, notStarted: 3 },
    });
    expect(await summaryOf('WEB-7')).toMatchObject({ openBlockerKeys: ['API-3'] });
    expect(await summaryOf('WEB-1')).toMatchObject({
      parentKey: null,
      progress: null,
      openBlockerKeys: [],
    });
  });

  it('counts every descendant by bucket and leaves out scrapped ones', async () => {
    await move('WEB-8', 'blocked'); // Warming → Jammed
    await move('WEB-11', 'cancelled'); // Warming → Scrapped
    await put('WEB-9', 'WEB-5'); // already Scrapped
    expect((await summaryOf('WEB-5')).progress).toEqual({
      completed: 1,
      inProgress: 0,
      jammed: 1,
      notStarted: 1,
    });
    await move('WEB-10', 'open');
    await move('WEB-10', 'in_progress');
    expect((await summaryOf('WEB-5')).progress).toEqual({
      completed: 1,
      inProgress: 1,
      jammed: 1,
      notStarted: 0,
    });
  });

  it('a completed ticket shows no open blockers and does not count as blocked', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-6/links`,
      payload: { choice: 'blocked_by', otherKey: 'API-4' },
      headers: await as(),
    });
    expect(response.statusCode, response.body).toBe(201);
    expect((await summaryOf('WEB-6')).openBlockerKeys).toEqual([]);
    expect(await keys('blocked=yes')).toEqual(['WEB-7']);
  });
});

describe('structure in the ticket page', () => {
  it('has ancestors from the top, the whole child tree and grouped links', async () => {
    expect((await detail('WEB-10')).ancestors.map((a) => a.key)).toEqual(['WEB-5', 'WEB-8']);
    const epic = await detail('WEB-5');
    expect(epic.ancestors).toEqual([]);
    expect(tree(epic.children)).toEqual([{ 'WEB-8': ['WEB-10'] }, 'WEB-11', 'WEB-12']);
    expect(epic.children[0]).toMatchObject({
      key: 'WEB-8',
      status: { key: 'open', name: 'Warming', category: 'not_started' },
      archived: false,
    });
    expect((await detail('WEB-7')).links.map((l) => `${l.label} ${l.ticket.key}`)).toEqual([
      'Blocked by API-3',
    ]);
  });
});

describe('structure filters', () => {
  it('parent: tickets directly under it', async () => {
    expect(await keys('parent=WEB-5')).toEqual(['WEB-8', 'WEB-11', 'WEB-12']);
  });

  it('epic: tickets anywhere under it', async () => {
    expect(await keys('epic=web-5')).toEqual(['WEB-8', 'WEB-10', 'WEB-11', 'WEB-12']);
  });

  it('blocked: yes and no', async () => {
    expect(await keys('blocked=yes')).toEqual(['WEB-7']);
    const without = await keys('blocked=no&project=WEB');
    expect(without).not.toContain('WEB-7');
    expect(without).toHaveLength(11);
  });

  it('linked: any link to it, either way', async () => {
    expect(await keys('linked=API-3')).toEqual(['WEB-7']);
    expect(await keys('linked=WEB-7')).toEqual(['API-3']);
  });

  it('top: only tickets with no parent', async () => {
    const top = await keys('top=true&project=WEB');
    expect(top).toHaveLength(8);
    for (const child of ['WEB-8', 'WEB-10', 'WEB-11', 'WEB-12']) expect(top).not.toContain(child);
  });

  it('a filter on a ticket that does not exist matches nothing', async () => {
    expect(await keys('parent=WEB-999')).toEqual([]);
    expect(await keys('epic=OPS-1')).toEqual([]);
  });
});

describe('tree mode', () => {
  const rowsOf = async (query: string) => {
    const result = await list(`tree=true&sort=key&dir=asc&${query}`);
    return {
      total: result.total,
      rootTotal: result.rootTotal,
      items: result.items.map((t) => t.key),
      rows: result.rows!.map(
        (row) => `${'  '.repeat(row.depth - 1)}${row.ticket.key}${row.context ? ' (context)' : ''}`,
      ),
    };
  };

  it('pages by top-level rows, greys ancestors that do not match, and counts only matches', async () => {
    expect(await rowsOf('project=WEB&statusKey=open&pageSize=2')).toEqual({
      total: 3,
      rootTotal: 2,
      items: ['WEB-2', 'WEB-8', 'WEB-11'],
      rows: ['WEB-2', 'WEB-5 (context)', '  WEB-8', '  WEB-11'],
    });
    expect(await rowsOf('project=WEB&statusKey=open&pageSize=1&page=2')).toEqual({
      total: 3,
      rootTotal: 2,
      items: ['WEB-8', 'WEB-11'],
      rows: ['WEB-5 (context)', '  WEB-8', '  WEB-11'],
    });
  });

  it('shows a sub-task under both of its ancestors', async () => {
    expect((await rowsOf('project=WEB&statusKey=backlog')).rows).toEqual([
      'WEB-4',
      'WEB-5 (context)',
      '  WEB-8 (context)',
      '    WEB-10',
    ]);
  });

  it('shows a child whose parent is in another project under that parent', async () => {
    await put('API-4', 'WEB-5');
    expect((await rowsOf('project=API&statusKey=open')).rows).toEqual([
      'WEB-5 (context)',
      '  API-4',
      'API-6',
    ]);
  });

  it('leaves the flat list without rows', async () => {
    expect((await list('project=WEB')).rows).toBeUndefined();
  });
});
