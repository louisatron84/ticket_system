import { projectStatuses, projects, tickets } from '@forge/db';
import { reportsSchema, type Reports } from '@forge/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
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

const org = () => `/api/v1/orgs/${f.acmeId}`;

const reports = async (query = ''): Promise<Reports> => {
  const response = await send('GET', `${org()}/projects/WEB/reports${query}`);
  expect(response.statusCode).toBe(200);
  return reportsSchema.parse(response.json());
};

const make = async (title: string) => {
  const response = await send('POST', `${org()}/projects/WEB/tickets`, 'owner', {
    title,
    typeId: f.typeId('acme', 'task'),
    priorityId: f.priorityId('acme', 'high'),
    statusId: f.statusId('WEB', 'open'),
  });
  expect(response.statusCode).toBe(201);
  return response.json().key as string;
};

const move = async (key: string, statusKey: string) => {
  const { version } = (await ticketRow(ctx.db, key))!;
  const response = await send('PATCH', `${org()}/tickets/${key}`, 'owner', {
    version,
    statusId: f.statusId('WEB', statusKey),
  });
  expect(response.statusCode).toBe(200);
};

describe('project reports', () => {
  it('count a ticket made and finished in the range', async () => {
    const before = await reports();
    const key = await make('Reported');
    await move(key, 'in_progress');
    await move(key, 'done');
    const after = await reports();
    expect(after.createdResolved.at(-1)!.created).toBe(before.createdResolved.at(-1)!.created + 1);
    expect(after.createdResolved.at(-1)!.resolved).toBe(
      before.createdResolved.at(-1)!.resolved + 1,
    );
    expect(after.throughput.at(-1)!.done).toBe(before.throughput.at(-1)!.done + 1);
    expect(after.leadTime.count).toBe(before.leadTime.count + 1);
    expect(after.cycleTime.count).toBe(before.cycleTime.count + 1);
  });

  it('put every counted ticket in one band of the flow today', async () => {
    const key = await make('Flowing');
    await move(key, 'in_progress');
    const result = await reports();
    const [{ count } = { count: 0 }] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets)
      .innerJoin(projects, eq(projects.id, tickets.projectId))
      .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
      .where(
        and(
          eq(projects.key, 'WEB'),
          eq(projects.organisationId, f.acmeId),
          isNull(tickets.archivedAt),
          isNull(tickets.triageState),
          eq(projectStatuses.isCancellation, false),
        ),
      );
    const today = result.flow.at(-1)!;
    expect(today.notStarted + today.inProgress + today.done).toBe(count);
    expect(result.age.oldest.length).toBeLessThanOrEqual(10);
    expect(result.age.statuses.some((status) => status.name === 'In the Forge')).toBe(true);
  });

  it('leave archived tickets out', async () => {
    const before = await reports();
    const key = await make('Archived');
    await ctx.db.update(tickets).set({ archivedAt: new Date() }).where(eq(tickets.key, key));
    expect((await reports()).createdResolved.at(-1)!.created).toBe(
      before.createdResolved.at(-1)!.created,
    );
  });

  it('cover 30 or 90 days and refuse other ranges', async () => {
    expect((await reports()).flow).toHaveLength(30);
    const long = await reports('?days=90');
    expect(long.flow).toHaveLength(90);
    expect(long.flow.at(-1)!.date).toBe(new Date().toISOString().slice(0, 10));
    expect((await send('GET', `${org()}/projects/WEB/reports?days=7`)).statusCode).toBe(422);
  });

  it('show the running cycle and the velocity of completed ones when cycles are on', async () => {
    expect((await reports()).cycles).toBeNull();
    await ctx.db.update(projects).set({ cyclesEnabled: true }).where(eq(projects.key, 'WEB'));
    const cycles = `${org()}/projects/WEB/cycles`;
    const first = (await send('POST', cycles, 'owner', {})).json().cycles[0].id as string;
    const key = await make('In the cycle');
    const { version } = (await ticketRow(ctx.db, key))!;
    await send('PATCH', `${org()}/tickets/${key}`, 'owner', { version, cycleId: first });
    await send('POST', `${cycles}/${first}/start`);
    const running = await reports();
    expect(running.cycles!.active).toMatchObject({ id: first, name: 'Cycle 1' });
    expect(running.cycles!.active!.days[0]).toMatchObject({ scopeTickets: 1 });
    expect(running.cycles!.velocity).toEqual([]);

    await send('POST', `${cycles}/${first}/complete`, 'owner', { unfinished: 'backlog' });
    const done = await reports();
    expect(done.cycles!.active).toBeNull();
    expect(done.cycles!.velocity).toEqual([
      { name: 'Cycle 1', plannedTickets: 1, doneTickets: 0, plannedEstimate: 0, doneEstimate: 0 },
    ]);
  });

  it.each([
    ['readonly', 200],
    ['restricted', 403],
    ['other-owner', 404],
  ] as const)('%s may see them: %i', async (identity, expected) => {
    expect((await send('GET', `${org()}/projects/WEB/reports`, identity)).statusCode).toBe(
      expected,
    );
  });

  it('are not found for an unknown project', async () => {
    expect((await send('GET', `${org()}/projects/NOPE/reports`)).statusCode).toBe(404);
  });
});
