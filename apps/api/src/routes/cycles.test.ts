import { auditEvents, cycleScopeChanges, projects, tickets } from '@forge/db';
import {
  addDays,
  burndownSchema,
  cycleListSchema,
  type Cycle,
  type CycleList,
} from '@forge/shared';
import { eq, like } from 'drizzle-orm';
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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

const url = (rest = '', projectKey = 'WEB', orgId = f.acmeId) =>
  `/api/v1/orgs/${orgId}/projects/${projectKey}/cycles${rest}`;
const today = () => new Date().toISOString().slice(0, 10);

const switchOn = (projectKey = 'WEB') =>
  ctx.db.update(projects).set({ cyclesEnabled: true }).where(eq(projects.key, projectKey));

const parsed = async (response: Awaited<ReturnType<typeof send>>, status = 200) => {
  expect(response.statusCode).toBe(status);
  return cycleListSchema.parse(response.json());
};
const create = async (payload: object = {}): Promise<CycleList> =>
  parsed(await send('POST', url(), 'owner', payload), 201);
const list = async () => parsed(await send('GET', url()));
const byName = (result: CycleList, name: string) => result.cycles.find((c) => c.name === name)!;

const editTicket = async (key: string, changes: object, as = 'owner') => {
  const { version } = (await ticketRow(ctx.db, key))!;
  return send('PATCH', `/api/v1/orgs/${f.acmeId}/tickets/${key}`, as, { version, ...changes });
};
const finish = (key: string) =>
  ctx.db
    .update(tickets)
    .set({ statusId: f.statusId('WEB', 'done'), completedAt: new Date() })
    .where(eq(tickets.key, key));

describe('switching cycles on', () => {
  it('is a project setting for project managers, with a length of 7 to 28 days', async () => {
    const response = await send('PATCH', `/api/v1/orgs/${f.acmeId}/projects/WEB`, 'admin', {
      cyclesEnabled: true,
      cycleLengthDays: 7,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ cyclesEnabled: true, cycleLengthDays: 7 });
    expect(
      (
        await send('PATCH', `/api/v1/orgs/${f.acmeId}/projects/WEB`, 'admin', {
          cycleLengthDays: 30,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await send('PATCH', `/api/v1/orgs/${f.acmeId}/projects/WEB`, 'developer', {
          cyclesEnabled: true,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('refuses new cycles while cycles are off', async () => {
    const response = await send('POST', url(), 'owner', {});
    expect(response.statusCode).toBe(409);
    expect((await list()).enabled).toBe(false);
  });

  it('cannot be switched off while a cycle runs', async () => {
    await switchOn();
    const made = await create();
    await send('POST', url(`/${made.cycles[0]!.id}/start`));
    const response = await send('PATCH', `/api/v1/orgs/${f.acmeId}/projects/WEB`, 'owner', {
      cyclesEnabled: false,
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('planning cycles', () => {
  beforeEach(async () => {
    await switchOn();
  });

  it('numbers and dates new cycles one after another', async () => {
    await create();
    const result = await create({ capacity: 20 });
    const [first, second] = result.cycles as [Cycle, Cycle];
    expect(first).toMatchObject({
      number: 1,
      name: 'Cycle 1',
      state: 'planned',
      startsOn: today(),
      endsOn: addDays(today(), 13),
    });
    expect(second).toMatchObject({
      number: 2,
      name: 'Cycle 2',
      startsOn: addDays(today(), 14),
      capacity: 20,
    });
  });

  it('takes a name and dates, and refuses a cycle that ends before it starts', async () => {
    const result = await create({ name: 'Launch', startsOn: '2031-01-05', endsOn: '2031-01-16' });
    expect(byName(result, 'Launch')).toMatchObject({
      startsOn: '2031-01-05',
      endsOn: '2031-01-16',
    });
    expect(
      (await send('POST', url(), 'owner', { startsOn: '2031-01-05', endsOn: '2031-01-04' }))
        .statusCode,
    ).toBe(422);
    const id = byName(result, 'Launch').id;
    expect((await send('PATCH', url(`/${id}`), 'owner', { endsOn: '2031-01-01' })).statusCode).toBe(
      422,
    );
    const renamed = await parsed(await send('PATCH', url(`/${id}`), 'owner', { name: 'Go live' }));
    expect(renamed.cycles[0]!.name).toBe('Go live');
  });

  it('runs a cycle for at most a year, made or changed', async () => {
    const tooLong = await send('POST', url(), 'owner', {
      startsOn: '2031-01-01',
      endsOn: '2032-01-01',
    });
    expect(tooLong.statusCode).toBe(422);
    expect(tooLong.json().error.details).toEqual([
      { path: 'endsOn', message: 'A cycle can run for at most 365 days.' },
    ]);
    const ancient = await send('POST', url(), 'owner', {
      startsOn: '0001-01-01',
      endsOn: '9999-12-31',
    });
    expect(ancient.statusCode).toBe(422);
    const result = await create({ name: 'Year', startsOn: '2031-01-01', endsOn: '2031-12-31' });
    const id = byName(result, 'Year').id;
    expect((await send('PATCH', url(`/${id}`), 'owner', { endsOn: '2032-06-01' })).statusCode).toBe(
      422,
    );
  });

  it('starts one cycle at a time, recording what was planned', async () => {
    await create();
    const [first, second] = (await create()).cycles as [Cycle, Cycle];
    await editTicket('WEB-2', { cycleId: first.id, estimateMinutes: 60 });
    await editTicket('WEB-3', { cycleId: first.id });
    const started = await parsed(await send('POST', url(`/${first.id}/start`)));
    expect(started.cycles[0]).toMatchObject({
      id: first.id,
      state: 'active',
      planned: { tickets: 2, estimate: 60 },
    });
    expect((await send('POST', url(`/${second.id}/start`))).statusCode).toBe(409);
    expect((await send('POST', url(`/${first.id}/start`))).statusCode).toBe(409);
  });

  it('deletes only a planned cycle with no tickets', async () => {
    const result = await create();
    const id = result.cycles[0]!.id;
    await editTicket('WEB-2', { cycleId: id });
    expect((await send('DELETE', url(`/${id}`))).statusCode).toBe(409);
    await editTicket('WEB-2', { cycleId: null });
    expect((await parsed(await send('DELETE', url(`/${id}`)))).cycles).toHaveLength(0);
  });

  it.each([
    ['developer', 201],
    ['reporter', 403],
    ['readonly', 403],
    ['other-owner', 404],
  ] as const)('%s may plan one: %i', async (identity, expected) => {
    expect((await send('POST', url(), identity, {})).statusCode).toBe(expected);
  });

  it('cannot be reached from another project', async () => {
    const result = await create();
    await switchOn('API');
    const id = result.cycles[0]!.id;
    expect((await send('POST', url(`/${id}/start`, 'API'))).statusCode).toBe(404);
    expect((await send('GET', url(`/${id}/burndown`, 'API'))).statusCode).toBe(404);
  });

  it('is audited', async () => {
    const result = await create();
    await send('POST', url(`/${result.cycles[0]!.id}/start`));
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(like(auditEvents.action, 'cycle.%'));
    expect(audits.map((a) => a.action)).toEqual(['cycle.created', 'cycle.started']);
  });
});

describe('tickets in a cycle', () => {
  beforeEach(async () => {
    await switchOn();
  });

  it('shows on the ticket, in its history, in the backlog and in the list filter', async () => {
    const id = (await create()).cycles[0]!.id;
    const response = await editTicket('WEB-2', { cycleId: id });
    expect(response.statusCode).toBe(200);
    expect(response.json().cycle).toEqual({ id, name: 'Cycle 1', state: 'planned' });
    const timeline = await send('GET', `/api/v1/orgs/${f.acmeId}/tickets/WEB-2/timeline`);
    expect(JSON.stringify(timeline.json())).toContain('"field":"cycle"');

    const backlog = await send('GET', `/api/v1/orgs/${f.acmeId}/projects/WEB/backlog`);
    expect(backlog.json().cycles).toEqual([{ id, name: 'Cycle 1', state: 'planned' }]);
    const row = backlog.json().items.find((item: { key: string }) => item.key === 'WEB-2');
    expect(row.cycleId).toBe(id);

    const filtered = await send('GET', `/api/v1/orgs/${f.acmeId}/tickets?cycle=${id}`);
    expect(filtered.json().items.map((t: { key: string }) => t.key)).toEqual(['WEB-2']);
  });

  it('refuses a cycle of another project, and a completed one', async () => {
    await switchOn('API');
    const other = (await parsed(await send('POST', url('', 'API'), 'owner', {}), 201)).cycles[0]!;
    expect((await editTicket('WEB-2', { cycleId: other.id })).statusCode).toBe(422);
    const id = (await create()).cycles[0]!.id;
    await send('POST', url(`/${id}/start`));
    await send('POST', url(`/${id}/complete`), 'owner', { unfinished: 'backlog' });
    expect((await editTicket('WEB-2', { cycleId: id })).statusCode).toBe(422);
  });

  it('logs every join and leave', async () => {
    const [a, b] = (await create(), await create()).cycles;
    await editTicket('WEB-2', { cycleId: a!.id });
    await editTicket('WEB-2', { cycleId: b!.id });
    await editTicket('WEB-2', { cycleId: null });
    const log = await ctx.db.select().from(cycleScopeChanges);
    expect(log.map((row) => [row.cycleId === a!.id ? 'a' : 'b', row.change])).toEqual([
      ['a', 'added'],
      ['a', 'removed'],
      ['b', 'added'],
      ['b', 'removed'],
    ]);
  });
});

describe('completing a cycle', () => {
  beforeEach(async () => {
    await switchOn();
  });

  const running = async () => {
    const id = (await create()).cycles[0]!.id;
    for (const key of ['WEB-2', 'WEB-3', 'WEB-4']) {
      await editTicket(key, { cycleId: id, estimateMinutes: 30 });
    }
    await send('POST', url(`/${id}/start`));
    await finish('WEB-2');
    return id;
  };

  it('moves unfinished work to the next planned cycle, making one if needed', async () => {
    const id = await running();
    const response = await send('POST', url(`/${id}/complete`), 'owner', { unfinished: 'next' });
    const result = await parsed(response);
    const done = result.cycles.find((c) => c.id === id)!;
    expect(done).toMatchObject({
      state: 'completed',
      done: { tickets: 1, estimate: 30 },
      planned: { tickets: 3, estimate: 90 },
    });
    const next = result.cycles.find((c) => c.state === 'planned')!;
    expect(next.number).toBe(2);
    expect(next.startsOn).toBe(addDays(done.endsOn, 1));
    expect(next.tickets).toEqual({ done: 0, total: 2 });
    expect((await ticketRow(ctx.db, 'WEB-2'))!.cycleId).toBe(id);
    expect((await ticketRow(ctx.db, 'WEB-3'))!.cycleId).toBe(next.id);
  });

  it('or sends it back to the backlog', async () => {
    const id = await running();
    const before = (await ticketRow(ctx.db, 'WEB-3'))!.version;
    await parsed(await send('POST', url(`/${id}/complete`), 'owner', { unfinished: 'backlog' }));
    const after = (await ticketRow(ctx.db, 'WEB-3'))!;
    expect(after.cycleId).toBeNull();
    expect(after.version).toBe(before + 1);
    expect((await list()).cycles).toHaveLength(1);
  });

  it('only completes a running cycle', async () => {
    const id = (await create()).cycles[0]!.id;
    expect(
      (await send('POST', url(`/${id}/complete`), 'owner', { unfinished: 'next' })).statusCode,
    ).toBe(409);
  });
});

describe('the burndown', () => {
  beforeEach(async () => {
    await switchOn();
  });

  it('runs from the start to today, counting scope and what is left', async () => {
    const start = addDays(today(), -2);
    const id = (await create({ startsOn: start, endsOn: addDays(start, 9) })).cycles[0]!.id;
    await editTicket('WEB-2', { cycleId: id, estimateMinutes: 60 });
    await editTicket('WEB-3', { cycleId: id, estimateMinutes: 30 });
    // Both joined before the cycle began.
    await ctx.db
      .update(cycleScopeChanges)
      .set({ at: new Date(`${start}T00:00:00Z`) })
      .where(eq(cycleScopeChanges.cycleId, id));
    await send('POST', url(`/${id}/start`));
    await finish('WEB-2');

    const response = await send('GET', url(`/${id}/burndown`));
    expect(response.statusCode).toBe(200);
    const { days } = burndownSchema.parse(response.json());
    expect(days.map((day) => day.date)).toEqual([start, addDays(start, 1), today()]);
    expect(days[0]).toMatchObject({
      scopeTickets: 2,
      remainingTickets: 2,
      scopeEstimate: 90,
      remainingEstimate: 90,
    });
    expect(days.at(-1)).toMatchObject({ remainingTickets: 1, remainingEstimate: 30 });
  });

  it('is empty for a cycle that has not started', async () => {
    const id = (await create()).cycles[0]!.id;
    const response = await send('GET', url(`/${id}/burndown`));
    expect(burndownSchema.parse(response.json()).days).toEqual([]);
  });
});
