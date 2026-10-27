import {
  apiErrorSchema,
  bulkTicketResultSchema,
  workflowSchema,
  workspaceBoardSchema,
  type BulkTicketResult,
} from '@forge/shared';
import {
  organisationMemberships,
  projectStatuses,
  roles,
  ticketEvents,
  ticketLabels,
  tickets,
} from '@forge/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, ticketRow, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';
import { addListDataset } from '../test-support/ticket-dataset';

let ctx: Integration;
let f: Facts;
let lstProjectId: string;
let lstStatusIds: Record<string, string>;

const ARCHIVED_MESSAGE = 'This ticket is archived. Unarchive it to change it.';

beforeAll(async () => {
  ctx = await startIntegration();
});

beforeEach(async () => {
  await ctx.reseed();
  f = await loadFacts(ctx.db);
  ({ projectId: lstProjectId, statusIds: lstStatusIds } = await addListDataset(ctx.db, f));
});

afterAll(async () => {
  await ctx.close();
});

async function bulk(payload: unknown, as = 'owner', orgId = f.acmeId) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/tickets/bulk`,
    payload: payload as object,
    headers: { cookie: await ctx.cookieFor(as) },
  });
}

async function bulkOk(keys: string[], changes: object, as = 'owner'): Promise<BulkTicketResult> {
  const response = await bulk({ keys, changes }, as);
  expect(response.statusCode, response.body).toBe(200);
  return bulkTicketResultSchema.parse(response.json());
}

const workflows = async (as = 'owner', orgId = f.acmeId) =>
  ctx.app.inject({
    method: 'GET',
    url: `/api/v1/orgs/${orgId}/workflows`,
    headers: { cookie: await ctx.cookieFor(as) },
  });

const eventsOf = async (key: string, type: string) =>
  ctx.db
    .select()
    .from(ticketEvents)
    .where(
      and(
        eq(ticketEvents.ticketId, (await ticketRow(ctx.db, key))!.id),
        eq(ticketEvents.type, type),
      ),
    );

const labelNamesOf = async (key: string) => {
  const rows = await ctx.db
    .select({ labelId: ticketLabels.labelId })
    .from(ticketLabels)
    .where(eq(ticketLabels.ticketId, (await ticketRow(ctx.db, key))!.id));
  return rows.map((r) => r.labelId).sort();
};

// Derived from the system roles: bulk needs tickets.edit, which owner, admin and developer hold;
// reviewer and read-only do not. The workflows route needs only tickets.view.
describe('who may use bulk edit', () => {
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
    const response = await bulk(
      { keys: ['LST-2'], changes: { priorityId: f.priorityId('acme', 'low') } },
      identity,
    );
    expect(response.statusCode).toBe(expected);
  });

  it('answers 401 to someone who is not signed in', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/bulk`,
      payload: { keys: ['LST-2'], changes: { archived: true } },
    });
    expect(response.statusCode).toBe(401);
  });

  it('is not shadowed by the ticket routes', async () => {
    // "bulk" is not a ticket key, so a GET still answers 404 rather than reaching the bulk route.
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${f.acmeId}/tickets/bulk`,
      headers: { cookie: await ctx.cookieFor('owner') },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('who may read the workflows', () => {
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
    expect((await workflows(identity)).statusCode).toBe(expected);
  });

  it('answers 401 to someone who is not signed in', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${f.acmeId}/workflows`,
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('the workflows', () => {
  it('has one per project, ordered by key, the same as the board carries', async () => {
    const response = await workflows();
    expect(response.statusCode, response.body).toBe(200);
    const list = z.array(workflowSchema).parse(response.json());
    expect(list.map((w) => w.projectKey)).toEqual(['API', 'LST', 'WEB']);

    const board = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${f.acmeId}/board`,
      headers: { cookie: await ctx.cookieFor('owner') },
    });
    expect(list).toEqual(workspaceBoardSchema.parse(board.json()).workflows);
  });

  it('lists only active statuses and marks an archived project', async () => {
    await ctx.db
      .update(projectStatuses)
      .set({ isActive: false })
      .where(and(eq(projectStatuses.projectId, lstProjectId), eq(projectStatuses.key, 'blocked')));
    const list = z.array(workflowSchema).parse((await workflows()).json());
    const lst = list.find((w) => w.projectKey === 'LST')!;
    expect(lst.statuses.map((s) => s.key)).not.toContain('blocked');
    expect(lst.statuses).toHaveLength(6);
    expect(lst.archived).toBe(false);
  });

  it('shows Northwind only its own', async () => {
    const list = z
      .array(workflowSchema)
      .parse((await workflows('other-owner', f.northwindId)).json());
    expect(list.map((w) => w.projectKey)).toEqual(['OPS']);
  });
});

describe('changing tickets in bulk', () => {
  it('changes priority on every ticket, with history on each', async () => {
    const keys = ['LST-1', 'LST-2', 'LST-3'];
    const before = await Promise.all(keys.map((key) => ticketRow(ctx.db, key)));
    const critical = f.priorityId('acme', 'critical');

    const { results } = await bulkOk(keys, { priorityId: critical });
    expect(results.map((r) => r.key)).toEqual(keys);
    for (const [index, result] of results.entries()) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.ticket.priority.key).toBe('critical');
      expect(result.ticket.version).toBe(before[index]!.version + 1);
      expect((await ticketRow(ctx.db, keys[index]!))!.priorityId).toBe(critical);

      const updates = await eventsOf(keys[index]!, 'ticket.updated');
      expect(updates).toHaveLength(1);
      expect(updates[0]!.data).toMatchObject({ changes: [{ field: 'priority', to: 'Critical' }] });
    }
    // Tickets that were not asked for are untouched.
    expect((await ticketRow(ctx.db, 'LST-4'))!.version).toBe(1);
  });

  it('sets and clears the assignee and the due date', async () => {
    const reviewer = f.userId('reviewer');
    const set = await bulkOk(['LST-1', 'LST-2'], { assigneeId: reviewer, dueDate: '2031-05-06' });
    for (const result of set.results) {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ticket.assignee?.id).toBe(reviewer);
        expect(result.ticket.dueDate).toBe('2031-05-06');
      }
    }
    const cleared = await bulkOk(['LST-1', 'LST-2'], { assigneeId: null, dueDate: null });
    for (const result of cleared.results) {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ticket.assignee).toBeNull();
        expect(result.ticket.dueDate).toBeNull();
      }
    }
  });

  it("reports each ticket's own result, in the order asked", async () => {
    const keys = ['WEB-1', 'LST-4', 'NOPE-1', 'LST-1', 'LST-7'];
    const { results } = await bulkOk(keys, { statusKey: 'in_progress' });
    expect(results.map((r) => r.key)).toEqual(keys);

    const [web, done, nope, open, archived] = results;
    // WEB-1 is already in the forge: nothing to do, and that is not a failure.
    expect(web).toMatchObject({
      ok: true,
      ticket: { key: 'WEB-1', status: { key: 'in_progress' } },
    });
    expect(done).toEqual({
      key: 'LST-4',
      ok: false,
      error: { code: 'validation_failed', message: "That move isn't allowed from Quenched." },
    });
    expect(nope).toEqual({
      key: 'NOPE-1',
      ok: false,
      error: { code: 'not_found', message: 'Not found.' },
    });
    expect(open).toMatchObject({
      ok: true,
      ticket: { key: 'LST-1', status: { key: 'in_progress', name: 'In the Forge' }, version: 2 },
    });
    expect(archived).toEqual({
      key: 'LST-7',
      ok: false,
      error: { code: 'conflict', message: ARCHIVED_MESSAGE },
    });

    // The refusals changed nothing.
    expect((await ticketRow(ctx.db, 'LST-4'))!.version).toBe(1);
    expect((await ticketRow(ctx.db, 'LST-7'))!.version).toBe(1);
    expect((await ticketRow(ctx.db, 'LST-1'))!.statusId).toBe(lstStatusIds.in_progress!);
  });

  it('moves to the status of that key in each ticket’s own project', async () => {
    const { results } = await bulkOk(['LST-1', 'WEB-2'], { statusKey: 'in_progress' });
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await ticketRow(ctx.db, 'WEB-2'))!.statusId).toBe(f.statusId('WEB', 'in_progress'));
    expect((await ticketRow(ctx.db, 'LST-1'))!.statusId).toBe(lstStatusIds.in_progress!);
  });

  it('says so when the ticket’s project has no active status of that key', async () => {
    await ctx.db
      .update(projectStatuses)
      .set({ isActive: false })
      .where(and(eq(projectStatuses.projectId, lstProjectId), eq(projectStatuses.key, 'blocked')));
    const { results } = await bulkOk(['LST-1', 'WEB-3', 'LST-2'], { statusKey: 'blocked' });
    expect(results.map((r) => r.key)).toEqual(['LST-1', 'WEB-3', 'LST-2']);
    expect(results[0]).toEqual({
      key: 'LST-1',
      ok: false,
      error: { code: 'validation_failed', message: 'The LST project has no status "blocked".' },
    });
    // A key that exists nowhere reads the same.
    const unknown = await bulkOk(['LST-1'], { statusKey: 'qa' });
    expect(unknown.results[0]).toMatchObject({
      ok: false,
      error: { message: 'The LST project has no status "qa".' },
    });
  });

  it('adds and removes labels without touching others', async () => {
    const [bug, frontend, docs] = ['bug', 'frontend', 'docs'].map((n) => f.labelId('acme', n));
    // LST-1 has bug and frontend; LST-2 has frontend; LST-3 has none.
    const { results } = await bulkOk(['LST-1', 'LST-2', 'LST-3'], {
      addLabelIds: [docs!],
      removeLabelIds: [bug!],
    });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await labelNamesOf('LST-1')).toEqual([frontend!, docs!].sort());
    expect(await labelNamesOf('LST-2')).toEqual([frontend!, docs!].sort());
    expect(await labelNamesOf('LST-3')).toEqual([docs!]);

    // Removing a label the ticket does not have, or adding one it already has, is not a change.
    const versionBefore = (await ticketRow(ctx.db, 'LST-3'))!.version;
    const again = await bulkOk(['LST-3'], { addLabelIds: [docs!], removeLabelIds: [bug!] });
    expect(again.results[0]).toMatchObject({ ok: true, ticket: { version: versionBefore } });

    const labelEvents = await eventsOf('LST-1', 'labels.changed');
    expect(labelEvents).toHaveLength(1);
    expect(labelEvents[0]!.data).toEqual({ added: ['docs'], removed: ['bug'] });
  });

  it('never takes a ticket past 20 labels', async () => {
    const cookie = await ctx.cookieFor('owner');
    const ids: string[] = [];
    for (let i = 0; i < 21; i += 1) {
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${f.acmeId}/labels`,
        headers: { cookie },
        payload: { name: `cap-${i}`, color: 'slate' },
      });
      expect(created.statusCode, created.body).toBe(201);
      ids.push((created.json() as { id: string }).id);
    }
    const full = await bulkOk(['LST-3'], { addLabelIds: ids.slice(0, 20) });
    expect(full.results[0]!.ok).toBe(true);

    const { results } = await bulkOk(['LST-3', 'LST-2'], { addLabelIds: [ids[20]!] });
    expect(results[0]).toMatchObject({
      key: 'LST-3',
      ok: false,
      error: { code: 'validation_failed', message: 'A ticket can have at most 20 labels.' },
    });
    expect(results[1]!.ok).toBe(true);
    expect(await labelNamesOf('LST-3')).toHaveLength(20);
  });

  it('refuses a label from another workspace for that ticket, not the whole request', async () => {
    const { results } = await bulkOk(['LST-1', 'LST-2'], {
      addLabelIds: [f.labelId('northwind', 'bug')],
    });
    for (const result of results) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'validation_failed', message: 'Unknown label.' },
      });
    }
    expect(await labelNamesOf('LST-2')).toEqual([f.labelId('acme', 'frontend')]);
  });

  it('archives and unarchives in bulk', async () => {
    const { results } = await bulkOk(['LST-1', 'LST-2', 'LST-7'], { archived: true });
    // LST-7 is archived already: asking again is not a failure and changes nothing.
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect((await ticketRow(ctx.db, 'LST-1'))!.archivedAt).not.toBeNull();
    expect((await ticketRow(ctx.db, 'LST-2'))!.archivedAt).not.toBeNull();
    expect((await ticketRow(ctx.db, 'LST-7'))!.version).toBe(1);
    expect(await eventsOf('LST-1', 'ticket.archived')).toHaveLength(1);
    expect(await eventsOf('LST-7', 'ticket.archived')).toHaveLength(0);

    const back = await bulkOk(['LST-1', 'LST-7'], { archived: false });
    expect(back.results.map((r) => r.ok)).toEqual([true, true]);
    expect((await ticketRow(ctx.db, 'LST-1'))!.archivedAt).toBeNull();
    expect((await ticketRow(ctx.db, 'LST-7'))!.archivedAt).toBeNull();
    expect(await eventsOf('LST-7', 'ticket.unarchived')).toHaveLength(1);
  });

  it('applies the edit and then the archive to the same ticket', async () => {
    const { results } = await bulkOk(['LST-2'], {
      priorityId: f.priorityId('acme', 'low'),
      archived: true,
    });
    expect(results[0]).toMatchObject({
      ok: true,
      ticket: { priority: { key: 'low' }, version: 3 },
    });
    expect((await ticketRow(ctx.db, 'LST-2'))!.archivedAt).not.toBeNull();
  });

  it('unarchives first when asked to, so the other edits can apply', async () => {
    const { results } = await bulkOk(['LST-7'], {
      archived: false,
      priorityId: f.priorityId('acme', 'low'),
    });
    // Unarchive (version 2), then the edit (version 3).
    expect(results[0]).toMatchObject({
      ok: true,
      ticket: { key: 'LST-7', priority: { key: 'low' }, version: 3 },
    });
    const row = (await ticketRow(ctx.db, 'LST-7'))!;
    expect(row.archivedAt).toBeNull();
    expect(row.priorityId).toBe(f.priorityId('acme', 'low'));
    expect(await eventsOf('LST-7', 'ticket.unarchived')).toHaveLength(1);
    expect(await eventsOf('LST-7', 'ticket.updated')).toHaveLength(1);
  });

  it('refuses edits to an archived ticket other than unarchiving it', async () => {
    const { results } = await bulkOk(['LST-7'], { priorityId: f.priorityId('acme', 'low') });
    expect(results[0]).toEqual({
      key: 'LST-7',
      ok: false,
      error: { code: 'conflict', message: ARCHIVED_MESSAGE },
    });
  });

  it('takes the ticket as it is now, whatever version the list last saw', async () => {
    await ctx.db.update(tickets).set({ version: 7 }).where(eq(tickets.key, 'LST-2'));
    const { results } = await bulkOk(['LST-2'], { priorityId: f.priorityId('acme', 'low') });
    expect(results[0]).toMatchObject({ ok: true, ticket: { version: 8 } });
  });

  it('finds keys in any letter case, and echoes them as sent', async () => {
    const { results } = await bulkOk(['lst-2', 'not a key'], {
      priorityId: f.priorityId('acme', 'low'),
    });
    expect(results[0]).toMatchObject({ key: 'lst-2', ok: true, ticket: { key: 'LST-2' } });
    expect(results[1]).toEqual({
      key: 'not a key',
      ok: false,
      error: { code: 'not_found', message: 'Not found.' },
    });
  });

  it('does not reveal or touch another workspace’s tickets', async () => {
    // Nora owns Northwind: from there an Acme key is simply not found, and her own ticket is changed.
    const response = await bulk(
      { keys: ['LST-1', 'OPS-1'], changes: { priorityId: f.priorityId('northwind', 'low') } },
      'other-owner',
      f.northwindId,
    );
    expect(response.statusCode, response.body).toBe(200);
    const { results } = bulkTicketResultSchema.parse(response.json());
    expect(results[0]).toEqual({
      key: 'LST-1',
      ok: false,
      error: { code: 'not_found', message: 'Not found.' },
    });
    expect(results[1]).toMatchObject({
      ok: true,
      ticket: { key: 'OPS-1', priority: { key: 'low' } },
    });
    expect((await ticketRow(ctx.db, 'LST-1'))!.version).toBe(1);

    // And the other way round: Acme cannot reach OPS-1.
    const acme = await bulkOk(['OPS-1'], { priorityId: f.priorityId('acme', 'low') });
    expect(acme.results[0]).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('what a role without assign may do in bulk', () => {
  async function developerWithoutAssign() {
    const [custom] = await ctx.db
      .insert(roles)
      .values({
        organisationId: f.acmeId,
        key: 'no-assign',
        name: 'No assign',
        permissions: ['workspace.view', 'tickets.view', 'tickets.edit'],
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
  }

  it('assigning needs tickets.assign, and refuses the whole request', async () => {
    await developerWithoutAssign();
    const response = await bulk(
      { keys: ['LST-2', 'LST-3'], changes: { assigneeId: f.userId('admin') } },
      'developer',
    );
    expect(response.statusCode).toBe(403);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('forbidden');
    expect((await ticketRow(ctx.db, 'LST-2'))!.assigneeId).toBeNull();

    // Un-assigning is assigning too.
    const clear = await bulk({ keys: ['LST-1'], changes: { assigneeId: null } }, 'developer');
    expect(clear.statusCode).toBe(403);

    // Everything else still works.
    const ok = await bulk(
      { keys: ['LST-2'], changes: { priorityId: f.priorityId('acme', 'low') } },
      'developer',
    );
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe('malformed requests', () => {
  const priorityId = () => f.priorityId('acme', 'low');
  const many = (n: number) => Array.from({ length: n }, (_, i) => `LST-${i + 1}`);

  it('refuses more than 100 keys, none, or duplicates', async () => {
    for (const keys of [many(101), [], ['LST-1', 'LST-1']]) {
      const response = await bulk({ keys, changes: { priorityId: priorityId() } });
      expect(response.statusCode).toBe(422);
      expect(apiErrorSchema.parse(response.json()).error.details?.map((d) => d.path)).toEqual([
        'keys',
      ]);
    }
    expect((await ticketRow(ctx.db, 'LST-1'))!.version).toBe(1);
  });

  it('accepts exactly 100 keys, most of them unknown', async () => {
    const { results } = await bulkOk(many(100), { priorityId: priorityId() });
    expect(results).toHaveLength(100);
    // Twelve tickets exist and one of them is archived.
    expect(results.filter((r) => r.ok)).toHaveLength(11);
  });

  it('refuses no changes, unknown changes and bad values', async () => {
    const bad = [
      { keys: ['LST-1'], changes: {} },
      { keys: ['LST-1'] },
      { keys: ['LST-1'], changes: { title: 'Nope' } },
      { keys: ['LST-1'], changes: { statusKey: 'Not A Key' } },
      { keys: ['LST-1'], changes: { priorityId: 'high' } },
      { keys: ['LST-1'], changes: { dueDate: '2031-02-30' } },
      { keys: ['LST-1'], changes: { archived: 'yes' } },
      {
        keys: ['LST-1'],
        changes: {
          addLabelIds: [f.labelId('acme', 'bug'), f.labelId('acme', 'docs')],
          removeLabelIds: [f.labelId('acme', 'docs')],
        },
      },
      { keys: ['LST-1'], changes: { archived: true }, extra: 1 },
    ];
    for (const payload of bad) {
      const response = await bulk(payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
  });
});
