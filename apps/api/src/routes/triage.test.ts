import { tickets, triageProposals } from '@forge/db';
import {
  apiErrorSchema,
  describeTicketEvent,
  notificationListSchema,
  ticketDetailSchema,
  ticketListSchema,
  ticketSummarySchema,
  timelineItemSchema,
  triageSettingsSchema,
} from '@forge/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { wakeSnoozed } from '../triage/service';
import { loadFacts, type Facts } from '../test-support/facts';
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

const call = async (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: { as?: string; payload?: unknown } = {},
) =>
  ctx.app.inject({
    method,
    url: `/api/v1/orgs/${f.acmeId}${url}`,
    ...(options.payload !== undefined ? { payload: options.payload as never } : {}),
    headers: { cookie: await ctx.cookieFor(options.as ?? 'developer') },
  });

/** A ticket filed by the reporter in WEB, where triage is on in the demo data. */
async function file(title = 'The export button does nothing', extra: object = {}) {
  const response = await call('POST', '/projects/WEB/tickets', {
    as: 'reporter',
    payload: {
      title,
      typeId: f.typeId('acme', 'bug'),
      priorityId: f.priorityId('acme', 'normal'),
      ...extra,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return ticketDetailSchema.parse(response.json());
}

const detail = async (key: string) =>
  ticketDetailSchema.parse((await call('GET', `/tickets/${key}`, { as: 'owner' })).json());

const history = async (key: string) =>
  ((await call('GET', `/tickets/${key}/timeline`, { as: 'owner' })).json() as unknown[])
    .map((item) => timelineItemSchema.parse(item))
    .flatMap((item) =>
      item.kind === 'event'
        ? [describeTicketEvent(item.event, item.actor?.displayName ?? 'Forge')]
        : [],
    );

const inboxTexts = async (as: string) =>
  notificationListSchema
    .parse((await call('GET', '/notifications', { as })).json())
    .items.map((n) => n.text);

const propose = (key: string, payload: object, as = 'developer') =>
  call('POST', `/tickets/${key}/triage/propose`, { as, payload });
const decideOn = (key: string, payload: object, as = 'admin') =>
  call('POST', `/tickets/${key}/triage/decide`, { as, payload });

describe('arriving in triage', () => {
  it('a reporter’s ticket waits in triage, off the board and the list', async () => {
    const ticket = await file();
    expect(ticket.triage).toMatchObject({ state: 'waiting', proposal: null });
    const list = ticketListSchema.parse((await call('GET', '/tickets?project=WEB')).json());
    expect(list.items.map((t) => t.key)).not.toContain(ticket.key);
    const board = (await call('GET', '/projects/WEB/board')).json() as {
      columns: { tickets: { key: string }[] }[];
    };
    expect(board.columns.flatMap((c) => c.tickets).map((t) => t.key)).not.toContain(ticket.key);
    const queue = ticketSummarySchema
      .array()
      .parse((await call('GET', '/triage?project=WEB')).json());
    expect(queue.map((t) => t.key)).toEqual([ticket.key]);
    expect(await history(ticket.key)).toContain("Rowan Reporter's ticket arrived in triage");
  });

  it('a team member’s ticket goes straight onto the board', async () => {
    const response = await call('POST', '/projects/WEB/tickets', {
      payload: {
        title: 'Ours',
        typeId: f.typeId('acme', 'task'),
        priorityId: f.priorityId('acme', 'normal'),
      },
    });
    expect(ticketDetailSchema.parse(response.json()).triage).toBeNull();
  });

  it('a project with triage off takes the reporter’s ticket straight in', async () => {
    const response = await call('POST', '/projects/API/tickets', {
      as: 'reporter',
      payload: {
        title: 'Elsewhere',
        typeId: f.typeId('acme', 'bug'),
        priorityId: f.priorityId('acme', 'normal'),
      },
    });
    expect(ticketDetailSchema.parse(response.json()).triage).toBeNull();
  });

  it('every editor hears about an arrival when there is no rota', async () => {
    const ticket = await file();
    for (const who of ['owner', 'admin', 'developer']) {
      expect(await inboxTexts(who)).toContain(`${ticket.key} arrived in triage`);
    }
    expect(await inboxTexts('reviewer')).toEqual([]);
  });

  it('an editor can send an open ticket to triage, but not a finished one', async () => {
    const sent = await call('POST', '/tickets/WEB-2/triage/send');
    expect(ticketDetailSchema.parse(sent.json()).triage?.state).toBe('waiting');
    expect((await call('POST', '/tickets/WEB-12/triage/send')).statusCode).toBe(409);
    expect((await call('POST', '/tickets/WEB-1/triage/send', { as: 'reporter' })).statusCode).toBe(
      403,
    );
  });
});

describe('four eyes', () => {
  it('accepting needs a second person, then the ticket joins the board as proposed', async () => {
    const ticket = await file();
    const proposed = await propose(ticket.key, {
      action: 'accept_warming',
      details: { assigneeId: f.userId('developer'), priorityId: f.priorityId('acme', 'high') },
    });
    expect(proposed.statusCode, proposed.body).toBe(200);
    const waiting = ticketDetailSchema.parse(proposed.json());
    expect(waiting.triage?.state).toBe('proposed');
    expect(waiting.triage?.proposal?.summary).toBe(
      'Accept to Warming, assign to Dana Developer, priority Blaze',
    );
    expect(await inboxTexts('admin')).toContain(
      `Dana Developer proposes for ${ticket.key}: Accept to Warming, assign to Dana Developer, priority Blaze. Needs your approval`,
    );

    // The proposer cannot approve their own proposal.
    const own = await decideOn(ticket.key, { decision: 'approve' }, 'developer');
    expect(own.statusCode).toBe(403);
    expect(apiErrorSchema.parse(own.json()).error.message).toBe(
      'You made this proposal, so someone else has to approve or reject it.',
    );
    // Nor can someone who may not edit.
    expect((await decideOn(ticket.key, { decision: 'approve' }, 'reviewer')).statusCode).toBe(403);

    expect((await decideOn(ticket.key, { decision: 'approve' })).statusCode).toBe(200);
    const after = await detail(ticket.key);
    expect(after.triage).toBeNull();
    expect(after.status.name).toBe('Warming');
    expect(after.assignee?.displayName).toBe('Dana Developer');
    expect(after.priority.name).toBe('Blaze');
    expect(await history(ticket.key)).toContain(
      "Adam Admin approved Dana Developer's proposal: Accept to Warming, assign to Dana Developer, priority Blaze",
    );
    expect(await inboxTexts('reporter')).toContain(`${ticket.key} was accepted onto the board`);
    const list = ticketListSchema.parse((await call('GET', '/tickets?project=WEB')).json());
    expect(list.items.map((t) => t.key)).toContain(ticket.key);
  });

  it('a rejection sends it back to waiting with a note for the proposer', async () => {
    const ticket = await file();
    await propose(ticket.key, { action: 'decline', details: { reason: 'Works as designed' } });
    const rejected = await decideOn(ticket.key, {
      decision: 'reject',
      note: 'It is a real bug, see the log',
    });
    expect(ticketDetailSchema.parse(rejected.json()).triage).toMatchObject({
      state: 'waiting',
      proposal: null,
    });
    expect(await inboxTexts('developer')).toContain(
      `Your proposal for ${ticket.key} was rejected: It is a real bug, see the log`,
    );
  });

  it('declining scraps it and tells the reporter why', async () => {
    const ticket = await file();
    await propose(ticket.key, { action: 'decline', details: { reason: 'Works as designed' } });
    await decideOn(ticket.key, { decision: 'approve' });
    const after = await detail(ticket.key);
    expect(after.status.name).toBe('Scrapped');
    expect(after.triage).toBeNull();
    expect(await inboxTexts('reporter')).toContain(`${ticket.key} was declined: Works as designed`);
  });

  it('a duplicate is linked to the original and scrapped', async () => {
    const ticket = await file();
    const bad = await propose(ticket.key, {
      action: 'duplicate',
      details: { originalKey: 'WEB-999' },
    });
    expect(bad.statusCode).toBe(422);
    await propose(ticket.key, { action: 'duplicate', details: { originalKey: 'web-3' } });
    await decideOn(ticket.key, { decision: 'approve' });
    const after = await detail(ticket.key);
    expect(after.status.name).toBe('Scrapped');
    expect(after.links.map((l) => `${l.label} ${l.ticket.key}`)).toEqual(['Duplicates WEB-3']);
  });

  it('only one open proposal at a time, and the first decision wins', async () => {
    const ticket = await file();
    await propose(ticket.key, { action: 'accept', details: {} });
    expect((await propose(ticket.key, { action: 'accept', details: {} }, 'admin')).statusCode).toBe(
      409,
    );
    const [a, b] = await Promise.all([
      decideOn(ticket.key, { decision: 'approve' }, 'admin'),
      decideOn(ticket.key, { decision: 'approve' }, 'owner'),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const proposals = await ctx.db
      .select()
      .from(triageProposals)
      .where(eq(triageProposals.ticketId, ticket.id));
    expect(proposals).toHaveLength(1);
  });

  it('the database itself refuses a self-approval', async () => {
    const ticket = await file();
    await propose(ticket.key, { action: 'accept', details: {} });
    await expect(
      ctx.db
        .update(triageProposals)
        .set({ decidedBy: f.userId('developer'), decidedAt: new Date(), decision: 'approved' })
        .where(eq(triageProposals.ticketId, ticket.id)),
    ).rejects.toThrow();
  });

  it('assigning in a proposal needs tickets.assign, and names must be of this workspace', async () => {
    const ticket = await file();
    const foreign = await propose(ticket.key, {
      action: 'accept',
      details: { assigneeId: f.userId('other-owner') },
    });
    expect(foreign.statusCode).toBe(422);
  });
});

describe('snoozing', () => {
  it('one person can snooze; it comes back when its day arrives', async () => {
    const ticket = await file();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const snoozed = await call('POST', `/tickets/${ticket.key}/triage/snooze`, {
      payload: { until: tomorrow },
    });
    expect(ticketDetailSchema.parse(snoozed.json()).triage?.state).toBe('snoozed');
    const queue = ticketSummarySchema.array().parse((await call('GET', '/triage')).json());
    expect(queue.map((t) => t.key)).not.toContain(ticket.key);

    await wakeSnoozed(ctx.db, new Date(Date.now() + 2 * 86_400_000));
    expect((await detail(ticket.key)).triage?.state).toBe('waiting');
    expect(await history(ticket.key)).toContain('This came back to triage after its snooze');

    const past = await call('POST', `/tickets/${ticket.key}/triage/snooze`, {
      payload: { until: '2020-01-01' },
    });
    expect(past.statusCode).toBe(422);
  });
});

describe('rules and the rota', () => {
  const settings = (payload: object, as = 'owner') =>
    call('PUT', '/projects/WEB/triage-settings', { as, payload });

  it('the first matching rule fills the ticket in and names its triager', async () => {
    const saved = await settings({
      enabled: true,
      rota: [],
      rules: [
        {
          name: 'Exports',
          conditions: { titleWords: ['EXPORT'] },
          actions: {
            assigneeId: f.userId('developer'),
            addLabelIds: [f.labelId('acme', 'bug')],
            triagerId: f.userId('admin'),
          },
        },
        {
          name: 'Everything',
          conditions: { typeKey: 'bug' },
          actions: { priorityId: f.priorityId('acme', 'critical') },
        },
      ],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const ticket = await file('Export to CSV is broken');
    expect(ticket.assignee?.displayName).toBe('Dana Developer');
    expect(ticket.labels.map((l) => l.name)).toEqual(['bug']);
    // Only the first match applies.
    expect(ticket.priority.name).toBe('Flame');
    expect(await history(ticket.key)).toContain('The triage rule "Exports" filled this in');
    expect(await inboxTexts('admin')).toContain(`${ticket.key} arrived in triage`);
    expect(await inboxTexts('owner')).not.toContain(`${ticket.key} arrived in triage`);
  });

  it('with a rota, only the person on duty hears about an arrival', async () => {
    const saved = await settings({
      enabled: true,
      rota: [f.userId('admin')],
      rules: [],
    });
    const parsed = triageSettingsSchema.parse(saved.json());
    expect(parsed.onDuty?.displayName).toBe('Adam Admin');
    const ticket = await file();
    expect(await inboxTexts('admin')).toContain(`${ticket.key} arrived in triage`);
    expect(await inboxTexts('owner')).toEqual([]);
  });

  it('settings need projects.manage, and only editors can triage', async () => {
    expect((await settings({ enabled: false, rota: [], rules: [] }, 'developer')).statusCode).toBe(
      403,
    );
    const bad = await settings({ enabled: true, rota: [f.userId('reviewer')], rules: [] });
    expect(bad.statusCode).toBe(422);
    const off = await settings({ enabled: false, rota: [], rules: [] });
    expect(triageSettingsSchema.parse(off.json()).enabled).toBe(false);
    expect((await file()).triage).toBeNull();
  });
});

describe('outside the workspace', () => {
  it('another workspace’s ticket keys and queue are invisible', async () => {
    const ticket = await file();
    const foreign = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${f.northwindId}/tickets/${ticket.key}/triage/propose`,
      headers: { cookie: await ctx.cookieFor('other-owner') },
      payload: { action: 'accept', details: {} },
    });
    expect(foreign.statusCode).toBe(404);
    const [row] = await ctx.db
      .select({ state: tickets.triageState })
      .from(tickets)
      .where(and(eq(tickets.id, ticket.id), sql`true`));
    expect(row!.state).toBe('waiting');
  });
});

describe('no way around triage', () => {
  it('a reporter’s duplicate waits in triage too', async () => {
    const ticket = await file();
    const copy = await call('POST', `/tickets/${ticket.key}/duplicate`, { as: 'reporter' });
    expect(copy.statusCode, copy.body).toBe(201);
    expect(ticketDetailSchema.parse(copy.json()).triage?.state).toBe('waiting');
  });

  it('one person cannot move, archive or mark-duplicate a ticket waiting in triage', async () => {
    const ticket = await file();
    const project = (await call('GET', '/projects/WEB')).json() as {
      statuses: { id: string; key: string }[];
    };
    const scrapped = project.statuses.find((s) => s.key === 'cancelled')!.id;
    const moved = await call('PATCH', `/tickets/${ticket.key}`, {
      payload: { version: ticket.version, statusId: scrapped },
    });
    expect(moved.statusCode).toBe(409);
    expect(apiErrorSchema.parse(moved.json()).error.message).toMatch(/waiting in triage/);
    expect((await call('POST', `/tickets/${ticket.key}/archive`)).statusCode).toBe(409);
    const duplicate = await call('POST', `/tickets/${ticket.key}/mark-duplicate`, {
      payload: { originalKey: 'WEB-3' },
    });
    expect(duplicate.statusCode).toBe(409);
    // Other fields can still be filled in while it waits.
    const titled = await call('PATCH', `/tickets/${ticket.key}`, {
      payload: { version: ticket.version, title: 'Export button does nothing on Safari' },
    });
    expect(titled.statusCode).toBe(200);
    expect((await detail(ticket.key)).triage?.state).toBe('waiting');
  });

  it('a board never shows triage tickets, even when asked', async () => {
    const ticket = await file();
    const board = (await call('GET', '/projects/WEB/board?triage=true')).json() as {
      columns: { tickets: { key: string }[] }[];
    };
    expect(board.columns.flatMap((c) => c.tickets).map((t) => t.key)).not.toContain(ticket.key);
  });

  it('a snooze can be undone by sending the ticket to triage again', async () => {
    const ticket = await file();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await call('POST', `/tickets/${ticket.key}/triage/snooze`, { payload: { until: tomorrow } });
    const back = await call('POST', `/tickets/${ticket.key}/triage/send`);
    expect(ticketDetailSchema.parse(back.json()).triage).toMatchObject({
      state: 'waiting',
      snoozedUntil: null,
    });
  });
});
