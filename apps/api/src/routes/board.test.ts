import { createTicketRow, projectStatuses } from '@forge/db';
import { boardSchema } from '@forge/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';
import { addListDataset, updatedMinute } from '../test-support/ticket-dataset';

let ctx: Integration;
let f: Facts;
let projectId: string;
let statusIds: Record<string, string>;

beforeAll(async () => {
  ctx = await startIntegration();
});

beforeEach(async () => {
  await ctx.reseed();
  f = await loadFacts(ctx.db);
  ({ projectId, statusIds } = await addListDataset(ctx.db, f));
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

async function board(projectKey: string, params: Params = {}, as = 'owner', orgId = f.acmeId) {
  return ctx.app.inject({
    method: 'GET',
    url: `/api/v1/orgs/${orgId}/projects/${projectKey}/board?${queryString(params)}`,
    headers: { cookie: await ctx.cookieFor(as) },
  });
}

const numberOf = (key: string) => Number(key.split('-')[1]);

/** For each column of LST's board: status key → the ticket numbers in it, in order. */
async function lstColumns(params: Params = {}, as = 'owner') {
  const response = await board('LST', params, as);
  expect(response.statusCode, response.body).toBe(200);
  const { columns } = boardSchema.parse(response.json());
  return Object.fromEntries(
    columns.map((c) => [c.status.key, c.tickets.map((t) => numberOf(t.key))]),
  ) as Record<string, number[]>;
}

describe('who may see a board', () => {
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
    expect((await board('LST', {}, identity)).statusCode).toBe(expected);
  });

  it('answers 401 to someone who is not signed in', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${f.acmeId}/projects/LST/board`,
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('the columns', () => {
  it('has one column per active status, in workflow order, with its category', async () => {
    const { columns } = boardSchema.parse((await board('LST')).json());
    expect(columns.map((c) => [c.status.key, c.status.category])).toEqual([
      ['backlog', 'not_started'],
      ['open', 'not_started'],
      ['in_progress', 'in_progress'],
      ['in_review', 'in_progress'],
      ['blocked', 'in_progress'],
      ['done', 'completed'],
      ['cancelled', 'completed'],
    ]);
    expect(columns.map((c) => c.status.sortOrder)).toEqual(
      [...columns.map((c) => c.status.sortOrder)].sort((a, b) => a - b),
    );
    expect(columns.filter((c) => c.status.initial).map((c) => c.status.key)).toEqual(['backlog']);
    expect(columns.map((c) => c.status.id)).toEqual(
      ['backlog', 'open', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'].map(
        (key) => statusIds[key],
      ),
    );
  });

  it('puts each ticket in the column of its status, most recently updated first', async () => {
    const byUpdate = (numbers: number[]) =>
      [...numbers].sort((a, b) => updatedMinute(b) - updatedMinute(a));
    expect(await lstColumns()).toEqual({
      backlog: byUpdate([2, 11, 12]),
      open: byUpdate([1, 5, 10]),
      in_progress: [3],
      in_review: [8],
      blocked: [6],
      done: [4],
      cancelled: [9],
    });
  });

  it('counts every ticket of a column in its total', async () => {
    const { columns } = boardSchema.parse((await board('LST')).json());
    expect(Object.fromEntries(columns.map((c) => [c.status.key, c.total]))).toEqual({
      backlog: 3,
      open: 3,
      in_progress: 1,
      in_review: 1,
      blocked: 1,
      done: 1,
      cancelled: 1,
    });
    // Archived ticket 7 is in no column and in no total.
    expect(columns.reduce((sum, c) => sum + c.total, 0)).toBe(11);
  });

  it('shows the same ticket summaries the list does', async () => {
    const { columns } = boardSchema.parse((await board('LST')).json());
    const card = columns.flatMap((c) => c.tickets).find((t) => t.key === 'LST-1')!;
    expect(card).toMatchObject({
      title: 'Fix login redirect',
      status: { key: 'open' },
      priority: { key: 'high' },
      assignee: { email: 'developer@acme.test' },
      version: 1,
    });
    expect(card.labels.map((l) => l.name)).toEqual(['bug', 'frontend']);
  });

  it('shows seeded projects too', async () => {
    const { columns } = boardSchema.parse((await board('WEB')).json());
    expect(columns).toHaveLength(7);
    expect(columns.reduce((sum, c) => sum + c.total, 0)).toBe(12);
    expect(columns.flatMap((c) => c.tickets).every((t) => t.project.key === 'WEB')).toBe(true);
  });

  it('stops each column at 50 tickets but still reports how many there are', async () => {
    const owner = f.userId('owner');
    for (let i = 0; i < 55; i += 1) {
      await ctx.db.transaction((tx) =>
        createTicketRow(tx, {
          organisationId: f.acmeId,
          projectId,
          reporterId: owner,
          title: `Extra ${i}`,
          typeId: f.typeId('acme', 'task'),
          priorityId: f.priorityId('acme', 'normal'),
        }),
      );
    }
    const { columns } = boardSchema.parse((await board('LST', { sort: 'key', dir: 'asc' })).json());
    const backlog = columns.find((c) => c.status.key === 'backlog')!;
    expect(backlog.total).toBe(58);
    expect(backlog.tickets).toHaveLength(50);
    // The first 50 in the order asked for: 2, 11, 12, then the extras from 13.
    expect(backlog.tickets.slice(0, 4).map((t) => numberOf(t.key))).toEqual([2, 11, 12, 13]);
    // Other columns are untouched.
    expect(columns.find((c) => c.status.key === 'open')!.tickets).toHaveLength(3);
  });
});

describe('filtering a board', () => {
  it('narrows every column with the same filters the list uses', async () => {
    expect(await lstColumns({ assignee: 'me', label: 'bug' }, 'developer')).toEqual({
      backlog: [],
      open: [1],
      in_progress: [],
      in_review: [8],
      blocked: [],
      done: [4],
      cancelled: [],
    });
  });

  it('reports totals for what is left after filtering', async () => {
    const { columns } = boardSchema.parse((await board('LST', { priority: 'high' })).json());
    expect(Object.fromEntries(columns.map((c) => [c.status.key, c.total]))).toMatchObject({
      open: 1,
      in_review: 1,
      backlog: 0,
      done: 0,
    });
  });

  it('searches text, key prefixes and due dates', async () => {
    expect((await lstColumns({ q: 'login' })).open).toEqual([1]);
    expect(Object.values(await lstColumns({ q: 'zzz-nothing' })).flat()).toEqual([]);
    expect((await lstColumns({ due: 'overdue' })).open).toEqual([1]);
  });

  it('ignores status filters: the columns are the statuses', async () => {
    const unfiltered = await lstColumns({ sort: 'key', dir: 'asc' });
    expect(await lstColumns({ sort: 'key', dir: 'asc', statusKey: 'open' })).toEqual(unfiltered);
    expect(await lstColumns({ sort: 'key', dir: 'asc', statusCategory: 'completed' })).toEqual(
      unfiltered,
    );
  });

  it('ignores a project filter and page settings: the address names the project', async () => {
    const unfiltered = await lstColumns({ sort: 'key', dir: 'asc' });
    expect(await lstColumns({ sort: 'key', dir: 'asc', project: 'WEB' })).toEqual(unfiltered);
    expect(await lstColumns({ sort: 'key', dir: 'asc', page: '3', pageSize: '1' })).toEqual(
      unfiltered,
    );
  });

  it('orders each column by the sort asked for', async () => {
    const columns = await lstColumns({ sort: 'key', dir: 'desc' });
    expect(columns.backlog).toEqual([12, 11, 2]);
    expect(columns.open).toEqual([10, 5, 1]);
  });

  it('leaves archived tickets out unless asked', async () => {
    expect((await lstColumns({ sort: 'key', dir: 'asc' })).backlog).toEqual([2, 11, 12]);
    expect((await lstColumns({ sort: 'key', dir: 'asc', archived: 'true' })).backlog).toEqual([
      2, 7, 11, 12,
    ]);
  });

  it('refuses invalid filters with 422', async () => {
    for (const params of [{ sort: 'password' }, { due: 'sometime' }, { assignee: 'x' }]) {
      const response = await board('LST', params);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('validation_failed');
    }
  });
});

describe('a status that is switched off', () => {
  it('has no column, and its tickets are not on the board', async () => {
    await ctx.db
      .update(projectStatuses)
      .set({ isActive: false })
      .where(and(eq(projectStatuses.projectId, projectId), eq(projectStatuses.key, 'cancelled')));
    const columns = await lstColumns({ sort: 'key', dir: 'asc' });
    expect(Object.keys(columns)).toEqual([
      'backlog',
      'open',
      'in_progress',
      'in_review',
      'blocked',
      'done',
    ]);
    expect(Object.values(columns).flat()).not.toContain(9);
  });
});

describe('a project that is not there or not theirs', () => {
  it.each(['NOPE', 'W', 'LST-1', '..%2Fx', 'OPS'])('%s gets a plain 404', async (key) => {
    expect((await board(key)).statusCode).toBe(404);
  });

  it('finds the project whatever the case of its key', async () => {
    expect((await board('lst')).statusCode).toBe(200);
  });

  it("keeps workspaces apart: Northwind's board is theirs, and Acme's is not reachable by them", async () => {
    const nora = boardSchema.parse((await board('OPS', {}, 'other-owner', f.northwindId)).json());
    expect(nora.columns.reduce((sum, c) => sum + c.total, 0)).toBe(4);
    expect(nora.columns.flatMap((c) => c.tickets).every((t) => t.key.startsWith('OPS-'))).toBe(
      true,
    );
    expect((await board('WEB', {}, 'other-owner', f.northwindId)).statusCode).toBe(404);
    expect((await board('LST', {}, 'other-owner', f.acmeId)).statusCode).toBe(404);
    expect((await board('OPS', {}, 'owner', f.acmeId)).statusCode).toBe(404);
  });
});
