import { projects, statusTransitions, ticketComments, ticketEvents, tickets } from '@forge/db';
import {
  projectDetailSchema,
  type BulkTicketResult,
  ticketDetailSchema,
  workflowSchema,
  type TransitionRule,
} from '@forge/shared';
import { and, asc, eq } from 'drizzle-orm';
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

/** Puts rules on one transition of a project, straight in the database. */
async function setRules(projectKey: string, from: string, to: string, rules: TransitionRule[]) {
  await ctx.db
    .update(statusTransitions)
    .set({ rules })
    .where(
      and(
        eq(statusTransitions.fromStatusId, f.statusId(projectKey, from)),
        eq(statusTransitions.toStatusId, f.statusId(projectKey, to)),
      ),
    );
}

async function move(key: string, to: string, extra: object = {}, as = 'developer') {
  const row = (await ticketRow(ctx.db, key))!;
  const projectKey = key.split('-')[0]!;
  return ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}`,
    payload: { version: row.version, statusId: f.statusId(projectKey, to), ...extra },
    headers: { cookie: await ctx.cookieFor(as) },
  });
}

const messageOf = (response: { json(): unknown }) =>
  (response.json() as { error: { details: { message: string }[] } }).error.details[0]!.message;

const statusKeyOf = async (key: string) => {
  const row = (await ticketRow(ctx.db, key))!;
  return row.statusId;
};

describe('a move along a transition with rules', () => {
  it('needs an assignee, which the same request may give', async () => {
    // WEB-11 is in Warming and unassigned.
    await setRules('WEB', 'open', 'in_progress', ['needs_assignee']);
    const refused = await move('WEB-11', 'in_progress');
    expect(refused.statusCode).toBe(422);
    expect(messageOf(refused)).toBe('Moving to In the Forge needs an assignee.');
    expect(await statusKeyOf('WEB-11')).toBe(f.statusId('WEB', 'open'));

    const allowed = await move('WEB-11', 'in_progress', { assigneeId: f.userId('developer') });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().status.key).toBe('in_progress');
  });

  it('needs an estimate', async () => {
    await setRules('WEB', 'open', 'in_progress', ['needs_estimate']);
    const refused = await move('WEB-2', 'in_progress');
    expect(refused.statusCode).toBe(422);
    expect(messageOf(refused)).toBe('Moving to In the Forge needs an estimate.');
    expect((await move('WEB-2', 'in_progress', { estimateMinutes: 90 })).statusCode).toBe(200);
  });

  it('needs an estimate in points when the project estimates in points', async () => {
    await setRules('WEB', 'open', 'in_progress', ['needs_estimate']);
    await ctx.db.update(projects).set({ estimation: 'points' }).where(eq(projects.key, 'WEB'));
    // Minutes do not count in a points project.
    const refused = await move('WEB-2', 'in_progress', { estimateMinutes: 90 });
    expect(refused.statusCode).toBe(422);
    expect(messageOf(refused)).toBe('Moving to In the Forge needs an estimate.');
    expect((await move('WEB-2', 'in_progress', { estimatePoints: 3 })).statusCode).toBe(200);
  });

  it('needs a comment, which is added in the same change, after the move', async () => {
    await setRules('WEB', 'open', 'in_progress', ['needs_comment']);
    const refused = await move('WEB-2', 'in_progress');
    expect(refused.statusCode).toBe(422);
    expect(messageOf(refused)).toBe('Moving to In the Forge needs a comment.');

    const response = await move('WEB-2', 'in_progress', { comment: '  Starting on it now. ' });
    expect(response.statusCode).toBe(200);
    const detail = ticketDetailSchema
      .pick({ commentCount: true, status: true })
      .parse(response.json());
    expect(detail).toMatchObject({ commentCount: 1, status: { key: 'in_progress' } });

    const ticket = f.ticket('WEB-2');
    const comments = await ctx.db
      .select()
      .from(ticketComments)
      .where(eq(ticketComments.ticketId, ticket.id));
    expect(comments.map((c) => ({ body: c.body, authorId: c.authorId }))).toEqual([
      { body: 'Starting on it now.', authorId: f.userId('developer') },
    ]);
    const events = await ctx.db
      .select({ type: ticketEvents.type })
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, ticket.id))
      .orderBy(asc(ticketEvents.createdAt));
    const types = events.map((e) => e.type);
    expect(types.indexOf('comment.added')).toBeGreaterThan(types.indexOf('ticket.status_changed'));
  });

  it('needs no open blockers, naming them', async () => {
    await setRules('WEB', 'open', 'in_progress', ['no_open_blockers']);
    const link = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-2/links`,
      payload: { choice: 'blocked_by', otherKey: 'WEB-4' },
      headers: { cookie: await ctx.cookieFor('developer') },
    });
    expect(link.statusCode).toBe(201);
    const refused = await move('WEB-2', 'in_progress');
    expect(refused.statusCode).toBe(422);
    expect(messageOf(refused)).toBe(
      'Moving to In the Forge needs its blockers completed first: WEB-4 is still open.',
    );
    // Without the rule, the move is fine (the project rule only guards completion).
    await setRules('WEB', 'open', 'in_progress', []);
    expect((await move('WEB-2', 'in_progress')).statusCode).toBe(200);
  });

  it('lists every rule it breaks, and a rule-free move is not affected', async () => {
    await setRules('WEB', 'open', 'in_progress', [
      'needs_assignee',
      'needs_estimate',
      'needs_comment',
    ]);
    const refused = await move('WEB-11', 'in_progress');
    expect(refused.statusCode).toBe(422);
    const details = (refused.json() as { error: { details: { message: string }[] } }).error.details;
    expect(details.map((d) => d.message)).toEqual([
      'Moving to In the Forge needs an assignee.',
      'Moving to In the Forge needs an estimate.',
      'Moving to In the Forge needs a comment.',
    ]);
    // Rules are on the transition, not the status: another way in has none.
    expect((await move('WEB-11', 'blocked')).statusCode).toBe(200);
  });

  it('refuses a comment with no move, or with no status at all', async () => {
    const same = await move('WEB-2', 'open', { comment: 'Hello' });
    expect(same.statusCode).toBe(422);
    expect(messageOf(same)).toBe(
      'WEB-2 is already in Warming, so there is no move for the comment to go with.',
    );
    const row = (await ticketRow(ctx.db, 'WEB-2'))!;
    const none = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-2`,
      payload: { version: row.version, comment: 'Hello' },
      headers: { cookie: await ctx.cookieFor('developer') },
    });
    expect(none.statusCode).toBe(422);
    const empty = await move('WEB-2', 'in_progress', { comment: '   ' });
    expect(empty.statusCode).toBe(422);
  });

  it('carries a comment on any move, rule or not', async () => {
    const response = await move('WEB-2', 'in_progress', { comment: 'Picked up.' });
    expect(response.statusCode).toBe(200);
    expect(response.json().commentCount).toBe(1);
  });
});

describe('bulk moves', () => {
  it('refuse each ticket whose move needs a comment, and move the others', async () => {
    await setRules('WEB', 'open', 'in_progress', ['needs_comment']);
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/bulk`,
      payload: { keys: ['WEB-2', 'API-4'], changes: { statusKey: 'in_progress' } },
      headers: { cookie: await ctx.cookieFor('developer') },
    });
    expect(response.statusCode).toBe(200);
    const { results } = response.json() as BulkTicketResult;
    expect(results[0]).toMatchObject({
      key: 'WEB-2',
      ok: false,
      error: { message: 'Moving to In the Forge needs a comment.' },
    });
    expect(results[1]).toMatchObject({ key: 'API-4', ok: true });
    const [web2] = await ctx.db.select().from(tickets).where(eq(tickets.key, 'WEB-2'));
    expect(web2!.statusId).toBe(f.statusId('WEB', 'open'));
  });
});

describe('what the read paths say about rules', () => {
  it('shows them on the ticket, the project and the workflows', async () => {
    await setRules('WEB', 'open', 'in_progress', ['needs_comment', 'needs_assignee']);
    const get = async (url: string) =>
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/orgs/${f.acmeId}${url}`,
          headers: { cookie: await ctx.cookieFor('developer') },
        })
      ).json();

    const detail = ticketDetailSchema
      .pick({ allowedTransitions: true })
      .parse(await get('/tickets/WEB-2'));
    expect(detail.allowedTransitions.find((s) => s.key === 'in_progress')!.rules).toEqual([
      'needs_comment',
      'needs_assignee',
    ]);
    expect(detail.allowedTransitions.find((s) => s.key === 'blocked')!.rules).toEqual([]);

    const open = f.statusId('WEB', 'open');
    const inProgress = f.statusId('WEB', 'in_progress');
    const project = projectDetailSchema.parse(await get('/projects/WEB'));
    expect(
      project.transitions.find((t) => t.fromStatusId === open && t.toStatusId === inProgress)!
        .rules,
    ).toEqual(['needs_comment', 'needs_assignee']);

    const workflows = z.array(workflowSchema).parse(await get('/workflows'));
    const web = workflows.find((w) => w.projectKey === 'WEB')!;
    expect(
      web.transitions.find((t) => t.fromStatusId === open && t.toStatusId === inProgress)!.rules,
    ).toEqual(['needs_comment', 'needs_assignee']);
  });
});
