import { auditEvents, projects, tickets } from '@forge/db';
import { milestoneListSchema, type MilestoneList } from '@forge/shared';
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

const url = (projectKey = 'WEB', rest = '', orgId = f.acmeId) =>
  `/api/v1/orgs/${orgId}/projects/${projectKey}/milestones${rest}`;

const create = async (payload: object, projectKey = 'WEB'): Promise<MilestoneList> => {
  const response = await send('POST', url(projectKey), 'owner', payload);
  expect(response.statusCode).toBe(201);
  return milestoneListSchema.parse(response.json());
};
const made = async (name: string, extra: object = {}, projectKey = 'WEB') =>
  (await create({ name, ...extra }, projectKey)).milestones.find((m) => m.name === name)!;

const list = async (projectKey = 'WEB'): Promise<MilestoneList> => {
  const response = await send('GET', url(projectKey));
  expect(response.statusCode).toBe(200);
  return milestoneListSchema.parse(response.json());
};

const editTicket = async (key: string, changes: object, as = 'owner') => {
  const { version } = (await ticketRow(ctx.db, key))!;
  return send('PATCH', `/api/v1/orgs/${f.acmeId}/tickets/${key}`, as, { version, ...changes });
};

describe('milestones of a project', () => {
  it('are created, listed open-first by target date, and audited', async () => {
    await made('Later', { targetDate: '2031-06-01' });
    await made('Undated');
    await made('Sooner', { targetDate: '2031-01-15', health: 'at_risk', description: 'Beta' });
    const result = await list();
    expect(result.estimation).toBe('time');
    expect(result.milestones.map((m) => m.name)).toEqual(['Sooner', 'Later', 'Undated']);
    expect(result.milestones[0]).toMatchObject({
      health: 'at_risk',
      description: 'Beta',
      closed: false,
      tickets: { done: 0, total: 0 },
    });
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(like(auditEvents.action, 'milestone.%'));
    expect(audits).toHaveLength(3);
  });

  it('refuses a second milestone of the same name, in any case', async () => {
    await made('Beta');
    const response = await send('POST', url(), 'owner', { name: 'beta' });
    expect(response.statusCode).toBe(409);
  });

  it('allows the same name in another project', async () => {
    await made('Beta');
    await made('Beta', {}, 'API');
    expect((await list('API')).milestones).toHaveLength(1);
  });

  it('refuses bad input', async () => {
    expect((await send('POST', url(), 'owner', { name: '' })).statusCode).toBe(422);
    expect(
      (await send('POST', url(), 'owner', { name: 'X', targetDate: '2031-02-30' })).statusCode,
    ).toBe(422);
    expect((await send('POST', url(), 'owner', { name: 'X', health: 'great' })).statusCode).toBe(
      422,
    );
  });

  it('is edited, closed and reopened', async () => {
    const beta = await made('Beta');
    const response = await send('PATCH', url('WEB', `/${beta.id}`), 'owner', {
      name: 'Beta 1',
      health: 'off_track',
      targetDate: '2031-03-01',
      closed: true,
    });
    expect(response.statusCode).toBe(200);
    const after = milestoneListSchema.parse(response.json()).milestones[0]!;
    expect(after).toMatchObject({
      name: 'Beta 1',
      health: 'off_track',
      targetDate: '2031-03-01',
      closed: true,
    });
    const reopened = await send('PATCH', url('WEB', `/${beta.id}`), 'owner', { closed: false });
    expect(milestoneListSchema.parse(reopened.json()).milestones[0]!.closed).toBe(false);
  });

  it('cannot be reached through another project or workspace', async () => {
    const beta = await made('Beta');
    expect(
      (await send('PATCH', url('API', `/${beta.id}`), 'owner', { name: 'X' })).statusCode,
    ).toBe(404);
    expect((await send('DELETE', url('API', `/${beta.id}`))).statusCode).toBe(404);
    expect((await send('GET', url('WEB', '', f.northwindId))).statusCode).toBe(404);
  });

  it.each([
    ['developer', 201],
    ['reporter', 403],
    ['readonly', 403],
    ['other-owner', 404],
  ] as const)('%s may create one: %i', async (identity, expected) => {
    expect((await send('POST', url(), identity, { name: 'Beta' })).statusCode).toBe(expected);
  });

  it.each([
    ['readonly', 200],
    ['restricted', 403],
  ] as const)('%s may list them: %i', async (identity, expected) => {
    expect((await send('GET', url(), identity)).statusCode).toBe(expected);
  });

  it('is frozen in an archived project', async () => {
    const beta = await made('Beta');
    await ctx.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.key, 'WEB'));
    expect((await send('POST', url(), 'owner', { name: 'Gamma' })).statusCode).toBe(409);
    expect(
      (await send('PATCH', url('WEB', `/${beta.id}`), 'owner', { name: 'X' })).statusCode,
    ).toBe(409);
    expect((await list()).archived).toBe(true);
  });
});

describe('tickets in a milestone', () => {
  it('counts progress by tickets and by estimate, leaving out scrapped and archived', async () => {
    const beta = await made('Beta');
    for (const key of ['WEB-2', 'WEB-3', 'WEB-4']) {
      expect(
        (await editTicket(key, { milestoneId: beta.id, estimateMinutes: 60 })).statusCode,
      ).toBe(200);
    }
    // Straight to done, whatever the workflow allows from where it is.
    await ctx.db
      .update(tickets)
      .set({ statusId: f.statusId('WEB', 'done'), completedAt: new Date() })
      .where(eq(tickets.key, 'WEB-2'));
    const progress = (await list()).milestones[0]!;
    expect(progress.tickets).toEqual({ done: 1, total: 3 });
    expect(progress.estimate).toEqual({ done: 60, total: 180 });

    expect((await send('POST', `/api/v1/orgs/${f.acmeId}/tickets/WEB-4/archive`)).statusCode).toBe(
      200,
    );
    expect((await list()).milestones[0]!.tickets).toEqual({ done: 1, total: 2 });

    await ctx.db
      .update(tickets)
      .set({ statusId: f.statusId('WEB', 'cancelled'), completedAt: new Date() })
      .where(eq(tickets.key, 'WEB-3'));
    expect((await list()).milestones[0]!.tickets).toEqual({ done: 1, total: 1 });
  });

  it('shows on the ticket and in its history', async () => {
    const beta = await made('Beta');
    const response = await editTicket('WEB-2', { milestoneId: beta.id });
    expect(response.statusCode).toBe(200);
    expect(response.json().milestone).toEqual({ id: beta.id, name: 'Beta', closed: false });
    const timeline = await send('GET', `/api/v1/orgs/${f.acmeId}/tickets/WEB-2/timeline`);
    expect(JSON.stringify(timeline.json())).toContain('"field":"milestone"');
  });

  it('refuses a milestone of another project, and a closed one', async () => {
    const other = await made('Other', {}, 'API');
    expect((await editTicket('WEB-2', { milestoneId: other.id })).statusCode).toBe(422);
    const beta = await made('Beta');
    await send('PATCH', url('WEB', `/${beta.id}`), 'owner', { closed: true });
    const refused = await editTicket('WEB-2', { milestoneId: beta.id });
    expect(refused.statusCode).toBe(422);
    expect(JSON.stringify(refused.json())).toContain('is closed');
  });

  it('is set when a ticket is created', async () => {
    const beta = await made('Beta');
    const response = await send('POST', `/api/v1/orgs/${f.acmeId}/projects/WEB/tickets`, 'owner', {
      title: 'In the beta',
      typeId: f.typeId('acme', 'task'),
      priorityId: f.priorityId('acme', 'high'),
      milestoneId: beta.id,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().milestone.name).toBe('Beta');
  });

  it('filters the ticket list by milestone, or by none', async () => {
    const beta = await made('Beta');
    await editTicket('WEB-2', { milestoneId: beta.id });
    const inBeta = await send(
      'GET',
      `/api/v1/orgs/${f.acmeId}/tickets?project=WEB&milestone=${beta.id}`,
    );
    expect(inBeta.json().items.map((t: { key: string }) => t.key)).toEqual(['WEB-2']);
    const none = await send('GET', `/api/v1/orgs/${f.acmeId}/tickets?project=WEB&milestone=none`);
    expect(none.json().items.map((t: { key: string }) => t.key)).not.toContain('WEB-2');
  });

  it('can only be deleted while no ticket is in it', async () => {
    const beta = await made('Beta');
    await editTicket('WEB-2', { milestoneId: beta.id });
    const refused = await send('DELETE', url('WEB', `/${beta.id}`));
    expect(refused.statusCode).toBe(409);
    await editTicket('WEB-2', { milestoneId: null });
    const deleted = await send('DELETE', url('WEB', `/${beta.id}`));
    expect(deleted.statusCode).toBe(200);
    expect(milestoneListSchema.parse(deleted.json()).milestones).toHaveLength(0);
  });

  it('a duplicate keeps an open milestone and drops a closed one', async () => {
    const beta = await made('Beta');
    await editTicket('WEB-2', { milestoneId: beta.id });
    const open = await send('POST', `/api/v1/orgs/${f.acmeId}/tickets/WEB-2/duplicate`);
    expect(open.json().milestone?.name).toBe('Beta');
    await send('PATCH', url('WEB', `/${beta.id}`), 'owner', { closed: true });
    const closed = await send('POST', `/api/v1/orgs/${f.acmeId}/tickets/WEB-2/duplicate`);
    expect(closed.json().milestone).toBeNull();
  });
});
