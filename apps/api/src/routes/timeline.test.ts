import { tickets } from '@forge/db';
import { timelineSchema, type Timeline } from '@forge/shared';
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

const org = () => `/api/v1/orgs/${f.acmeId}`;

const epic = async (title: string, dates: { startDate?: string; dueDate?: string } = {}) => {
  const response = await send('POST', `${org()}/projects/WEB/tickets`, 'owner', {
    title,
    typeId: f.typeId('acme', 'epic'),
    priorityId: f.priorityId('acme', 'high'),
    ...dates,
  });
  expect(response.statusCode).toBe(201);
  return response.json().key as string;
};

const timeline = async (as = 'owner'): Promise<Timeline> => {
  const response = await send('GET', `${org()}/projects/WEB/timeline`, as);
  expect(response.statusCode).toBe(200);
  return timelineSchema.parse(response.json());
};

const edit = async (key: string, changes: object) => {
  const { version } = (await ticketRow(ctx.db, key))!;
  return send('PATCH', `${org()}/tickets/${key}`, 'owner', { version, ...changes });
};

describe('the start date', () => {
  it('is set, shown and recorded in history', async () => {
    const response = await edit('WEB-2', { dueDate: null, startDate: '2031-01-05' });
    expect(response.statusCode).toBe(200);
    expect(response.json().startDate).toBe('2031-01-05');
    const history = await send('GET', `${org()}/tickets/WEB-2/timeline`);
    expect(JSON.stringify(history.json())).toContain('"field":"startDate"');
  });

  it('must not come after the due date, whichever is changed', async () => {
    await edit('WEB-2', { dueDate: '2031-01-10', startDate: null });
    const late = await edit('WEB-2', { startDate: '2031-01-11' });
    expect(late.statusCode).toBe(422);
    expect(JSON.stringify(late.json())).toContain('on or before the due date');
    expect((await edit('WEB-2', { startDate: '2031-01-10' })).statusCode).toBe(200);
    expect((await edit('WEB-2', { dueDate: '2031-01-09' })).statusCode).toBe(422);
    expect((await edit('WEB-2', { dueDate: null })).statusCode).toBe(200);
  });

  it('is checked when a ticket is created', async () => {
    const response = await send('POST', `${org()}/projects/WEB/tickets`, 'owner', {
      title: 'Backwards',
      typeId: f.typeId('acme', 'task'),
      priorityId: f.priorityId('acme', 'high'),
      startDate: '2031-02-01',
      dueDate: '2031-01-01',
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('the timeline', () => {
  it('lists epics with their dates, earliest start first and undated last', async () => {
    const before = (await timeline()).epics.length;
    const late = await epic('Late epic', { startDate: '2031-06-01', dueDate: '2031-07-01' });
    const early = await epic('Early epic', { startDate: '2031-01-01', dueDate: '2031-02-01' });
    const result = await timeline();
    expect(result.epics).toHaveLength(before + 2);
    const keys = result.epics.map((item) => item.key);
    expect(keys.indexOf(early)).toBeLessThan(keys.indexOf(late));
    expect(result.epics.find((item) => item.key === early)).toMatchObject({
      title: 'Early epic',
      startDate: '2031-01-01',
      dueDate: '2031-02-01',
      status: { category: 'not_started' },
    });
    // Only epics: no task shows.
    expect(result.epics.every((item) => item.key !== 'WEB-2')).toBe(true);
  });

  it('leaves out archived epics', async () => {
    const key = await epic('Gone');
    await ctx.db.update(tickets).set({ archivedAt: new Date() }).where(eq(tickets.key, key));
    expect((await timeline()).epics.map((item) => item.key)).not.toContain(key);
  });

  it('shows blocked-by links between epics as dependencies', async () => {
    const first = await epic('First');
    const second = await epic('Second');
    const linked = await send('POST', `${org()}/tickets/${first}/links`, 'owner', {
      choice: 'blocks',
      otherKey: second,
    });
    expect(linked.statusCode).toBe(201);
    expect((await timeline()).dependencies).toContainEqual({ blocker: first, blocked: second });
  });

  it('includes the project’s milestones', async () => {
    await send('POST', `${org()}/projects/WEB/milestones`, 'owner', {
      name: 'Beta',
      targetDate: '2031-03-01',
    });
    expect((await timeline()).milestones).toMatchObject([
      { name: 'Beta', targetDate: '2031-03-01', health: 'on_track', closed: false },
    ]);
  });

  it.each([
    ['readonly', 200],
    ['restricted', 403],
    ['other-owner', 404],
  ] as const)('%s may see it: %i', async (identity, expected) => {
    expect((await send('GET', `${org()}/projects/WEB/timeline`, identity)).statusCode).toBe(
      expected,
    );
  });
});
