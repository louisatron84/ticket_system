import { tickets } from '@forge/db';
import { ticketListSchema } from '@forge/shared';
import { isNull, eq, and } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';
import { addListDataset, updatedMinute, utcDay } from '../test-support/ticket-dataset';

let ctx: Integration;
let f: Facts;
let idByNumber: Map<number, string>;

beforeAll(async () => {
  ctx = await startIntegration();
});

beforeEach(async () => {
  await ctx.reseed();
  f = await loadFacts(ctx.db);
  ({ idByNumber } = await addListDataset(ctx.db, f));
});

afterAll(async () => {
  await ctx.close();
});

type Params = Record<string, string | string[] | undefined>;
const queryString = (params: Params) => {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const single of Array.isArray(value) ? value : [value]) search.append(name, single);
  }
  return search.toString();
};

async function list(params: Params, as = 'owner', orgId = f.acmeId) {
  return ctx.app.inject({
    method: 'GET',
    url: `/api/v1/orgs/${orgId}/tickets?${queryString(params)}`,
    headers: { cookie: await ctx.cookieFor(as) },
  });
}

const numberOf = (key: string) => Number(key.split('-')[1]);

/** The numbers of the LST tickets a query returns, in the order returned. */
async function lst(params: Params = {}, as = 'owner'): Promise<number[]> {
  const response = await list(
    { project: 'LST', sort: 'key', dir: 'asc', pageSize: '100', ...params },
    as,
  );
  expect(response.statusCode, response.body).toBe(200);
  return ticketListSchema.parse(response.json()).items.map((item) => numberOf(item.key));
}

const ACTIVE = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

describe('who may list tickets', () => {
  const matrix: [string, number][] = [
    ['owner', 200],
    ['admin', 200],
    ['developer', 200],
    ['reviewer', 200],
    ['readonly', 200],
    ['restricted', 403],
    ['other-owner', 404],
  ];

  it.each(matrix)('%s gets %i', async (identity, expected) => {
    expect((await list({}, identity)).statusCode).toBe(expected);
  });

  it('answers 401 to someone who is not signed in', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${f.acmeId}/tickets`,
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('what a list item says', () => {
  it('carries what a row needs: key, title, project, type, status, priority, people, labels, dates', async () => {
    const response = await list({ project: 'LST', q: 'Fix login' });
    const { items, total, page, pageSize } = ticketListSchema.parse(response.json());
    expect({ total, page, pageSize, count: items.length }).toEqual({
      total: 1,
      page: 1,
      pageSize: 50,
      count: 1,
    });
    expect(items[0]).toMatchObject({
      id: idByNumber.get(1),
      key: 'LST-1',
      title: 'Fix login redirect',
      project: { key: 'LST', name: 'List tests' },
      type: { key: 'bug' },
      status: { key: 'open', category: 'not_started' },
      priority: { key: 'high', rank: 4 },
      assignee: { email: 'developer@acme.test', displayName: 'Dana Developer' },
      dueDate: utcDay(-3),
      // Cards and rows carry the version, so a move or edit from them can be checked for staleness.
      version: 1,
    });
    expect(items[0]!.labels.map((l) => l.name)).toEqual(['bug', 'frontend']);
  });

  it('shows an unassigned ticket with no assignee and no labels', async () => {
    const { items } = ticketListSchema.parse(
      (await list({ project: 'LST', q: 'Plan quarter' })).json(),
    );
    expect(items[0]).toMatchObject({ key: 'LST-10', assignee: null, labels: [], dueDate: null });
  });
});

describe('filtering', () => {
  type Case = [name: string, params: (f: Facts) => Params, expected: number[], as?: string];
  const cases: Case[] = [
    ['nothing: every active ticket of the project', () => ({}), ACTIVE],
    [
      'archived=true adds the archived ones',
      () => ({ archived: 'true' }),
      [...ACTIVE, 7].sort((a, b) => a - b),
    ],
    ['archived=false is the same as leaving it out', () => ({ archived: 'false' }), ACTIVE],

    ['one status', () => ({ statusKey: 'open' }), [1, 5, 10]],
    ['two statuses (either)', () => ({ statusKey: ['open', 'blocked'] }), [1, 5, 6, 10]],
    ['a status that does not exist', () => ({ statusKey: 'nope' }), []],
    ['category completed', () => ({ statusCategory: 'completed' }), [4, 9]],
    ['category not_started', () => ({ statusCategory: 'not_started' }), [1, 2, 5, 10, 11, 12]],
    ['category in_progress', () => ({ statusCategory: 'in_progress' }), [3, 6, 8]],

    ['one type', () => ({ type: 'bug' }), [1]],
    ['another type', () => ({ type: 'task' }), [3, 5, 11, 12]],
    ['two types (either)', () => ({ type: ['bug', 'feature'] }), [1, 2, 9]],
    ['one priority', () => ({ priority: 'high' }), [1, 8]],
    ['two priorities (either)', () => ({ priority: ['high', 'critical'] }), [1, 4, 8]],
    ['the lowest priority', () => ({ priority: 'lowest' }), [6]],

    ['assignee=me', () => ({ assignee: 'me' }), [1, 4, 6, 8], 'developer'],
    ['assignee=me for someone with no tickets', () => ({ assignee: 'me' }), [], 'readonly'],
    ['assignee=none', () => ({ assignee: 'none' }), [2, 9, 10, 11]],
    [
      'assignee=me or none',
      () => ({ assignee: ['me', 'none'] }),
      [1, 2, 4, 6, 8, 9, 10, 11],
      'developer',
    ],
    ['assignee=a person by id', (x) => ({ assignee: x.userId('reviewer') }), [3, 5]],
    ['assignee=someone from another workspace', (x) => ({ assignee: x.userId('other-owner') }), []],
    ['reporter=me', () => ({ reporter: 'me' }), [3, 6], 'developer'],
    ['reporter=a person by id', (x) => ({ reporter: x.userId('reviewer') }), [4, 8]],
    ['reporter=the owner', (x) => ({ reporter: x.userId('owner') }), [1, 2, 5, 9, 11, 12]],
    ['reporter=the admin', (x) => ({ reporter: x.userId('admin') }), [10]],

    ['one label', () => ({ label: 'bug' }), [1, 4, 8]],
    ['another label', () => ({ label: 'frontend' }), [1, 2, 6, 8]],
    ['two labels: tickets with both', () => ({ label: ['bug', 'frontend'] }), [1, 8]],
    ['a label name in other case', () => ({ label: 'BUG' }), [1, 4, 8]],
    ['a label that does not exist', () => ({ label: 'nonexistent' }), []],

    ['due=overdue: past and not finished', () => ({ due: 'overdue' }), [1]],
    ['due=today', () => ({ due: 'today' }), [3]],
    ['due=week: today through the next 7 days', () => ({ due: 'week' }), [2, 3, 8, 12]],
    ['due=none', () => ({ due: 'none' }), [5, 10, 11]],

    ['text in a title', () => ({ q: 'login' }), [1]],
    ['text in other case', () => ({ q: 'LOGIN' }), [1]],
    ['text with surrounding spaces', () => ({ q: '  login  ' }), [1]],
    ['% only matches a real percent sign', () => ({ q: '%' }), [3]],
    ['_ only matches a real underscore', () => ({ q: '_' }), [3]],
    ['a backslash only matches a real backslash', () => ({ q: '\\' }), [5]],
    ['a word with an underscore', () => ({ q: 'coverage_goal' }), [3]],
    ['a key prefix, whatever its case', () => ({ q: 'lst-1' }), [1, 10, 11, 12]],
    ['a whole key', () => ({ q: 'LST-12' }), [12]],
    ['a word in two titles', () => ({ q: 'thing' }), [11, 12]],
    ['text found nowhere', () => ({ q: 'zzz-nothing' }), []],
    ['right-to-left text found nowhere', () => ({ q: 'مرحبا' }), []],
    ['blank text means no text filter', () => ({ q: '   ' }), ACTIVE],
    ['an SQL fragment is only text', () => ({ q: "'; DROP TABLE tickets; --" }), []],

    ['mine, labelled bug', () => ({ assignee: 'me', label: 'bug' }), [1, 4, 8], 'developer'],
    [
      'mine, labelled bug, finished',
      () => ({ assignee: 'me', label: 'bug', statusCategory: 'completed' }),
      [4],
      'developer',
    ],
    ['high priority due this week', () => ({ priority: 'high', due: 'week' }), [8]],
  ];

  it.each(cases)('%s', async (_name, params, expected, as = 'owner') => {
    expect(await lst(params(f), as)).toEqual(expected);
  });

  it('left the tickets table intact after the SQL fragment', async () => {
    await lst({ q: "'; DROP TABLE tickets; --" });
    expect(await lst()).toEqual(ACTIVE);
  });

  it('matches several projects at once, and ignores the case of a project key', async () => {
    const both = ticketListSchema.parse(
      (await list({ project: ['lst', 'web'], pageSize: '100' })).json(),
    );
    expect(new Set(both.items.map((i) => i.project.key))).toEqual(new Set(['LST', 'WEB']));
    expect(both.total).toBe(ACTIVE.length + 12);
  });

  it('finds nothing, without complaint, for a project that does not exist', async () => {
    const response = await list({ project: 'NOPE' });
    expect(response.statusCode).toBe(200);
    expect(ticketListSchema.parse(response.json())).toMatchObject({ items: [], total: 0 });
  });
});

describe('ordering', () => {
  const numbersFor = async (sort: string, dir: string) => lst({ sort, dir });

  it('puts the most recently updated first by default', async () => {
    const response = await list({ project: 'LST', pageSize: '100' });
    const got = ticketListSchema.parse(response.json()).items.map((i) => numberOf(i.key));
    const expected = [...ACTIVE].sort((a, b) => updatedMinute(b) - updatedMinute(a));
    expect(got).toEqual(expected);
  });

  it('orders by update time, either way', async () => {
    const asc = [...ACTIVE].sort((a, b) => updatedMinute(a) - updatedMinute(b));
    expect(await numbersFor('updated', 'asc')).toEqual(asc);
    expect(await numbersFor('updated', 'desc')).toEqual([...asc].reverse());
  });

  it('orders by creation time, either way', async () => {
    expect(await numbersFor('created', 'asc')).toEqual(ACTIVE);
    expect(await numbersFor('created', 'desc')).toEqual([...ACTIVE].reverse());
  });

  it('orders by key as a number: 10 comes after 9, not after 1', async () => {
    expect(await numbersFor('key', 'asc')).toEqual(ACTIVE);
    expect(await numbersFor('key', 'desc')).toEqual([...ACTIVE].reverse());
  });

  it('orders by priority rank, ties by id in the same direction', async () => {
    const rankOf: Record<number, number> = {
      1: 4,
      2: 3,
      3: 2,
      4: 5,
      5: 3,
      6: 1,
      8: 4,
      9: 2,
      10: 3,
      11: 3,
      12: 2,
    };
    for (const dir of ['asc', 'desc'] as const) {
      const response = await list({ project: 'LST', sort: 'priority', dir, pageSize: '100' });
      const { items } = ticketListSchema.parse(response.json());
      const got = items.map((item) => numberOf(item.key));
      expect(got).toHaveLength(ACTIVE.length);
      // The ranks the API reports are the ones this test reasons with.
      for (const item of items) expect(item.priority.rank).toBe(rankOf[numberOf(item.key)]);

      const ranks = got.map((n) => rankOf[n]!);
      expect(ranks).toEqual([...ranks].sort((a, b) => (dir === 'asc' ? a - b : b - a)));
      // Inside a group of equal rank, ids (which grow with creation) follow the direction.
      for (const rank of new Set(ranks)) {
        const group = got.filter((n) => rankOf[n] === rank);
        expect(group).toEqual([...group].sort((a, b) => (dir === 'asc' ? a - b : b - a)));
      }
    }
    expect((await numbersFor('priority', 'desc'))[0]).toBe(4);
    expect((await numbersFor('priority', 'asc'))[0]).toBe(6);
  });

  it('orders by due date with undated tickets last, whichever way', async () => {
    // Dated, soonest first: 4 (-10), 1 (-3), 9 (-1), 3 (0), 12 (+1), 2 (+3), 8 (+7), 6 (+30).
    const dated = [4, 1, 9, 3, 12, 2, 8, 6];
    const undated = [5, 10, 11];
    expect(await numbersFor('due', 'asc')).toEqual([...dated, ...undated]);
    expect(await numbersFor('due', 'desc')).toEqual([
      ...[...dated].reverse(),
      ...[...undated].reverse(),
    ]);
  });
});

describe('paging', () => {
  it('splits the list into pages that together hold every ticket exactly once', async () => {
    const pages: number[][] = [];
    for (const page of [1, 2, 3]) {
      const response = await list({
        project: 'LST',
        sort: 'key',
        dir: 'asc',
        pageSize: '5',
        page: String(page),
      });
      const body = ticketListSchema.parse(response.json());
      expect(body).toMatchObject({ total: 11, page, pageSize: 5 });
      pages.push(body.items.map((i) => numberOf(i.key)));
    }
    expect(pages).toEqual([[1, 2, 3, 4, 5], [6, 8, 9, 10, 11], [12]]);
  });

  it('answers a page past the end with no items, and the right total', async () => {
    const body = ticketListSchema.parse(
      (await list({ project: 'LST', pageSize: '5', page: '4' })).json(),
    );
    expect(body).toMatchObject({ items: [], total: 11, page: 4 });
  });

  it('never repeats or drops a ticket between pages, even when most of them tie', async () => {
    // Sorting by priority leaves several tickets with the same rank; the id settles them.
    for (const dir of ['asc', 'desc']) {
      const seen: number[] = [];
      for (let page = 1; page <= 6; page += 1) {
        const body = ticketListSchema.parse(
          (
            await list({ project: 'LST', sort: 'priority', dir, pageSize: '2', page: String(page) })
          ).json(),
        );
        seen.push(...body.items.map((i) => numberOf(i.key)));
      }
      expect(seen).toHaveLength(ACTIVE.length);
      expect(new Set(seen)).toEqual(new Set(ACTIVE));
      expect(seen).toEqual(await lst({ sort: 'priority', dir }));
    }
  });

  it('accepts the largest page size, 100', async () => {
    expect((await list({ pageSize: '100' })).statusCode).toBe(200);
  });
});

describe('workspaces keep their tickets apart', () => {
  it("lists only the caller's own workspace", async () => {
    const nora = ticketListSchema.parse((await list({}, 'other-owner', f.northwindId)).json());
    expect(nora.total).toBe(4);
    expect(nora.items.every((i) => i.key.startsWith('OPS-'))).toBe(true);

    const olivia = ticketListSchema.parse((await list({ pageSize: '100' })).json());
    const expectedTotal = (
      await ctx.db
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(eq(tickets.organisationId, f.acmeId), isNull(tickets.archivedAt)))
    ).length;
    expect(olivia.total).toBe(expectedTotal);
    expect(olivia.items.some((i) => i.key.startsWith('OPS-'))).toBe(false);
  });

  it("finds nothing of another workspace's, by project, person or text", async () => {
    expect(ticketListSchema.parse((await list({ project: 'OPS' })).json()).total).toBe(0);
    expect(
      ticketListSchema.parse((await list({ assignee: f.userId('other-owner') })).json()).total,
    ).toBe(0);
    expect(
      ticketListSchema.parse((await list({ reporter: f.userId('other-owner') })).json()).total,
    ).toBe(0);
  });
});

describe('input that is wrong or hostile', () => {
  const tooMany = (name: string, count: number) =>
    [name, Array.from({ length: count }, () => 'x')] as const;

  const refused: [string, Params][] = [
    ['pageSize=100000', { pageSize: '100000' }],
    ['pageSize=101', { pageSize: '101' }],
    ['pageSize=0', { pageSize: '0' }],
    ['pageSize=-5', { pageSize: '-5' }],
    ['pageSize=abc', { pageSize: 'abc' }],
    ['page=0', { page: '0' }],
    ['page=-1', { page: '-1' }],
    ['page=1.5', { page: '1.5' }],
    ['page=abc', { page: 'abc' }],
    ['page=10001', { page: '10001' }],
    ['two pages at once', { page: ['1', '2'] }],
    ['an unknown sort', { sort: 'password' }],
    ['a sort with SQL in it', { sort: 'updated; drop table tickets' }],
    ['an unknown direction', { dir: 'sideways' }],
    ['text of 101 characters', { q: 'a'.repeat(101) }],
    ['a NUL character in the text', { q: 'a\u0000b' }],
    ['a bell character in the text', { q: 'a\u0007b' }],
    ['21 projects', { project: Array.from({ length: 21 }, () => 'WEB') }],
    ['a project that is not a key', { project: 'not a key' }],
    ['500 repeated labels', Object.fromEntries([tooMany('label', 500)])],
    ['a label of 41 characters', { label: 'a'.repeat(41) }],
    ['an unknown due filter', { due: 'sometime' }],
    ['archived=maybe', { archived: 'maybe' }],
    ['assignee that is not a person', { assignee: 'not-a-uuid' }],
    ['assignee=me,none as one value', { assignee: 'me,none' }],
    ['reporter=none, which is not a choice', { reporter: 'none' }],
    ['an upper-case priority key', { priority: 'HIGH' }],
    ['a status key with a space', { statusKey: 'in progress' }],
    ['an unknown status category', { statusCategory: 'started' }],
  ];

  it.each(refused)('%s → 422 naming the problem', async (_name, params) => {
    const response = await list(params);
    expect(response.statusCode, response.body).toBe(422);
    const { error } = response.json();
    expect(error.code).toBe('validation_failed');
    expect(error.details.length).toBeGreaterThan(0);
    expect(error.details[0]).toEqual({ path: expect.any(String), message: expect.any(String) });
  });

  it('names the field that is wrong', async () => {
    const response = await list({ pageSize: '100000', sort: 'password' });
    expect(
      response
        .json()
        .error.details.map((d: { path: string }) => d.path)
        .sort(),
    ).toEqual(['pageSize', 'sort']);
  });

  it.each([
    ['an unknown parameter', { utm_source: 'newsletter' }],
    ['bracket syntax, which is not part of the contract', { 'assignee[]': 'me' }],
    ['empty values', { q: '', project: '', due: '' }],
  ])('ignores %s', async (_name, params) => {
    const response = await list({ project: 'LST', ...params });
    expect(response.statusCode, response.body).toBe(200);
  });
});
