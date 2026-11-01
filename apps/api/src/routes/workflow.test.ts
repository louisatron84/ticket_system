import { auditEvents, projectStatuses, projects, ticketEvents, tickets } from '@forge/db';
import {
  projectDetailSchema,
  ticketDetailSchema,
  workflowConfigSchema,
  workflowSchema,
  type WorkflowConfig,
} from '@forge/shared';
import { and, eq, like } from 'drizzle-orm';
import { z } from 'zod';
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

const base = (projectKey = 'WEB', orgId = f.acmeId) =>
  `/api/v1/orgs/${orgId}/projects/${projectKey}/workflow`;

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  payload?: unknown,
  as = 'owner',
) {
  return ctx.app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    headers: { cookie: await ctx.cookieFor(as) },
  });
}

const read = async (projectKey = 'WEB'): Promise<WorkflowConfig> =>
  workflowConfigSchema.parse((await call('GET', base(projectKey))).json());

const statusIn = (workflow: WorkflowConfig, key: string) =>
  workflow.statuses.find((status) => status.key === key)!;

const workflowAudits = async () =>
  ctx.db.select().from(auditEvents).where(like(auditEvents.action, 'workflow.%'));

const versionOf = async (projectKey: string) =>
  (await ctx.db.select().from(projects).where(eq(projects.key, projectKey)))[0]!.workflowVersion;

const errorMessage = (response: { json(): unknown }) => {
  const body = response.json() as {
    error: { message: string; details?: { message: string }[] };
  };
  return body.error.details?.[0]?.message ?? body.error.message;
};

const archive = (projectKey: string) =>
  ctx.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.key, projectKey));

describe('who may see and change a workflow', () => {
  const matrix: [string, number][] = [
    ['owner', 200],
    ['admin', 200],
    ['developer', 403],
    ['reviewer', 403],
    ['readonly', 403],
    ['restricted', 403],
    ['other-owner', 404],
  ];

  it.each(matrix)('%s reading gets %i', async (identity, expected) => {
    expect((await call('GET', base(), undefined, identity)).statusCode).toBe(expected);
  });

  it.each(matrix)('%s adding a status gets %i', async (identity, expected) => {
    const response = await call(
      'POST',
      `${base()}/statuses`,
      { name: 'QA', category: 'in_progress' },
      identity,
    );
    expect(response.statusCode).toBe(expected === 200 ? 201 : expected);
    const added = await ctx.db.select().from(projectStatuses).where(eq(projectStatuses.key, 'qa'));
    expect(added).toHaveLength(expected === 200 ? 1 : 0);
  });

  it('answers 401 to someone who is not signed in', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: base() });
    expect(response.statusCode).toBe(401);
  });

  it("answers 404 for another workspace's project, read or changed", async () => {
    expect((await call('GET', base('OPS'))).statusCode).toBe(404);
    const response = await call('POST', `${base('OPS')}/statuses`, {
      name: 'QA',
      category: 'in_progress',
    });
    expect(response.statusCode).toBe(404);
    // Nor through the other workspace's address with a project of this one.
    expect((await call('GET', base('WEB', f.northwindId))).statusCode).toBe(404);
    expect((await call('GET', base('NOPE'))).statusCode).toBe(404);
  });

  it('answers 404 for a status of another project', async () => {
    const apiOpen = f.statusId('API', 'open');
    const response = await call('PATCH', `${base()}/statuses/${apiOpen}`, { name: 'Ready' });
    expect(response.statusCode).toBe(404);
    expect((await call('PATCH', `${base()}/statuses/not-a-uuid`, { name: 'R' })).statusCode).toBe(
      404,
    );
    const opsOpen = f.statusId('OPS', 'open');
    expect((await call('POST', `${base()}/statuses/${opsOpen}/deactivate`, {})).statusCode).toBe(
      404,
    );
  });
});

describe('reading a workflow', () => {
  it('lists every status in order with its counts, flags and the transitions with rules', async () => {
    const workflow = await read();
    expect(workflow).toMatchObject({ projectKey: 'WEB', archived: false, version: 0 });
    expect(workflow.statuses.map((status) => status.key)).toEqual([
      'backlog',
      'open',
      'in_progress',
      'in_review',
      'blocked',
      'done',
      'cancelled',
    ]);
    expect(statusIn(workflow, 'backlog')).toMatchObject({ initial: true, active: true });
    expect(statusIn(workflow, 'cancelled')).toMatchObject({ cancellation: true });
    expect(statusIn(workflow, 'open').ticketCount).toBe(3);
    expect(workflow.transitions).toHaveLength(21);
    expect(workflow.transitions.every((t) => t.rules.length === 0)).toBe(true);
  });
});

describe('adding a status', () => {
  it('makes a key from the name, puts it last, bumps the version and audits it', async () => {
    const response = await call('POST', `${base()}/statuses`, {
      name: '  Ready for QA ',
      category: 'in_progress',
    });
    expect(response.statusCode).toBe(201);
    const workflow = workflowConfigSchema.parse(response.json());
    const added = statusIn(workflow, 'ready_for_qa');
    expect(added).toMatchObject({
      name: 'Ready for QA',
      category: 'in_progress',
      active: true,
      initial: false,
      cancellation: false,
      ticketCount: 0,
    });
    expect(workflow.statuses.at(-1)!.key).toBe('ready_for_qa');
    expect(workflow.version).toBe(1);

    const [event] = await workflowAudits();
    expect(event).toMatchObject({
      action: 'workflow.status_created',
      organisationId: f.acmeId,
      actorUserId: f.userId('owner'),
      targetType: 'workflow',
      targetId: 'WEB',
      outcome: 'success',
    });
  });

  it('gives a clashing key a number, never changing the old one', async () => {
    await call('POST', `${base()}/statuses`, { name: 'QA', category: 'in_progress' });
    const response = await call('POST', `${base()}/statuses`, {
      name: 'QA!',
      category: 'in_progress',
    });
    expect(response.statusCode).toBe(201);
    const workflow = workflowConfigSchema.parse(response.json());
    expect(statusIn(workflow, 'qa').name).toBe('QA');
    expect(statusIn(workflow, 'qa-2').name).toBe('QA!');
  });

  describe('refuses a name an active status has, ignoring case', () => {
    it.each(['Warming', 'WARMING', ' warming '])('%j', async (name) => {
      const response = await call('POST', `${base()}/statuses`, { name, category: 'not_started' });
      expect(response.statusCode).toBe(409);
      expect(errorMessage(response)).toBe(
        'The project WEB already has a status named "' + name.trim() + '".',
      );
      expect(await workflowAudits()).toHaveLength(0);
      expect(await versionOf('WEB')).toBe(0);
    });
  });

  it('refuses names that are empty, too long or not one line, and unknown categories', async () => {
    for (const payload of [
      { name: '', category: 'in_progress' },
      { name: 'x'.repeat(41), category: 'in_progress' },
      { name: 'two\nlines', category: 'in_progress' },
      { name: 'QA', category: 'waiting' },
      { name: 'QA' },
    ]) {
      expect((await call('POST', `${base()}/statuses`, payload)).statusCode).toBe(422);
    }
    expect(
      (await call('POST', `${base()}/statuses`, { name: 'x'.repeat(40), category: 'completed' }))
        .statusCode,
    ).toBe(201);
  });

  it('refuses any change to an archived project', async () => {
    await archive('WEB');
    const response = await call('POST', `${base()}/statuses`, {
      name: 'QA',
      category: 'in_progress',
    });
    expect(response.statusCode).toBe(409);
    expect(errorMessage(response)).toBe(
      'This project is archived. Unarchive it to change its workflow.',
    );
    // It can still be read.
    expect((await read()).archived).toBe(true);
    const grid = await call('PUT', `${base()}/transitions`, { version: 0, transitions: [] });
    expect(grid.statusCode).toBe(409);
  });
});

describe('changing a status', () => {
  it('renames it; the history already written keeps the old name', async () => {
    const open = f.statusId('WEB', 'open');
    const ticket = f.ticket('WEB-11');
    await call(
      'PATCH',
      `/api/v1/orgs/${f.acmeId}/tickets/WEB-11`,
      { version: ticket.version, statusId: f.statusId('WEB', 'in_progress') },
      'developer',
    );
    const response = await call('PATCH', `${base()}/statuses/${open}`, { name: 'Ready' });
    expect(response.statusCode).toBe(200);
    const workflow = workflowConfigSchema.parse(response.json());
    expect(statusIn(workflow, 'open')).toMatchObject({ name: 'Ready', key: 'open' });
    expect(workflow.version).toBe(1);

    const [line] = await ctx.db
      .select()
      .from(ticketEvents)
      .where(
        and(eq(ticketEvents.ticketId, ticket.id), eq(ticketEvents.type, 'ticket.status_changed')),
      );
    expect(line!.data).toMatchObject({ from: { name: 'Warming' } });
  });

  it('lets a rename change only the case, and refuses another status name', async () => {
    const open = f.statusId('WEB', 'open');
    expect(
      (await call('PATCH', `${base()}/statuses/${open}`, { name: 'WARMING' })).statusCode,
    ).toBe(200);
    const clash = await call('PATCH', `${base()}/statuses/${open}`, { name: 'quenched' });
    expect(clash.statusCode).toBe(409);
    expect(errorMessage(clash)).toBe('The project WEB already has a status named "quenched".');
  });

  it('changes nothing, and bumps nothing, when the values are the same', async () => {
    const open = f.statusId('WEB', 'open');
    const response = await call('PATCH', `${base()}/statuses/${open}`, {
      name: 'Warming',
      category: 'not_started',
    });
    expect(response.statusCode).toBe(200);
    expect(await versionOf('WEB')).toBe(0);
    expect(await workflowAudits()).toHaveLength(0);
  });

  it('keeps completion dates true when the category changes', async () => {
    const done = f.statusId('WEB', 'done');
    expect((await ticketRow(ctx.db, 'WEB-6'))!.completedAt).not.toBeNull();
    await call('PATCH', `${base()}/statuses/${done}`, { category: 'in_progress' });
    expect((await ticketRow(ctx.db, 'WEB-6'))!.completedAt).toBeNull();
    await call('PATCH', `${base()}/statuses/${done}`, { category: 'completed' });
    expect((await ticketRow(ctx.db, 'WEB-6'))!.completedAt).not.toBeNull();
  });

  it('refuses to leave a category with no active status', async () => {
    const done = f.statusId('WEB', 'done');
    const cancelled = f.statusId('WEB', 'cancelled');
    expect(
      (await call('PATCH', `${base()}/statuses/${done}`, { category: 'in_progress' })).statusCode,
    ).toBe(200);
    const response = await call('PATCH', `${base()}/statuses/${cancelled}`, {
      category: 'in_progress',
    });
    expect(response.statusCode).toBe(409);
    expect(errorMessage(response)).toBe(
      'A workflow needs at least one active status that is completed.',
    );
    expect(statusIn(await read(), 'cancelled').category).toBe('completed');
  });

  it('moves the initial flag, and new tickets start there', async () => {
    const open = f.statusId('WEB', 'open');
    const response = await call('PATCH', `${base()}/statuses/${open}`, { initial: true });
    expect(response.statusCode).toBe(200);
    const workflow = workflowConfigSchema.parse(response.json());
    expect(workflow.statuses.filter((s) => s.initial).map((s) => s.key)).toEqual(['open']);

    const created = await call(
      'POST',
      `/api/v1/orgs/${f.acmeId}/projects/WEB/tickets`,
      {
        title: 'Starts in Warming',
        typeId: f.typeId('acme', 'task'),
        priorityId: f.priorityId('acme', 'normal'),
      },
      'developer',
    );
    expect(created.statusCode).toBe(201);
    expect(created.json().status.key).toBe('open');
  });

  it('refuses an initial status that is not an active, not started one', async () => {
    const response = await call('PATCH', `${base()}/statuses/${f.statusId('WEB', 'done')}`, {
      initial: true,
    });
    expect(response.statusCode).toBe(409);
    expect(errorMessage(response)).toBe(
      'Only an active, not started status can be where new tickets start.',
    );
    const backlog = f.statusId('WEB', 'backlog');
    const away = await call('PATCH', `${base()}/statuses/${backlog}`, { category: 'in_progress' });
    expect(away.statusCode).toBe(409);
    expect(errorMessage(away)).toBe(
      'Cold Steel is where new tickets start, so it must stay not started. Make another status the initial one first.',
    );
  });
});

describe('reordering statuses', () => {
  it('takes every status once, in the new order', async () => {
    const workflow = await read();
    const ids = workflow.statuses.map((s) => s.id).reverse();
    const response = await call('PUT', `${base()}/order`, { statusIds: ids });
    expect(response.statusCode).toBe(200);
    const after = workflowConfigSchema.parse(response.json());
    expect(after.statuses.map((s) => s.id)).toEqual(ids);
    expect(after.version).toBe(1);
  });

  it('refuses a list that leaves one out or names another project', async () => {
    const ids = (await read()).statuses.map((s) => s.id);
    for (const statusIds of [ids.slice(1), [...ids.slice(1), f.statusId('API', 'open')]]) {
      const response = await call('PUT', `${base()}/order`, { statusIds });
      expect(response.statusCode).toBe(422);
      expect(errorMessage(response)).toBe('List every status of the project once.');
    }
    expect(await versionOf('WEB')).toBe(0);
  });
});

describe('deactivating and reactivating a status', () => {
  it('needs a destination when it has tickets', async () => {
    const open = f.statusId('WEB', 'open');
    const response = await call('POST', `${base()}/statuses/${open}/deactivate`, {});
    expect(response.statusCode).toBe(422);
    expect(errorMessage(response)).toBe(
      'Warming has 3 tickets. Choose an active status for them to move to.',
    );
    for (const destinationStatusId of [open, f.statusId('API', 'backlog')]) {
      const bad = await call('POST', `${base()}/statuses/${open}/deactivate`, {
        destinationStatusId,
      });
      expect(bad.statusCode).toBe(422);
      expect(errorMessage(bad)).toBe(
        'Choose another active status of this project for its tickets.',
      );
    }
    expect(statusIn(await read(), 'open').active).toBe(true);
  });

  it('moves its tickets with a history line, without workflow checks, and stops offering it', async () => {
    const open = f.statusId('WEB', 'open');
    const done = f.statusId('WEB', 'done');
    const before = (await ticketRow(ctx.db, 'WEB-2'))!;
    // Warming to Quenched is not an allowed move; retiring does not ask.
    const response = await call('POST', `${base()}/statuses/${open}/deactivate`, {
      destinationStatusId: done,
    });
    expect(response.statusCode).toBe(200);
    const workflow = workflowConfigSchema.parse(response.json());
    expect(statusIn(workflow, 'open')).toMatchObject({ active: false, ticketCount: 0 });
    expect(statusIn(workflow, 'done').ticketCount).toBe(5);
    // Its transitions are kept for when it comes back.
    expect(workflow.transitions.some((t) => t.fromStatusId === open)).toBe(true);

    const after = (await ticketRow(ctx.db, 'WEB-2'))!;
    expect(after).toMatchObject({ statusId: done, version: before.version + 1 });
    expect(after.completedAt).not.toBeNull();
    const [line] = await ctx.db
      .select()
      .from(ticketEvents)
      .where(
        and(eq(ticketEvents.ticketId, after.id), eq(ticketEvents.type, 'ticket.status_retired')),
      );
    expect(line).toMatchObject({
      actorUserId: f.userId('owner'),
      data: { from: { id: open, name: 'Warming' }, to: { id: done, name: 'Quenched' } },
    });
    const timeline = await call('GET', `/api/v1/orgs/${f.acmeId}/tickets/WEB-2/timeline`);
    expect(JSON.stringify(timeline.json())).toContain('ticket.status_retired');

    // Never offered again: not on the ticket, the project, or the workflows of the boards.
    const backlogTicket = ticketDetailSchema
      .pick({ allowedTransitions: true })
      .parse((await call('GET', `/api/v1/orgs/${f.acmeId}/tickets/WEB-4`)).json());
    expect(backlogTicket.allowedTransitions.map((s) => s.key)).not.toContain('open');
    const detail = projectDetailSchema.parse(
      (await call('GET', `/api/v1/orgs/${f.acmeId}/projects/WEB`)).json(),
    );
    expect(detail.statuses.map((s) => s.key)).not.toContain('open');
    expect(detail.transitions.some((t) => t.toStatusId === open || t.fromStatusId === open)).toBe(
      false,
    );
    const workflows = z
      .array(workflowSchema)
      .parse((await call('GET', `/api/v1/orgs/${f.acmeId}/workflows`)).json());
    const web = workflows.find((w) => w.projectKey === 'WEB')!;
    expect(web.statuses.map((s) => s.key)).not.toContain('open');
    expect(web.transitions.some((t) => t.toStatusId === open || t.fromStatusId === open)).toBe(
      false,
    );
    const board = await call('GET', `/api/v1/orgs/${f.acmeId}/projects/WEB/board`);
    expect(
      board.json().columns.map((c: { status: { key: string } }) => c.status.key),
    ).not.toContain('open');

    // A move into it is refused like any unknown status.
    const ticket = (await ticketRow(ctx.db, 'WEB-4'))!;
    const move = await call(
      'PATCH',
      `/api/v1/orgs/${f.acmeId}/tickets/WEB-4`,
      { version: ticket.version, statusId: open },
      'developer',
    );
    expect(move.statusCode).toBe(422);

    const [audit] = await workflowAudits();
    expect(audit).toMatchObject({
      action: 'workflow.status_deactivated',
      after: { movedTickets: 3, destination: 'done' },
    });
  });

  it('needs no destination when it is empty, and reactivating brings it back as it was', async () => {
    const created = workflowConfigSchema.parse(
      (await call('POST', `${base()}/statuses`, { name: 'QA', category: 'in_progress' })).json(),
    );
    const qa = statusIn(created, 'qa');
    const inProgress = f.statusId('WEB', 'in_progress');
    const grid = created.transitions.concat([
      { fromStatusId: inProgress, toStatusId: qa.id, rules: ['needs_comment'] },
    ]);
    await call('PUT', `${base()}/transitions`, { version: created.version, transitions: grid });

    const off = await call('POST', `${base()}/statuses/${qa.id}/deactivate`, {});
    expect(off.statusCode).toBe(200);
    expect(statusIn(workflowConfigSchema.parse(off.json()), 'qa').active).toBe(false);

    const on = await call('POST', `${base()}/statuses/${qa.id}/reactivate`, {});
    expect(on.statusCode).toBe(200);
    const back = workflowConfigSchema.parse(on.json());
    expect(statusIn(back, 'qa')).toMatchObject({
      active: true,
      name: 'QA',
      category: 'in_progress',
    });
    expect(back.transitions).toContainEqual({
      fromStatusId: inProgress,
      toStatusId: qa.id,
      rules: ['needs_comment'],
    });
    const audits = (await workflowAudits()).map((a) => a.action);
    expect(audits).toContain('workflow.status_reactivated');
  });

  it('refuses to retire the initial status or the last of a category', async () => {
    const backlog = await call(
      'POST',
      `${base()}/statuses/${f.statusId('WEB', 'backlog')}/deactivate`,
      { destinationStatusId: f.statusId('WEB', 'open') },
    );
    expect(backlog.statusCode).toBe(409);
    expect(errorMessage(backlog)).toBe(
      'Cold Steel is where new tickets start. Make another status the initial one first.',
    );

    const cancelled = f.statusId('WEB', 'cancelled');
    expect(
      (
        await call('POST', `${base()}/statuses/${cancelled}/deactivate`, {
          destinationStatusId: f.statusId('WEB', 'done'),
        })
      ).statusCode,
    ).toBe(200);
    const last = await call('POST', `${base()}/statuses/${f.statusId('WEB', 'done')}/deactivate`, {
      destinationStatusId: f.statusId('WEB', 'open'),
    });
    expect(last.statusCode).toBe(409);
    expect(errorMessage(last)).toBe(
      'A workflow needs at least one active status that is completed.',
    );
    // Refused as a whole: the tickets did not move.
    expect((await ticketRow(ctx.db, 'WEB-6'))!.statusId).toBe(f.statusId('WEB', 'done'));
  });

  it('refuses to reactivate a status whose name an active one has taken', async () => {
    const created = workflowConfigSchema.parse(
      (await call('POST', `${base()}/statuses`, { name: 'QA', category: 'in_progress' })).json(),
    );
    const qa = statusIn(created, 'qa');
    await call('POST', `${base()}/statuses/${qa.id}/deactivate`, {});
    await call('POST', `${base()}/statuses`, { name: 'qa', category: 'in_progress' });
    const response = await call('POST', `${base()}/statuses/${qa.id}/reactivate`, {});
    expect(response.statusCode).toBe(409);
    expect(errorMessage(response)).toBe('The project WEB already has a status named "QA".');
  });
});

describe('saving the transitions grid', () => {
  it('replaces the moves between active statuses, with their rules', async () => {
    const workflow = await read();
    const open = f.statusId('WEB', 'open');
    const inProgress = f.statusId('WEB', 'in_progress');
    const response = await call('PUT', `${base()}/transitions`, {
      version: workflow.version,
      transitions: [
        { fromStatusId: open, toStatusId: inProgress, rules: ['needs_assignee', 'needs_comment'] },
        { fromStatusId: inProgress, toStatusId: open },
      ],
    });
    expect(response.statusCode).toBe(200);
    const after = workflowConfigSchema.parse(response.json());
    expect(after.version).toBe(1);
    expect(after.transitions).toHaveLength(2);
    expect(after.transitions).toContainEqual({
      fromStatusId: open,
      toStatusId: inProgress,
      rules: ['needs_assignee', 'needs_comment'],
    });
    const [audit] = await workflowAudits();
    expect(audit).toMatchObject({
      action: 'workflow.transitions_saved',
      after: ['in_progress>open', 'open>in_progress [needs_assignee, needs_comment]'],
    });
  });

  it('refuses a stale version with 409 and changes nothing', async () => {
    await call('POST', `${base()}/statuses`, { name: 'QA', category: 'in_progress' });
    const response = await call('PUT', `${base()}/transitions`, { version: 0, transitions: [] });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe(
      'This workflow was changed by someone else. Reload it to see the latest version.',
    );
    expect((await read()).transitions).toHaveLength(21);
  });

  it('refuses moves to itself, twice, to inactive statuses or other projects, and unknown rules', async () => {
    const open = f.statusId('WEB', 'open');
    const done = f.statusId('WEB', 'done');
    const created = workflowConfigSchema.parse(
      (await call('POST', `${base()}/statuses`, { name: 'QA', category: 'in_progress' })).json(),
    );
    const qa = statusIn(created, 'qa').id;
    const off = workflowConfigSchema.parse(
      (await call('POST', `${base()}/statuses/${qa}/deactivate`, {})).json(),
    );
    const cases: [unknown[], number][] = [
      [[{ fromStatusId: open, toStatusId: open }], 422],
      [
        [
          { fromStatusId: open, toStatusId: done },
          { fromStatusId: open, toStatusId: done },
        ],
        422,
      ],
      [[{ fromStatusId: open, toStatusId: qa }], 422],
      [[{ fromStatusId: open, toStatusId: f.statusId('API', 'done') }], 422],
      [[{ fromStatusId: open, toStatusId: done, rules: ['needs_luck'] }], 422],
      [[{ fromStatusId: open, toStatusId: done, rules: ['needs_comment', 'needs_comment'] }], 422],
    ];
    for (const [transitions, expected] of cases) {
      const response = await call('PUT', `${base()}/transitions`, {
        version: off.version,
        transitions,
      });
      expect(response.statusCode).toBe(expected);
    }
    expect((await read()).version).toBe(off.version);
  });

  it('keeps the moves of an inactive status when the grid is saved', async () => {
    const created = workflowConfigSchema.parse(
      (await call('POST', `${base()}/statuses`, { name: 'QA', category: 'in_progress' })).json(),
    );
    const qa = statusIn(created, 'qa').id;
    const open = f.statusId('WEB', 'open');
    const withQa = workflowConfigSchema.parse(
      (
        await call('PUT', `${base()}/transitions`, {
          version: created.version,
          transitions: [...created.transitions, { fromStatusId: open, toStatusId: qa, rules: [] }],
        })
      ).json(),
    );
    const off = workflowConfigSchema.parse(
      (await call('POST', `${base()}/statuses/${qa}/deactivate`, {})).json(),
    );
    const response = await call('PUT', `${base()}/transitions`, {
      version: off.version,
      transitions: [],
    });
    expect(response.statusCode).toBe(200);
    const after = workflowConfigSchema.parse(response.json());
    expect(after.transitions).toEqual([{ fromStatusId: open, toStatusId: qa, rules: [] }]);
    expect(withQa.transitions).toHaveLength(22);
  });

  it('is refused for a project of another workspace', async () => {
    const response = await call('PUT', `${base('OPS')}/transitions`, {
      version: 0,
      transitions: [],
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('copying a workflow from another project', () => {
  it("brings the source's statuses by key, its transitions and their rules", async () => {
    // API gets a QA step, plain names and a rule.
    const api = workflowConfigSchema.parse(
      (
        await call('POST', `${base('API')}/statuses`, { name: 'QA', category: 'in_progress' })
      ).json(),
    );
    const apiQa = statusIn(api, 'qa').id;
    await call('PATCH', `${base('API')}/statuses/${f.statusId('API', 'open')}`, { name: 'Open' });
    const apiInProgress = f.statusId('API', 'in_progress');
    await call('PUT', `${base('API')}/transitions`, {
      version: api.version + 1,
      transitions: [
        { fromStatusId: f.statusId('API', 'backlog'), toStatusId: f.statusId('API', 'open') },
        { fromStatusId: f.statusId('API', 'open'), toStatusId: apiInProgress },
        { fromStatusId: apiInProgress, toStatusId: apiQa, rules: ['needs_comment'] },
        { fromStatusId: apiQa, toStatusId: f.statusId('API', 'done') },
      ],
    });
    // WEB has a status of its own, with no tickets.
    await call('POST', `${base()}/statuses`, { name: 'Design', category: 'not_started' });

    const response = await call('POST', `${base()}/copy`, { sourceProjectKey: 'api' });
    expect(response.statusCode).toBe(200);
    const web = workflowConfigSchema.parse(response.json());
    expect(statusIn(web, 'open')).toMatchObject({ name: 'Open', id: f.statusId('WEB', 'open') });
    expect(statusIn(web, 'qa')).toMatchObject({
      name: 'QA',
      category: 'in_progress',
      active: true,
    });
    expect(statusIn(web, 'design')).toMatchObject({ active: false });
    expect(web.statuses.filter((s) => s.initial).map((s) => s.key)).toEqual(['backlog']);

    const keyOf = new Map(web.statuses.map((s) => [s.id, s.key]));
    expect(
      web.transitions
        .map((t) => `${keyOf.get(t.fromStatusId)}>${keyOf.get(t.toStatusId)}:${t.rules.join(',')}`)
        .sort(),
    ).toEqual(['backlog>open:', 'in_progress>qa:needs_comment', 'open>in_progress:', 'qa>done:']);

    // The source is untouched.
    expect((await read('API')).statuses).toHaveLength(8);
    const audits = await workflowAudits();
    expect(audits.at(-1)).toMatchObject({ action: 'workflow.copied', targetId: 'WEB' });
  });

  it('is refused, naming them, when statuses the source lacks still hold tickets', async () => {
    const qa = statusIn(
      workflowConfigSchema.parse(
        (await call('POST', `${base()}/statuses`, { name: 'QA', category: 'in_progress' })).json(),
      ),
      'qa',
    );
    // Put WEB-1 in QA directly.
    await ctx.db.update(tickets).set({ statusId: qa.id }).where(eq(tickets.key, 'WEB-1'));

    const response = await call('POST', `${base()}/copy`, { sourceProjectKey: 'API' });
    expect(response.statusCode).toBe(409);
    expect(errorMessage(response)).toBe(
      'The copy would leave tickets in statuses that are not active: QA (1 ticket). Deactivate them here first, choosing where their tickets go.',
    );
    expect(statusIn(await read(), 'qa').active).toBe(true);
  });

  it('refuses an unknown project, one of another workspace, or itself', async () => {
    for (const sourceProjectKey of ['NOPE', 'OPS', 'WEB']) {
      const response = await call('POST', `${base()}/copy`, { sourceProjectKey });
      expect(response.statusCode).toBe(422);
    }
    expect(
      (await call('POST', `${base()}/copy`, { sourceProjectKey: 'not a key' })).statusCode,
    ).toBe(422);
    expect(await versionOf('WEB')).toBe(0);
  });

  it('needs workflows.configure', async () => {
    const response = await call('POST', `${base()}/copy`, { sourceProjectKey: 'API' }, 'developer');
    expect(response.statusCode).toBe(403);
  });
});
