import {
  auditEvents,
  components,
  labels,
  notifications,
  organisationMemberships,
  priorities,
  roles,
  ticketLabels,
  ticketTypes,
  tickets,
} from '@forge/db';
import {
  componentSettingSchema,
  labelDeleteResultSchema,
  labelMergeResultSchema,
  prioritySettingSchema,
  projectComponentSettingsSchema,
  ticketConfigSchema,
  ticketTypeSettingSchema,
  workspaceTicketSettingsSchema,
} from '@forge/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, ticketRow, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';

const SOME_ID = '01a1656b-1a49-7146-94ac-1c72df43ddb4';

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

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** A request as a seeded identity (or nobody), to a path under an organisation (Acme by default). */
async function call(
  method: Method,
  path: string,
  options: { as?: string | null; payload?: unknown; orgId?: string } = {},
) {
  const as = options.as === undefined ? 'owner' : options.as;
  return ctx.app.inject({
    method,
    url: `/api/v1/orgs/${options.orgId ?? f.acmeId}${path}`,
    ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
    headers: as ? { cookie: await ctx.cookieFor(as) } : {},
  });
}

const config = async (as = 'owner') =>
  ticketConfigSchema.parse((await call('GET', '/ticket-config', { as })).json());

const audits = (action: string) =>
  ctx.db.select().from(auditEvents).where(eq(auditEvents.action, action));

const createTicket = (projectKey: string, payload: Record<string, unknown>, as = 'owner') =>
  call('POST', `/projects/${projectKey}/tickets`, {
    as,
    payload: {
      title: 'A new ticket',
      typeId: f.typeId('acme', 'task'),
      priorityId: f.priorityId('acme', 'normal'),
      ...payload,
    },
  });

const editTicket = async (key: string, payload: Record<string, unknown>, as = 'owner') =>
  call('PATCH', `/tickets/${key}`, {
    as,
    payload: { version: (await ticketRow(ctx.db, key))!.version, ...payload },
  });

const identities: [string, number][] = [
  ['owner', 200],
  ['admin', 200],
  ['developer', 403],
  ['reviewer', 403],
  ['readonly', 403],
  ['restricted', 403],
  ['reporter', 403],
  ['other-owner', 404],
];

// ---------------------------------------------------------------------------
// The settings read
// ---------------------------------------------------------------------------

describe('reading the workspace ticket settings', () => {
  it.each(identities)('%s gets %i', async (as, expected) => {
    expect((await call('GET', '/ticket-settings', { as })).statusCode).toBe(expected);
  });

  it('answers 401 to someone who is not signed in', async () => {
    expect((await call('GET', '/ticket-settings', { as: null })).statusCode).toBe(401);
  });

  it('lists types in order, priorities least urgent first and labels, with ticket counts', async () => {
    const settings = workspaceTicketSettingsSchema.parse(
      (await call('GET', '/ticket-settings')).json(),
    );
    expect(settings.types.map((t) => t.key)).toEqual([
      'task',
      'bug',
      'feature',
      'improvement',
      'epic',
      'documentation',
      'support',
    ]);
    expect(settings.priorities.map((p) => p.key)).toEqual([
      'lowest',
      'low',
      'normal',
      'high',
      'critical',
    ]);
    expect(settings.types.every((t) => t.active)).toBe(true);

    const bugTickets = await ctx.db
      .select()
      .from(ticketLabels)
      .where(eq(ticketLabels.labelId, f.labelId('acme', 'bug')));
    expect(settings.labels.find((l) => l.name === 'bug')!.ticketCount).toBe(bugTickets.length);
    expect(bugTickets.length).toBeGreaterThan(0);
    // Every Acme ticket has exactly one type, archived ones included.
    const total = settings.types.reduce((sum, t) => sum + t.ticketCount, 0);
    expect(total).toBe(
      (await ctx.db.select().from(tickets).where(eq(tickets.organisationId, f.acmeId))).length,
    );
  });

  it("shows Northwind only Northwind's labels", async () => {
    const settings = workspaceTicketSettingsSchema.parse(
      (await call('GET', '/ticket-settings', { as: 'other-owner', orgId: f.northwindId })).json(),
    );
    expect(settings.labels.map((l) => l.name)).toEqual(['bug', 'ops']);
  });
});

// ---------------------------------------------------------------------------
// Ticket types
// ---------------------------------------------------------------------------

describe('ticket types', () => {
  const addType = (name: unknown, as = 'owner', orgId?: string) =>
    call('POST', '/ticket-types', { as, payload: { name }, ...(orgId ? { orgId } : {}) });
  const patchType = (id: string, payload: unknown, as = 'owner', orgId?: string) =>
    call('PATCH', `/ticket-types/${id}`, { as, payload, ...(orgId ? { orgId } : {}) });

  describe('who may add one', () => {
    it.each(identities)('%s gets %i (201 for success)', async (as, expected) => {
      const before = (await ctx.db.select().from(ticketTypes)).length;
      const response = await addType('Spike', as);
      expect(response.statusCode).toBe(expected === 200 ? 201 : expected);
      expect((await ctx.db.select().from(ticketTypes)).length).toBe(
        before + (expected === 200 ? 1 : 0),
      );
    });

    it('answers 401 to someone who is not signed in', async () => {
      expect(
        (await call('POST', '/ticket-types', { as: null, payload: { name: 'X' } })).statusCode,
      ).toBe(401);
    });
  });

  it('adds one at the end with a key made from its name, offers it, and audits it', async () => {
    const response = await addType('  Tech debt  ');
    expect(response.statusCode).toBe(201);
    const created = ticketTypeSettingSchema.parse(response.json());
    expect(created).toMatchObject({
      key: 'tech-debt',
      name: 'Tech debt',
      active: true,
      ticketCount: 0,
    });

    const types = (await config('developer')).types;
    expect(types.at(-1)).toMatchObject({ id: created.id, key: 'tech-debt', active: true });

    const [event] = await audits('ticket_type.created');
    expect(event).toMatchObject({
      organisationId: f.acmeId,
      actorUserId: f.userId('owner'),
      targetType: 'ticket_type',
      after: { key: 'tech-debt', name: 'Tech debt' },
    });

    // And a ticket can have it straight away.
    expect((await createTicket('WEB', { typeId: created.id })).statusCode).toBe(201);
  });

  it('gives a clashing key a number, and a name with no usable letters a plain key', async () => {
    const bugs = ticketTypeSettingSchema.parse((await addType('Bug!')).json());
    expect(bugs.key).toBe('bug-2');
    const again = ticketTypeSettingSchema.parse((await addType('Bug?')).json());
    expect(again.key).toBe('bug-3');
    const japanese = ticketTypeSettingSchema.parse((await addType('不具合')).json());
    expect(japanese).toMatchObject({ key: 'type', name: '不具合' });
  });

  describe('refuses a name already used, whatever its case, with 409', () => {
    it.each(['Bug', 'BUG', '  bug  ', 'support REQUEST'])('%j', async (name) => {
      const response = await addType(name);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('conflict');
      expect(await audits('ticket_type.created')).toHaveLength(0);
    });
  });

  describe('refuses bad input with 422', () => {
    it.each([
      ['no name', undefined],
      ['a blank name', '   '],
      ['41 characters', 'a'.repeat(41)],
      ['a line break', 'a\nb'],
      ['not text', 7],
    ])('%s', async (_label, name) => {
      expect((await addType(name)).statusCode).toBe(422);
    });

    it('a key the client chose', async () => {
      const response = await call('POST', '/ticket-types', { payload: { name: 'X', key: 'x' } });
      expect(response.statusCode).toBe(422);
    });
  });

  it('renames one without changing its key, and tickets show the new name', async () => {
    const bug = f.typeId('acme', 'bug');
    const response = await patchType(bug, { name: 'Defect' });
    expect(response.statusCode).toBe(200);
    expect(ticketTypeSettingSchema.parse(response.json())).toMatchObject({
      id: bug,
      key: 'bug',
      name: 'Defect',
    });
    const [event] = await audits('ticket_type.updated');
    expect(event).toMatchObject({
      targetId: 'bug',
      before: { name: 'Bug', active: true },
      after: { name: 'Defect', active: true },
    });
    // Renaming to its own name in another case is fine; to another's is not.
    expect((await patchType(bug, { name: 'DEFECT' })).statusCode).toBe(200);
    expect((await patchType(bug, { name: 'task' })).statusCode).toBe(409);
  });

  it('cannot be changed through another workspace, or by a made-up id', async () => {
    const bug = f.typeId('acme', 'bug');
    expect((await patchType(bug, { name: 'Mine' }, 'other-owner', f.northwindId)).statusCode).toBe(
      404,
    );
    expect((await patchType(f.typeId('northwind', 'bug'), { name: 'Mine' })).statusCode).toBe(404);
    expect((await patchType(SOME_ID, { name: 'Mine' })).statusCode).toBe(404);
    expect((await patchType('not-an-id', { name: 'Mine' })).statusCode).toBe(404);
    const [row] = await ctx.db.select().from(ticketTypes).where(eq(ticketTypes.id, bug));
    expect(row!.name).toBe('Bug');
  });

  describe('deactivated', () => {
    it('is flagged in the config, refused for new tickets and changes, kept by tickets', async () => {
      const bug = f.typeId('acme', 'bug');
      expect((await patchType(bug, { active: false })).statusCode).toBe(200);
      expect((await config('developer')).types.find((t) => t.id === bug)).toMatchObject({
        active: false,
      });

      const create = await createTicket('WEB', { typeId: bug }, 'developer');
      expect(create.statusCode).toBe(422);
      expect(create.json().error.details).toEqual([
        {
          path: 'typeId',
          message: 'The ticket type Bug is no longer in use. Choose another type.',
        },
      ]);

      // A ticket that is a bug stays one, shows it, and can still be edited.
      const keyOfBug = (
        await ctx.db
          .select({ key: tickets.key })
          .from(tickets)
          .where(and(eq(tickets.typeId, bug), isNull(tickets.archivedAt)))
      )[0]!.key;
      const read = await call('GET', `/tickets/${keyOfBug}`, { as: 'developer' });
      expect(read.json().type).toMatchObject({ id: bug, name: 'Bug' });
      const edit = await editTicket(keyOfBug, { title: 'Still a bug', typeId: bug }, 'developer');
      expect(edit.statusCode).toBe(200);
      expect(edit.json().type.id).toBe(bug);

      // Another ticket cannot become one.
      const other = await editTicket('WEB-2', { typeId: bug }, 'developer');
      expect(other.statusCode).toBe(422);
      expect(other.json().error.details[0].path).toBe('typeId');

      // Reactivated, it can be chosen again.
      expect((await patchType(bug, { active: true })).statusCode).toBe(200);
      expect((await createTicket('WEB', { typeId: bug }, 'developer')).statusCode).toBe(201);
    });

    it('cannot leave the workspace without an active type', async () => {
      const types = (await config()).types;
      for (const type of types.slice(1)) {
        expect((await patchType(type.id, { active: false })).statusCode).toBe(200);
      }
      const last = await patchType(types[0]!.id, { active: false });
      expect(last.statusCode).toBe(409);
      expect(last.json().error.message).toBe(
        'Task is the last active ticket type. Add or reactivate another first.',
      );
      // Deactivating one that is already inactive is not "the last" one.
      expect((await patchType(types[1]!.id, { active: false })).statusCode).toBe(200);
    });
  });

  describe('reordering', () => {
    it('takes every type once and stores the new order', async () => {
      const ids = (await config()).types.map((t) => t.id).reverse();
      const response = await call('PUT', '/ticket-types/order', { payload: { ids } });
      expect(response.statusCode).toBe(200);
      expect(response.json().map((t: { id: string }) => t.id)).toEqual(ids);
      expect((await config('developer')).types.map((t) => t.id)).toEqual(ids);
      expect(await audits('ticket_type.reordered')).toHaveLength(1);
    });

    it.each([
      ['one missing', (ids: string[]) => ids.slice(1)],
      [
        'one from another workspace',
        (ids: string[]) => [...ids.slice(1), f.typeId('northwind', 'bug')],
      ],
      ['one listed twice', (ids: string[]) => [...ids.slice(1), ids[1]!]],
      ['an unknown one added', (ids: string[]) => [...ids, SOME_ID]],
    ])('refuses a list with %s', async (_label, change) => {
      const before = (await config()).types.map((t) => t.id);
      const response = await call('PUT', '/ticket-types/order', {
        payload: { ids: change(before) },
      });
      expect(response.statusCode).toBe(422);
      expect((await config()).types.map((t) => t.id)).toEqual(before);
    });

    it('is for fields.manage only', async () => {
      const ids = (await config()).types.map((t) => t.id);
      expect(
        (await call('PUT', '/ticket-types/order', { as: 'developer', payload: { ids } }))
          .statusCode,
      ).toBe(403);
      expect(
        (await call('PUT', '/ticket-types/order', { as: 'other-owner', payload: { ids } }))
          .statusCode,
      ).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------

describe('priorities', () => {
  const patchPriority = (id: string, payload: unknown, as = 'owner') =>
    call('PATCH', `/priorities/${id}`, { as, payload });

  it.each(identities)('%s adding one gets %i (201 for success)', async (as, expected) => {
    const response = await call('POST', '/priorities', { as, payload: { name: 'Meltdown' } });
    expect(response.statusCode).toBe(expected === 200 ? 201 : expected);
  });

  it('adds one as the most urgent, with a key from its name', async () => {
    const response = await call('POST', '/priorities', { payload: { name: 'Meltdown' } });
    expect(response.statusCode).toBe(201);
    const created = prioritySettingSchema.parse(response.json());
    expect(created).toMatchObject({ key: 'meltdown', rank: 6, active: true });
    expect((await config()).priorities.at(-1)!.id).toBe(created.id);
    expect(await audits('priority.created')).toHaveLength(1);
    expect((await call('POST', '/priorities', { payload: { name: 'inferno' } })).statusCode).toBe(
      409,
    );
  });

  it('reorders: the last listed is the most urgent', async () => {
    const ids = (await config()).priorities.map((p) => p.id).reverse();
    const response = await call('PUT', '/priorities/order', { payload: { ids } });
    expect(response.statusCode).toBe(200);
    const ranked = (await config()).priorities;
    expect(ranked.map((p) => p.id)).toEqual(ids);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(ranked.at(-1)!.key).toBe('lowest');
  });

  it('when inactive, is refused for new tickets, changes and bulk edits, but kept', async () => {
    const high = f.priorityId('acme', 'high');
    expect((await patchPriority(high, { active: false }, 'admin')).statusCode).toBe(200);
    const [event] = await audits('priority.updated');
    expect(event).toMatchObject({ before: { active: true }, after: { active: false } });

    const create = await createTicket('WEB', { priorityId: high });
    expect(create.statusCode).toBe(422);
    expect(create.json().error.details).toEqual([
      {
        path: 'priorityId',
        message: 'The priority Blaze is no longer in use. Choose another priority.',
      },
    ]);

    const bulk = await call('POST', '/tickets/bulk', {
      payload: { keys: ['WEB-2'], changes: { priorityId: high } },
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json().results[0]).toMatchObject({
      ok: false,
      error: { message: 'The priority Blaze is no longer in use. Choose another priority.' },
    });

    // A ticket that has it keeps it through other edits.
    const created = await createTicket('WEB', {});
    const key = created.json().key as string;
    await ctx.db.update(tickets).set({ priorityId: high }).where(eq(tickets.key, key));
    const edit = await editTicket(key, { title: 'Renamed', priorityId: high });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().priority).toMatchObject({ id: high, name: 'Blaze' });
  });

  it('keeps one active priority at least', async () => {
    const ranked = (await config()).priorities;
    for (const priority of ranked.slice(0, -1)) {
      expect((await patchPriority(priority.id, { active: false })).statusCode).toBe(200);
    }
    expect((await patchPriority(ranked.at(-1)!.id, { active: false })).statusCode).toBe(409);
  });

  it('is renamed only by fields.manage, and only in its own workspace', async () => {
    const low = f.priorityId('acme', 'low');
    expect((await patchPriority(low, { name: 'Spark' }, 'developer')).statusCode).toBe(403);
    expect(
      (
        await call('PATCH', `/priorities/${low}`, {
          as: 'other-owner',
          orgId: f.northwindId,
          payload: { name: 'Spark' },
        })
      ).statusCode,
    ).toBe(404);
    const response = await patchPriority(low, { name: 'Spark' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ key: 'low', name: 'Spark' });
    const [row] = await ctx.db.select().from(priorities).where(eq(priorities.id, low));
    expect(row!.name).toBe('Spark');
  });
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe('labels', () => {
  const labelsOf = async (ticketKey: string) =>
    (await call('GET', `/tickets/${ticketKey}`)).json().labels.map((l: { name: string }) => l.name);
  const ticketsWith = async (labelId: string) =>
    (await ctx.db.select().from(ticketLabels).where(eq(ticketLabels.labelId, labelId))).map(
      (row) => row.ticketId,
    );

  describe('renaming and recolouring', () => {
    it.each(identities)('%s gets %i', async (as, expected) => {
      const response = await call('PATCH', `/labels/${f.labelId('acme', 'docs')}`, {
        as,
        payload: { name: 'documentation' },
      });
      expect(response.statusCode).toBe(expected);
    });

    it('changes the name and colour everywhere, and audits it', async () => {
      const docs = f.labelId('acme', 'docs');
      const response = await call('PATCH', `/labels/${docs}`, {
        payload: { name: 'Documentation', color: 'violet' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ id: docs, name: 'Documentation', color: 'violet' });
      expect((await config()).labels.find((l) => l.id === docs)).toMatchObject({
        name: 'Documentation',
        color: 'violet',
      });
      const [event] = await audits('label.updated');
      expect(event).toMatchObject({
        targetId: docs,
        before: { name: 'docs' },
        after: { name: 'Documentation', color: 'violet' },
      });
    });

    it('refuses a name in use (409), an unknown colour (422) and another workspace (404)', async () => {
      const docs = f.labelId('acme', 'docs');
      expect(
        (await call('PATCH', `/labels/${docs}`, { payload: { name: 'BUG' } })).statusCode,
      ).toBe(409);
      expect(
        (await call('PATCH', `/labels/${docs}`, { payload: { color: 'pink' } })).statusCode,
      ).toBe(422);
      expect((await call('PATCH', `/labels/${docs}`, { payload: {} })).statusCode).toBe(422);
      expect(
        (
          await call('PATCH', `/labels/${f.labelId('northwind', 'ops')}`, {
            payload: { name: 'x' },
          })
        ).statusCode,
      ).toBe(404);
    });
  });

  describe('merging', () => {
    it('gives the tickets the other label, removes this one, and says how many', async () => {
      const frontend = f.labelId('acme', 'frontend');
      const bug = f.labelId('acme', 'bug');
      const hadFrontend = await ticketsWith(frontend);
      const hadBug = await ticketsWith(bug);
      // Some tickets have both: they end up with the target once.
      expect(hadFrontend.some((id) => hadBug.includes(id))).toBe(true);

      const response = await call('POST', `/labels/${frontend}/merge`, {
        payload: { intoId: bug },
      });
      expect(response.statusCode).toBe(200);
      expect(labelMergeResultSchema.parse(response.json())).toEqual({
        label: { id: bug, name: 'bug', color: expect.any(String) },
        ticketCount: hadFrontend.length,
      });

      expect(await ctx.db.select().from(labels).where(eq(labels.id, frontend))).toHaveLength(0);
      expect(await ticketsWith(frontend)).toHaveLength(0);
      expect(new Set(await ticketsWith(bug))).toEqual(new Set([...hadFrontend, ...hadBug]));
      expect(await labelsOf('WEB-1')).toEqual(['bug']);

      const [event] = await audits('label.merged');
      expect(event).toMatchObject({
        targetId: frontend,
        before: { name: 'frontend' },
        after: { into: { id: bug, name: 'bug' }, ticketCount: hadFrontend.length },
      });
    });

    it('refuses itself, an unknown label and a label of another workspace, changing nothing', async () => {
      const frontend = f.labelId('acme', 'frontend');
      const before = await ticketsWith(frontend);
      for (const intoId of [frontend, SOME_ID, f.labelId('northwind', 'bug')]) {
        const response = await call('POST', `/labels/${frontend}/merge`, { payload: { intoId } });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.details[0].path).toBe('intoId');
      }
      expect(await ticketsWith(frontend)).toEqual(before);
      expect(await audits('label.merged')).toHaveLength(0);
    });

    it('is for fields.manage, and cannot reach into another workspace', async () => {
      const frontend = f.labelId('acme', 'frontend');
      const bug = f.labelId('acme', 'bug');
      expect(
        (
          await call('POST', `/labels/${frontend}/merge`, {
            as: 'developer',
            payload: { intoId: bug },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await call('POST', `/labels/${frontend}/merge`, {
            as: 'other-owner',
            orgId: f.northwindId,
            payload: { intoId: f.labelId('northwind', 'bug') },
          })
        ).statusCode,
      ).toBe(404);
      expect(await ticketsWith(frontend)).not.toHaveLength(0);
    });
  });

  describe('deleting', () => {
    it('removes it from every ticket, and says how many had it', async () => {
      const security = f.labelId('acme', 'security');
      const had = await ticketsWith(security);
      expect(had.length).toBeGreaterThan(0);

      // The settings read says the count before; the delete says it again.
      const settings = workspaceTicketSettingsSchema.parse(
        (await call('GET', '/ticket-settings')).json(),
      );
      expect(settings.labels.find((l) => l.id === security)!.ticketCount).toBe(had.length);

      const response = await call('DELETE', `/labels/${security}`);
      expect(response.statusCode).toBe(200);
      expect(labelDeleteResultSchema.parse(response.json())).toEqual({ ticketCount: had.length });
      expect(await ticketsWith(security)).toHaveLength(0);
      expect(await ctx.db.select().from(labels).where(eq(labels.id, security))).toHaveLength(0);
      expect((await config()).labels.map((l) => l.id)).not.toContain(security);
      const [event] = await audits('label.deleted');
      expect(event).toMatchObject({
        before: { name: 'security' },
        after: { ticketCount: had.length },
      });
    });

    it.each(identities)('%s gets %i', async (as, expected) => {
      const response = await call('DELETE', `/labels/${f.labelId('acme', 'docs')}`, { as });
      expect(response.statusCode).toBe(expected);
    });

    it('answers 404 for another workspace’s label or a made-up one', async () => {
      expect((await call('DELETE', `/labels/${f.labelId('northwind', 'ops')}`)).statusCode).toBe(
        404,
      );
      expect((await call('DELETE', `/labels/${SOME_ID}`)).statusCode).toBe(404);
      expect(
        await ctx.db
          .select()
          .from(labels)
          .where(eq(labels.id, f.labelId('northwind', 'ops'))),
      ).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

describe('components', () => {
  const manageMatrix: [string, number][] = identities;
  const patchComponent = (id: string, payload: unknown, as = 'owner', projectKey = 'WEB') =>
    call('PATCH', `/projects/${projectKey}/components/${id}`, { as, payload });

  it.each(manageMatrix)('%s reading the component settings gets %i', async (as, expected) => {
    expect((await call('GET', '/projects/WEB/components', { as })).statusCode).toBe(expected);
  });

  it('lists the components with counts, and only people who can see tickets', async () => {
    const response = await call('GET', '/projects/WEB/components');
    const settings = projectComponentSettingsSchema.parse(response.json());
    expect(settings.components.map((c) => c.name)).toEqual(['Checkout', 'Frontend']);
    expect(settings.components.every((c) => c.ticketCount > 0 && c.active)).toBe(true);
    const names = settings.people.map((p) => p.displayName);
    expect(names).toContain('Dana Developer');
    expect(names).not.toContain('Casey Restricted');
    expect(names).not.toContain('Nora Northwind');
  });

  it('renames, sets a lead and a default assignee, and audits it', async () => {
    const frontend = f.componentId('WEB', 'Frontend');
    const response = await patchComponent(frontend, {
      name: 'Web app',
      leadId: f.userId('admin'),
      defaultAssigneeId: f.userId('developer'),
    });
    expect(response.statusCode).toBe(200);
    expect(componentSettingSchema.parse(response.json())).toMatchObject({
      name: 'Web app',
      active: true,
      lead: { id: f.userId('admin'), displayName: 'Adam Admin' },
      defaultAssignee: { id: f.userId('developer'), displayName: 'Dana Developer' },
    });
    const [event] = await audits('component.updated');
    expect(event).toMatchObject({
      targetId: frontend,
      before: { name: 'Frontend', leadId: null, defaultAssigneeId: null },
      after: { name: 'Web app', defaultAssigneeId: f.userId('developer') },
    });

    // Cleared again with null.
    const cleared = await patchComponent(frontend, { leadId: null, defaultAssigneeId: null });
    expect(cleared.json()).toMatchObject({ lead: null, defaultAssignee: null });
  });

  it('refuses a lead or default assignee who cannot see tickets or is not a member', async () => {
    const frontend = f.componentId('WEB', 'Frontend');
    for (const payload of [
      { leadId: f.userId('restricted') },
      { defaultAssigneeId: f.userId('restricted') },
      { defaultAssigneeId: f.userId('other-owner') },
      { leadId: SOME_ID },
    ]) {
      const response = await patchComponent(frontend, payload);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.details[0].path).toBe(Object.keys(payload)[0]);
    }
    const [row] = await ctx.db.select().from(components).where(eq(components.id, frontend));
    expect(row).toMatchObject({ leadId: null, defaultAssigneeId: null });
  });

  it('refuses a name in use in the project with 409', async () => {
    const frontend = f.componentId('WEB', 'Frontend');
    expect((await patchComponent(frontend, { name: 'checkout' })).statusCode).toBe(409);
    expect((await patchComponent(frontend, { name: 'FRONTEND' })).statusCode).toBe(200);
  });

  it('answers 404 through another project, another workspace or a made-up id', async () => {
    const frontend = f.componentId('WEB', 'Frontend');
    expect((await patchComponent(frontend, { name: 'X' }, 'owner', 'API')).statusCode).toBe(404);
    expect((await patchComponent(SOME_ID, { name: 'X' })).statusCode).toBe(404);
    expect(
      (
        await call('PATCH', `/projects/WEB/components/${frontend}`, {
          as: 'other-owner',
          orgId: f.northwindId,
          payload: { name: 'X' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await patchComponent(frontend, { name: 'X' }, 'developer')).statusCode).toBe(403);
    const [row] = await ctx.db.select().from(components).where(eq(components.id, frontend));
    expect(row!.name).toBe('Frontend');
  });

  it('when inactive, is refused for new tickets and changes, but kept by tickets', async () => {
    const checkout = f.componentId('WEB', 'Checkout');
    expect((await patchComponent(checkout, { active: false })).statusCode).toBe(200);
    expect((await config()).components.find((c) => c.id === checkout)).toMatchObject({
      active: false,
    });

    const create = await createTicket('WEB', { componentId: checkout });
    expect(create.statusCode).toBe(422);
    expect(create.json().error.details).toEqual([
      {
        path: 'componentId',
        message: 'The component Checkout is no longer in use. Choose another component.',
      },
    ]);
    // WEB-3 is in Checkout (see the seed) and keeps it through an edit.
    const keeper = await editTicket('WEB-3', { title: 'Kept', componentId: checkout });
    expect(keeper.statusCode).toBe(200);
    expect(keeper.json().component).toMatchObject({ id: checkout, name: 'Checkout' });
    const moved = await editTicket('WEB-2', { componentId: checkout });
    expect(moved.statusCode).toBe(422);

    expect((await patchComponent(checkout, { active: true })).statusCode).toBe(200);
    expect((await createTicket('WEB', { componentId: checkout })).statusCode).toBe(201);
  });

  describe('default assignee', () => {
    const gateway = () => f.componentId('API', 'Gateway');
    const setDefault = (userKey: string) =>
      patchComponent(gateway(), { defaultAssigneeId: f.userId(userKey) }, 'owner', 'API');

    it('takes a new ticket with the component and no assignee, and hears about it', async () => {
      expect((await setDefault('developer')).statusCode).toBe(200);
      // A reporter may not assign, but the default applies whoever creates the ticket.
      const response = await createTicket('API', { componentId: gateway() }, 'reporter');
      expect(response.statusCode).toBe(201);
      const ticket = response.json();
      expect(ticket.assignee).toMatchObject({ id: f.userId('developer') });

      const sent = await ctx.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.ticketId, ticket.id),
            eq(notifications.recipientId, f.userId('developer')),
          ),
        );
      expect(sent.map((n) => n.kind)).toContain('assigned');
    });

    it('leaves a chosen assignee alone, and does nothing without a component', async () => {
      expect((await setDefault('developer')).statusCode).toBe(200);
      const chosen = await createTicket('API', {
        componentId: gateway(),
        assigneeId: f.userId('admin'),
      });
      expect(chosen.json().assignee).toMatchObject({ id: f.userId('admin') });
      const none = await createTicket('API', {});
      expect(none.json().assignee).toBeNull();
    });

    it('is skipped once that person can no longer see tickets', async () => {
      expect((await setDefault('readonly')).statusCode).toBe(200);
      const [restricted] = await ctx.db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.organisationId, f.acmeId), eq(roles.key, 'restricted')));
      await ctx.db
        .update(organisationMemberships)
        .set({ roleId: restricted!.id })
        .where(
          and(
            eq(organisationMemberships.organisationId, f.acmeId),
            eq(organisationMemberships.userId, f.userId('readonly')),
          ),
        );
      const response = await createTicket('API', { componentId: gateway() });
      expect(response.statusCode).toBe(201);
      expect(response.json().assignee).toBeNull();
    });
  });
});
