import { apiErrorSchema, ticketDetailSchema } from '@forge/shared';
import {
  organisationMemberships,
  projectStatuses,
  projects,
  roles,
  ticketEvents,
  tickets,
  users,
} from '@forge/db';
import { and, eq, sql } from 'drizzle-orm';
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

type Call = { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: object; cookie?: string };
const call = ({ cookie, ...rest }: Call) =>
  ctx.app.inject({ ...rest, headers: cookie ? { cookie } : {} });

const createIn = (projectKey: string, payload: unknown, cookie?: string, orgId = f.acmeId) =>
  call({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/projects/${projectKey}/tickets`,
    payload: payload as object,
    ...(cookie ? { cookie } : {}),
  });
const getTicket = (key: string, cookie?: string, orgId = f.acmeId) =>
  call({
    method: 'GET',
    url: `/api/v1/orgs/${orgId}/tickets/${key}`,
    ...(cookie ? { cookie } : {}),
  });
const patchTicket = (key: string, payload: unknown, cookie?: string, orgId = f.acmeId) =>
  call({
    method: 'PATCH',
    url: `/api/v1/orgs/${orgId}/tickets/${key}`,
    payload: payload as object,
    ...(cookie ? { cookie } : {}),
  });

const validBody = (overrides: Record<string, unknown> = {}) => ({
  title: 'Brand new ticket',
  typeId: f.typeId('acme', 'bug'),
  priorityId: f.priorityId('acme', 'high'),
  ...overrides,
});

const ticketCount = async () =>
  (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(tickets))[0]!.n;
// Looked up live: tickets created during a test are not in the facts loaded before it.
const eventTypes = async (key: string) =>
  (
    await ctx.db
      .select({ type: ticketEvents.type })
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, (await ticketRow(ctx.db, key))!.id))
      .orderBy(ticketEvents.createdAt, ticketEvents.id)
  ).map((e) => e.type);

/** Moves a ticket to a status using its current version, and returns the response. */
async function moveTo(key: string, projectKey: string, statusKey: string, cookie: string) {
  const current = (await ticketRow(ctx.db, key))!;
  return patchTicket(
    key,
    { version: current.version, statusId: f.statusId(projectKey, statusKey) },
    cookie,
  );
}

describe('who may create tickets', () => {
  const matrix: [string, number][] = [
    ['owner', 201],
    ['admin', 201],
    ['developer', 201],
    ['reviewer', 403],
    ['readonly', 403],
    ['restricted', 403],
    ['other-owner', 404],
  ];

  it.each(matrix)('%s gets %i', async (identity, expected) => {
    const response = await createIn('WEB', validBody(), await ctx.cookieFor(identity));
    expect(response.statusCode).toBe(expected);
  });

  it('answers 401 to someone who is not signed in', async () => {
    expect((await createIn('WEB', validBody())).statusCode).toBe(401);
  });

  it('lets the creator reach a project only by a project of the same workspace', async () => {
    const owner = await ctx.cookieFor('owner');
    expect((await createIn('OPS', validBody(), owner)).statusCode).toBe(404);
    expect((await createIn('NOPE', validBody(), owner)).statusCode).toBe(404);
  });
});

describe('who may read a ticket', () => {
  const matrix: [string, number][] = [
    ['owner', 200],
    ['admin', 200],
    ['developer', 200],
    ['reviewer', 200],
    ['readonly', 200],
    ['restricted', 403],
    ['other-owner', 404],
  ];

  it.each(matrix)('%s gets %i for WEB-1', async (identity, expected) => {
    expect((await getTicket('WEB-1', await ctx.cookieFor(identity))).statusCode).toBe(expected);
  });

  it('answers 401 to someone who is not signed in', async () => {
    expect((await getTicket('WEB-1')).statusCode).toBe(401);
  });
});

describe('creating a ticket', () => {
  it('numbers it after the existing ones, starts it in the initial status and credits the reporter', async () => {
    const dev = await ctx.cookieFor('developer');
    const response = await createIn(
      'WEB',
      validBody({ description: 'Steps\nto reproduce', dueDate: '2030-01-31', estimateMinutes: 90 }),
      dev,
    );
    expect(response.statusCode).toBe(201);
    const ticket = ticketDetailSchema.parse(response.json());
    expect(ticket).toMatchObject({
      key: 'WEB-13',
      title: 'Brand new ticket',
      description: 'Steps\nto reproduce',
      version: 1,
      dueDate: '2030-01-31',
      estimateMinutes: 90,
      assignee: null,
      completedAt: null,
      status: { key: 'backlog', category: 'not_started' },
      reporter: { email: 'developer@acme.test' },
      project: { key: 'WEB' },
    });
    expect(ticket.allowedTransitions.map((s) => s.key).sort()).toEqual(['cancelled', 'open']);

    const second = ticketDetailSchema.parse((await createIn('WEB', validBody(), dev)).json());
    expect(second.key).toBe('WEB-14');
    expect(await eventTypes('WEB-13')).toEqual(['ticket.created']);
  });

  it('accepts an assignee, a component and labels from the same workspace and project', async () => {
    const response = await createIn(
      'WEB',
      validBody({
        assigneeId: f.userId('reviewer'),
        componentId: f.componentId('WEB', 'Frontend'),
        labelIds: [f.labelId('acme', 'bug'), f.labelId('acme', 'frontend')],
      }),
      await ctx.cookieFor('admin'),
    );
    expect(response.statusCode).toBe(201);
    const ticket = ticketDetailSchema.parse(response.json());
    expect(ticket.assignee?.email).toBe('reviewer@acme.test');
    expect(ticket.component?.name).toBe('Frontend');
    expect(ticket.labels.map((l) => l.name).sort()).toEqual(['bug', 'frontend']);
  });

  describe('refuses ids that belong somewhere else, and writes nothing', () => {
    const unknown = '01a1656b-1a49-7146-94ac-1c72df43ddb4';
    const cases: [string, string, (f: Facts) => Record<string, unknown>][] = [
      [
        'a type from another workspace',
        'typeId',
        (x) => ({ typeId: x.typeId('northwind', 'bug') }),
      ],
      ['an unknown type', 'typeId', () => ({ typeId: unknown })],
      [
        'a priority from another workspace',
        'priorityId',
        (x) => ({ priorityId: x.priorityId('northwind', 'high') }),
      ],
      ['an unknown priority', 'priorityId', () => ({ priorityId: unknown })],
      [
        'an assignee who is not a member',
        'assigneeId',
        (x) => ({ assigneeId: x.userId('other-owner') }),
      ],
      ['an unknown assignee', 'assigneeId', () => ({ assigneeId: unknown })],
      [
        'a label from another workspace',
        'labelIds',
        (x) => ({ labelIds: [x.labelId('northwind', 'bug')] }),
      ],
      ['an unknown label', 'labelIds', () => ({ labelIds: [unknown] })],
      [
        'a component of another project',
        'componentId',
        (x) => ({ componentId: x.componentId('API', 'Gateway') }),
      ],
    ];

    it.each(cases)('%s', async (_label, field, build) => {
      const before = await ticketCount();
      const response = await createIn('WEB', validBody(build(f)), await ctx.cookieFor('owner'));
      expect(response.statusCode).toBe(422);
      const error = apiErrorSchema.parse(response.json()).error;
      expect(error.code).toBe('validation_failed');
      expect(error.details?.map((d) => d.path)).toContain(field);
      expect(await ticketCount()).toBe(before);
      const [project] = await ctx.db.select().from(projects).where(eq(projects.key, 'WEB'));
      expect(project?.nextTicketNumber).toBe(13);
    });

    it('reports every bad id at once', async () => {
      const response = await createIn(
        'WEB',
        validBody({
          typeId: f.typeId('northwind', 'bug'),
          priorityId: f.priorityId('northwind', 'high'),
          assigneeId: f.userId('other-owner'),
        }),
        await ctx.cookieFor('owner'),
      );
      expect(response.statusCode).toBe(422);
      expect(
        response
          .json()
          .error.details.map((d: { path: string }) => d.path)
          .sort(),
      ).toEqual(['assigneeId', 'priorityId', 'typeId']);
    });
  });

  describe('in a status of the caller’s choosing', () => {
    it('creates a ticket in the status asked for', async () => {
      const response = await createIn(
        'WEB',
        validBody({ statusId: f.statusId('WEB', 'in_review') }),
        await ctx.cookieFor('developer'),
      );
      expect(response.statusCode, response.body).toBe(201);
      const ticket = ticketDetailSchema.parse(response.json());
      expect(ticket.status).toMatchObject({ key: 'in_review', name: 'Tempering' });
      expect(ticket.completedAt).toBeNull();
      expect(await eventTypes(ticket.key)).toEqual(['ticket.created']);
    });

    it('stamps completion when the status is a finished one', async () => {
      const response = await createIn(
        'WEB',
        validBody({ statusId: f.statusId('WEB', 'done') }),
        await ctx.cookieFor('owner'),
      );
      expect(response.statusCode, response.body).toBe(201);
      const ticket = ticketDetailSchema.parse(response.json());
      expect(ticket.status.key).toBe('done');
      expect(ticket.completedAt).not.toBeNull();
    });

    it('starts in the initial status without one', async () => {
      const response = await createIn('WEB', validBody(), await ctx.cookieFor('owner'));
      expect(ticketDetailSchema.parse(response.json()).status.key).toBe('backlog');
    });

    it('refuses a status of another project or an inactive one, and writes nothing', async () => {
      await ctx.db
        .update(projectStatuses)
        .set({ isActive: false })
        .where(eq(projectStatuses.id, f.statusId('WEB', 'blocked')));
      const before = await ticketCount();
      const owner = await ctx.cookieFor('owner');
      for (const statusId of [
        f.statusId('API', 'open'),
        f.statusId('WEB', 'blocked'),
        '01a1656b-1a49-7146-94ac-1c72df43ddb4',
      ]) {
        const response = await createIn('WEB', validBody({ statusId }), owner);
        expect(response.statusCode, statusId).toBe(422);
        const error = apiErrorSchema.parse(response.json()).error;
        expect(error.details?.map((d) => d.path)).toEqual(['statusId']);
      }
      expect(await ticketCount()).toBe(before);
      const [project] = await ctx.db.select().from(projects).where(eq(projects.key, 'WEB'));
      expect(project?.nextTicketNumber).toBe(13);
    });

    it('still needs tickets.create', async () => {
      const response = await createIn(
        'WEB',
        validBody({ statusId: f.statusId('WEB', 'open') }),
        await ctx.cookieFor('reviewer'),
      );
      expect(response.statusCode).toBe(403);
    });
  });

  it('refuses to put tickets in an archived project', async () => {
    await ctx.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.key, 'WEB'));
    const response = await createIn('WEB', validBody(), await ctx.cookieFor('owner'));
    expect(response.statusCode).toBe(409);
    expect(await ticketCount()).toBe(24);
  });

  it('needs tickets.assign to assign at creation, but not to leave it unassigned', async () => {
    const [custom] = await ctx.db
      .insert(roles)
      .values({
        organisationId: f.acmeId,
        key: 'no-assign',
        name: 'No assign',
        permissions: ['workspace.view', 'tickets.view', 'tickets.create', 'tickets.edit'],
        isSystem: false,
      })
      .returning();
    await ctx.db
      .update(organisationMemberships)
      .set({ roleId: custom!.id })
      .where(
        and(
          eq(organisationMemberships.organisationId, f.acmeId),
          eq(organisationMemberships.userId, f.userId('developer')),
        ),
      );
    const dev = await ctx.cookieFor('developer');

    expect(
      (await createIn('WEB', validBody({ assigneeId: f.userId('reviewer') }), dev)).statusCode,
    ).toBe(403);
    expect((await createIn('WEB', validBody(), dev)).statusCode).toBe(201);
    // Editing other fields still works; changing the assignee does not.
    expect((await patchTicket('WEB-1', { version: 1, title: 'Renamed' }, dev)).statusCode).toBe(
      200,
    );
    expect(
      (await patchTicket('WEB-1', { version: 2, assigneeId: f.userId('reviewer') }, dev))
        .statusCode,
    ).toBe(403);
  });
});

describe('text that tries to be something else', () => {
  it('stores and returns markup exactly as typed', async () => {
    const title = '<img src=x onerror=alert(1)>';
    const description = '<script>alert("x")</script>\n&lt;b&gt;';
    const response = await createIn(
      'WEB',
      validBody({ title, description }),
      await ctx.cookieFor('owner'),
    );
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ title, description });
    const again = await getTicket('WEB-13', await ctx.cookieFor('readonly'));
    expect(again.json()).toMatchObject({ title, description });
  });

  it('round-trips emoji and right-to-left text', async () => {
    const title = 'مرحبا 👋 العالم — naïve café';
    const response = await createIn('WEB', validBody({ title }), await ctx.cookieFor('owner'));
    expect(response.json().title).toBe(title);
  });

  it.each([
    ['a 201-character title', { title: 'x'.repeat(201) }],
    ['a blank title', { title: '   ' }],
    ['a title with a bell character', { title: 'a\u0007b' }],
    ['a title with NUL', { title: 'a\u0000b' }],
    ['a title with a line break', { title: 'one\ntwo' }],
    ['a 20,001-character description', { description: 'y'.repeat(20_001) }],
    ['a description with NUL', { description: 'a\u0000b' }],
  ])('refuses %s with 422', async (_label, change) => {
    const before = await ticketCount();
    const response = await createIn('WEB', validBody(change), await ctx.cookieFor('owner'));
    expect(response.statusCode).toBe(422);
    expect(await ticketCount()).toBe(before);
  });

  it('accepts the longest allowed title and description', async () => {
    const response = await createIn(
      'WEB',
      validBody({ title: 'x'.repeat(200), description: 'y'.repeat(20_000) }),
      await ctx.cookieFor('owner'),
    );
    expect(response.statusCode).toBe(201);
  });
});

describe('ticket keys in the address', () => {
  it('finds a ticket whatever the letter case', async () => {
    const owner = await ctx.cookieFor('owner');
    for (const key of ['WEB-1', 'web-1', 'Web-1']) {
      const response = await getTicket(key, owner);
      expect(response.statusCode, key).toBe(200);
      expect(response.json().key).toBe('WEB-1');
    }
  });

  it.each([
    'WEB-0',
    'WEB-012',
    'WEB-99999999999',
    'WEB-',
    'WEB',
    '-1',
    '..%2Fx',
    'WEB-1%00',
    'WEB%201',
    'WEB-13',
    'API-99',
  ])('answers 404, not 500, for %j', async (key) => {
    const response = await getTicket(key, await ctx.cookieFor('owner'));
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('not_found');
  });

  it('does not tell another workspace’s ticket from a missing one', async () => {
    const nora = await ctx.cookieFor('other-owner');
    const foreign = await getTicket('WEB-1', nora, f.northwindId);
    const missing = await getTicket('WEB-9999', nora, f.northwindId);
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    const strip = (r: { json(): { error: Record<string, unknown> } }) => {
      const { requestId: _id, ...rest } = r.json().error;
      return rest;
    };
    expect(strip(foreign)).toEqual(strip(missing));

    // Her own workspace's keys do not work through Acme's url either.
    expect((await getTicket('OPS-1', await ctx.cookieFor('owner'))).statusCode).toBe(404);
    expect((await getTicket('OPS-1', nora, f.northwindId)).statusCode).toBe(200);
  });
});

describe('editing a ticket', () => {
  it('applies several changes at once, bumps the version and records one update event', async () => {
    const dev = await ctx.cookieFor('developer');
    const response = await patchTicket(
      'WEB-4',
      {
        version: 1,
        title: 'Update the README with install steps',
        priorityId: f.priorityId('acme', 'high'),
        dueDate: '2031-05-01',
        estimateMinutes: 120,
      },
      dev,
    );
    expect(response.statusCode).toBe(200);
    expect(ticketDetailSchema.parse(response.json())).toMatchObject({
      version: 2,
      title: 'Update the README with install steps',
      priority: { key: 'high' },
      dueDate: '2031-05-01',
      estimateMinutes: 120,
    });
    expect(await eventTypes('WEB-4')).toEqual(['ticket.created', 'ticket.updated']);
  });

  it('can clear the assignee, due date, component and estimate with null', async () => {
    const owner = await ctx.cookieFor('owner');
    const response = await patchTicket(
      'WEB-1',
      { version: 1, assigneeId: null, dueDate: null, componentId: null, estimateMinutes: null },
      owner,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      assignee: null,
      dueDate: null,
      component: null,
      estimateMinutes: null,
    });
  });

  it('assigns a member and records it', async () => {
    const response = await patchTicket(
      'WEB-4',
      { version: 1, assigneeId: f.userId('reviewer') },
      await ctx.cookieFor('admin'),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().assignee.email).toBe('reviewer@acme.test');
  });

  it('replaces labels and records which were added and removed', async () => {
    const owner = await ctx.cookieFor('owner');
    const response = await patchTicket(
      'WEB-1',
      { version: 1, labelIds: [f.labelId('acme', 'bug'), f.labelId('acme', 'security')] },
      owner,
    );
    expect(response.statusCode).toBe(200);
    expect(
      response
        .json()
        .labels.map((l: { name: string }) => l.name)
        .sort(),
    ).toEqual(['bug', 'security']);
    expect(await eventTypes('WEB-1')).toContain('labels.changed');

    const cleared = await patchTicket('WEB-1', { version: 2, labelIds: [] }, owner);
    expect(cleared.json().labels).toEqual([]);
  });

  describe('a change that changes nothing', () => {
    it('is accepted, writes nothing and leaves the version alone', async () => {
      const before = (await ticketRow(ctx.db, 'WEB-1'))!;
      const eventsBefore = (await eventTypes('WEB-1')).length;
      const response = await patchTicket(
        'WEB-1',
        {
          version: before.version,
          title: before.title,
          priorityId: before.priorityId,
          statusId: before.statusId,
        },
        await ctx.cookieFor('owner'),
      );
      expect(response.statusCode).toBe(200);
      expect(response.json().version).toBe(before.version);
      const after = (await ticketRow(ctx.db, 'WEB-1'))!;
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect((await eventTypes('WEB-1')).length).toBe(eventsBefore);
    });
  });

  describe('versions', () => {
    it('refuses an edit made from a stale version and leaves the ticket alone', async () => {
      const owner = await ctx.cookieFor('owner');
      expect(
        (await patchTicket('WEB-4', { version: 1, title: 'First change' }, owner)).statusCode,
      ).toBe(200);
      const stale = await patchTicket('WEB-4', { version: 1, title: 'Second change' }, owner);
      expect(stale.statusCode).toBe(409);
      expect(apiErrorSchema.parse(stale.json()).error.code).toBe('conflict');
      expect((await ticketRow(ctx.db, 'WEB-4'))?.title).toBe('First change');
    });

    it('refuses a version from the future too', async () => {
      const response = await patchTicket(
        'WEB-4',
        { version: 99, title: 'Nope' },
        await ctx.cookieFor('owner'),
      );
      expect(response.statusCode).toBe(409);
    });
  });

  describe('moving between statuses', () => {
    it('follows the project’s transitions, sets completion and lets finished work reopen', async () => {
      const dev = await ctx.cookieFor('developer');
      // WEB-4 starts in the backlog.
      expect((await moveTo('WEB-4', 'WEB', 'done', dev)).statusCode).toBe(422);
      expect((await moveTo('WEB-4', 'WEB', 'open', dev)).statusCode).toBe(200);
      expect((await moveTo('WEB-4', 'WEB', 'in_progress', dev)).statusCode).toBe(200);
      expect((await moveTo('WEB-4', 'WEB', 'in_review', dev)).statusCode).toBe(200);
      const done = await moveTo('WEB-4', 'WEB', 'done', dev);
      expect(done.statusCode).toBe(200);
      expect(done.json().completedAt).not.toBeNull();
      expect(done.json().status.key).toBe('done');

      const reopened = await moveTo('WEB-4', 'WEB', 'open', dev);
      expect(reopened.statusCode).toBe(200);
      expect(reopened.json().completedAt).toBeNull();

      expect(await eventTypes('WEB-4')).toEqual([
        'ticket.created',
        'ticket.status_changed',
        'ticket.status_changed',
        'ticket.status_changed',
        'ticket.status_changed',
        'ticket.status_changed',
      ]);
    });

    it('explains an illegal move in terms of where the ticket is now', async () => {
      const response = await moveTo('WEB-4', 'WEB', 'done', await ctx.cookieFor('owner'));
      expect(response.statusCode).toBe(422);
      expect(response.json().error.details[0]).toMatchObject({ path: 'statusId' });
      expect(response.json().error.details[0].message).toContain('Cold Steel');
      expect((await ticketRow(ctx.db, 'WEB-4'))?.version).toBe(1);
    });

    it('refuses a status of another project, another workspace, or none at all', async () => {
      const owner = await ctx.cookieFor('owner');
      for (const statusId of [
        f.statusId('API', 'open'),
        f.statusId('OPS', 'open'),
        '01a1656b-1a49-7146-94ac-1c72df43ddb4',
      ]) {
        const response = await patchTicket('WEB-4', { version: 1, statusId }, owner);
        expect(response.statusCode, statusId).toBe(422);
      }
      expect((await ticketRow(ctx.db, 'WEB-4'))?.version).toBe(1);
    });

    it('refuses a status that has been switched off', async () => {
      await ctx.db
        .update(projectStatuses)
        .set({ isActive: false })
        .where(eq(projectStatuses.id, f.statusId('WEB', 'blocked')));
      // WEB-1 is in progress, and in progress → blocked is a defined transition.
      const response = await moveTo('WEB-1', 'WEB', 'blocked', await ctx.cookieFor('owner'));
      expect(response.statusCode).toBe(422);
    });

    it('offers only reachable, active statuses as next moves', async () => {
      const response = await getTicket('WEB-1', await ctx.cookieFor('owner'));
      expect(
        response
          .json()
          .allowedTransitions.map((s: { key: string }) => s.key)
          .sort(),
      ).toEqual(['blocked', 'cancelled', 'done', 'in_review', 'open']);
    });
  });

  describe('ids from somewhere else', () => {
    const unknown = '01a1656b-1a49-7146-94ac-1c72df43ddb4';
    const cases: [string, string, (x: Facts) => Record<string, unknown>][] = [
      [
        'a type from another workspace',
        'typeId',
        (x) => ({ typeId: x.typeId('northwind', 'task') }),
      ],
      [
        'a priority from another workspace',
        'priorityId',
        (x) => ({ priorityId: x.priorityId('northwind', 'low') }),
      ],
      [
        'an assignee from another workspace',
        'assigneeId',
        (x) => ({ assigneeId: x.userId('other-owner') }),
      ],
      ['an unknown assignee', 'assigneeId', () => ({ assigneeId: unknown })],
      [
        'a label from another workspace',
        'labelIds',
        (x) => ({ labelIds: [x.labelId('northwind', 'ops')] }),
      ],
      [
        'a component of another project',
        'componentId',
        (x) => ({ componentId: x.componentId('API', 'Auth') }),
      ],
    ];

    it.each(cases)('refuses %s and changes nothing', async (_label, field, build) => {
      const before = (await ticketRow(ctx.db, 'WEB-1'))!;
      const response = await patchTicket(
        'WEB-1',
        { version: 1, ...build(f) },
        await ctx.cookieFor('owner'),
      );
      expect(response.statusCode).toBe(422);
      expect(response.json().error.details.map((d: { path: string }) => d.path)).toContain(field);
      const after = (await ticketRow(ctx.db, 'WEB-1'))!;
      expect(after.version).toBe(before.version);
      expect(after.typeId).toBe(before.typeId);
      expect(after.assigneeId).toBe(before.assigneeId);
    });
  });

  describe('fields nobody may set', () => {
    it.each([
      'key',
      'reporterId',
      'number',
      'projectId',
      'organisationId',
      'completedAt',
      'id',
      'createdAt',
    ])('refuses a body carrying %s', async (field) => {
      const before = (await ticketRow(ctx.db, 'WEB-1'))!;
      const response = await patchTicket(
        'WEB-1',
        { version: 1, title: 'Hijacked', [field]: field === 'key' ? 'WEB-99' : 'x' },
        await ctx.cookieFor('owner'),
      );
      expect(response.statusCode).toBe(422);
      const after = (await ticketRow(ctx.db, 'WEB-1'))!;
      expect(after.title).toBe(before.title);
      expect(after.key).toBe('WEB-1');
    });

    it('refuses an edit that names no change, or no version', async () => {
      const owner = await ctx.cookieFor('owner');
      expect((await patchTicket('WEB-1', { version: 1 }, owner)).statusCode).toBe(422);
      expect((await patchTicket('WEB-1', { title: 'x' }, owner)).statusCode).toBe(422);
      expect((await patchTicket('WEB-1', { version: 0, title: 'x' }, owner)).statusCode).toBe(422);
    });
  });

  describe('who may edit', () => {
    const matrix: [string, number][] = [
      ['owner', 200],
      ['admin', 200],
      ['developer', 200],
      ['reviewer', 403],
      ['readonly', 403],
      ['restricted', 403],
      ['other-owner', 404],
    ];

    it.each(matrix)('%s gets %i', async (identity, expected) => {
      const response = await patchTicket(
        'WEB-4',
        { version: 1, title: `Edited by ${identity}` },
        await ctx.cookieFor(identity),
      );
      expect(response.statusCode).toBe(expected);
      const after = (await ticketRow(ctx.db, 'WEB-4'))!;
      expect(after.title).toBe(
        expected === 200 ? `Edited by ${identity}` : 'Update the README with setup steps',
      );
    });

    it('answers 401 to someone who is not signed in', async () => {
      expect((await patchTicket('WEB-4', { version: 1, title: 'x' })).statusCode).toBe(401);
    });

    it('stops a reader moving a ticket through the API, whatever the page shows', async () => {
      const response = await moveTo('WEB-4', 'WEB', 'open', await ctx.cookieFor('readonly'));
      expect(response.statusCode).toBe(403);
      expect((await ticketRow(ctx.db, 'WEB-4'))?.statusId).toBe(f.statusId('WEB', 'backlog'));
    });
  });
});

describe('sanity of the seed this file leans on', () => {
  it('has the reporter and the member rows the tests above assume', async () => {
    const [olivia] = await ctx.db.select().from(users).where(eq(users.email, 'owner@acme.test'));
    expect(olivia).toBeDefined();
    expect(f.ticket('WEB-4').title).toBe('Update the README with setup steps');
  });
});
