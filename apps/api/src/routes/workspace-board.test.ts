import { projects, projectStatuses, statusTransitions, tickets } from '@forge/db';
import { ticketListSchema, workspaceBoardSchema } from '@forge/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';
import { addListDataset } from '../test-support/ticket-dataset';

let ctx: Integration;
let f: Facts;
let projectId: string;
let statusIds: Record<string, string>;
let idByNumber: Map<number, string>;

beforeAll(async () => {
  ctx = await startIntegration();
});

beforeEach(async () => {
  await ctx.reseed();
  f = await loadFacts(ctx.db);
  ({ projectId, statusIds, idByNumber } = await addListDataset(ctx.db, f));
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

async function board(params: Params = {}, as = 'owner', orgId = f.acmeId) {
  return ctx.app.inject({
    method: 'GET',
    url: `/api/v1/orgs/${orgId}/board?${queryString(params)}`,
    headers: { cookie: await ctx.cookieFor(as) },
  });
}

async function parsedBoard(params: Params = {}, as = 'owner', orgId = f.acmeId) {
  const response = await board(params, as, orgId);
  expect(response.statusCode, response.body).toBe(200);
  return workspaceBoardSchema.parse(response.json());
}

describe('who may see the workspace board', () => {
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
    expect((await board({}, identity)).statusCode).toBe(expected);
  });

  it('answers 401 to someone who is not signed in', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/orgs/${f.acmeId}/board` });
    expect(response.statusCode).toBe(401);
  });
});

describe('the columns', () => {
  it('has a column per status key, in workflow order, with the forge names', async () => {
    const { columns } = await parsedBoard();
    expect(columns.map((c) => c.status.key)).toEqual([
      'backlog',
      'open',
      'in_progress',
      'in_review',
      'blocked',
      'done',
      'cancelled',
    ]);
    expect(columns.map((c) => c.status.name)).toEqual([
      'Cold Steel',
      'Warming',
      'In the Forge',
      'Tempering',
      'Jammed',
      'Quenched',
      'Scrapped',
    ]);
  });

  it('each column total matches the list filtered to that status', async () => {
    const { columns } = await parsedBoard();
    for (const column of columns) {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${f.acmeId}/tickets?statusKey=${column.status.key}&pageSize=1`,
        headers: { cookie: await ctx.cookieFor('owner') },
      });
      const { total } = ticketListSchema.parse(response.json());
      expect(column.total, column.status.key).toBe(total);
      expect(column.tickets.every((t) => t.status.key === column.status.key)).toBe(true);
    }
    const backlog = columns.find((c) => c.status.key === 'backlog')!;
    expect(new Set(backlog.tickets.map((t) => t.project.key)).size).toBeGreaterThan(1);
  });

  it('honours the project filter', async () => {
    const { columns, workflows } = await parsedBoard({ project: 'LST' });
    expect(columns.flatMap((c) => c.tickets).every((t) => t.project.key === 'LST')).toBe(true);
    expect(Object.fromEntries(columns.map((c) => [c.status.key, c.total]))).toEqual({
      backlog: 3,
      open: 3,
      in_progress: 1,
      in_review: 1,
      blocked: 1,
      done: 1,
      cancelled: 1,
    });
    expect(workflows.map((w) => w.projectKey)).toEqual(['LST']);
  });

  it('carries every project’s workflow', async () => {
    const { workflows } = await parsedBoard();
    expect(workflows.map((w) => w.projectKey)).toEqual(['API', 'LST', 'WEB']);
    const lst = workflows.find((w) => w.projectKey === 'LST')!;
    expect(lst.projectId).toBe(projectId);
    expect(lst.archived).toBe(false);
    expect(Object.fromEntries(lst.statuses.map((s) => [s.key, s.id]))).toEqual(statusIds);

    const rows = await ctx.db
      .select({
        fromStatusId: statusTransitions.fromStatusId,
        toStatusId: statusTransitions.toStatusId,
      })
      .from(statusTransitions)
      .where(eq(statusTransitions.projectId, projectId));
    const pairs = (list: { fromStatusId: string; toStatusId: string }[]) =>
      list.map((t) => `${t.fromStatusId}>${t.toStatusId}`).sort();
    expect(pairs(lst.transitions)).toEqual(pairs(rows));
  });

  it('marks an archived project and keeps its tickets on the board', async () => {
    await ctx.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, projectId));
    const { columns, workflows } = await parsedBoard();
    expect(workflows.find((w) => w.projectKey === 'LST')!.archived).toBe(true);
    expect(columns.flatMap((c) => c.tickets).some((t) => t.project.key === 'LST')).toBe(true);
  });

  it('names a column after the first project that has the key', async () => {
    const apiProject = (await parsedBoard()).workflows.find((w) => w.projectKey === 'API')!;
    await ctx.db
      .update(projectStatuses)
      .set({ name: 'Ready' })
      .where(
        and(eq(projectStatuses.projectId, apiProject.projectId), eq(projectStatuses.key, 'open')),
      );
    const name = async (params: Params) =>
      (await parsedBoard(params)).columns.find((c) => c.status.key === 'open')!.status.name;
    expect(await name({})).toBe('Ready');
    expect(await name({ project: 'WEB' })).toBe('Warming');
  });

  it('gives a status only one project has its own column, with only that project’s tickets', async () => {
    const [inReview] = await ctx.db
      .select({ sortOrder: projectStatuses.sortOrder })
      .from(projectStatuses)
      .where(eq(projectStatuses.id, statusIds.in_review!));
    const [qa] = await ctx.db
      .insert(projectStatuses)
      .values({
        organisationId: f.acmeId,
        projectId,
        key: 'qa',
        name: 'QA',
        category: 'in_progress',
        sortOrder: inReview!.sortOrder,
      })
      .returning({ id: projectStatuses.id });
    await ctx.db
      .update(tickets)
      .set({ statusId: qa!.id })
      .where(eq(tickets.id, idByNumber.get(3)!));

    const { columns } = await parsedBoard();
    const keys = columns.map((c) => c.status.key);
    expect(keys.indexOf('qa')).toBe(keys.indexOf('in_review') + 1);
    const column = columns.find((c) => c.status.key === 'qa')!;
    expect(column.status.name).toBe('QA');
    expect(column.tickets.map((t) => t.key)).toEqual(['LST-3']);
    expect(column.total).toBe(1);
  });
});

describe('filtering the workspace board', () => {
  it('ignores status filters and paging', async () => {
    const totals = async (params: Params) =>
      (await parsedBoard({ sort: 'key', dir: 'asc', ...params })).columns.map((c) => c.total);
    const unfiltered = await totals({});
    expect(await totals({ statusKey: 'open' })).toEqual(unfiltered);
    expect(await totals({ statusCategory: 'completed', page: '3', pageSize: '1' })).toEqual(
      unfiltered,
    );
  });

  it('refuses invalid filters with 422', async () => {
    const response = await board({ sort: 'password' });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('validation_failed');
  });
});

describe('workspaces stay apart', () => {
  it('shows Northwind only its own tickets and workflows', async () => {
    const nora = await parsedBoard({}, 'other-owner', f.northwindId);
    expect(nora.workflows.map((w) => w.projectKey)).toEqual(['OPS']);
    expect(nora.columns.flatMap((c) => c.tickets).every((t) => t.key.startsWith('OPS-'))).toBe(
      true,
    );
    expect(nora.columns.reduce((sum, c) => sum + c.total, 0)).toBe(4);
  });
});
