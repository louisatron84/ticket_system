import {
  apiErrorSchema,
  bulkTicketResultSchema,
  describeTicketEvent,
  projectSchema,
  ticketDetailSchema,
  timelineItemSchema,
  type LinkChoice,
} from '@forge/shared';
import { ticketLinks, tickets, users } from '@forge/db';
import { and, eq } from 'drizzle-orm';
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

const as = async (identity = 'developer') => ({ cookie: await ctx.cookieFor(identity) });

const link = async (key: string, choice: LinkChoice, otherKey: string) => {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/links`,
    payload: { choice, otherKey },
    headers: await as(),
  });
  expect(response.statusCode, response.body).toBe(201);
};

/** Moves a ticket by status key, starting from the version it has now. */
const move = async (key: string, statusKey: string) => {
  const row = (await ticketRow(ctx.db, key))!;
  const [projectKey] = key.split('-') as [string];
  return ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}`,
    payload: { version: row.version, statusId: f.statusId(projectKey, statusKey) },
    headers: await as(),
  });
};

const moveOk = async (key: string, statusKey: string) => {
  const response = await move(key, statusKey);
  expect(response.statusCode, response.body).toBe(200);
};

const refusedMove = async (key: string, statusKey: string) => {
  const response = await move(key, statusKey);
  expect(response.statusCode, response.body).toBe(422);
  return apiErrorSchema.parse(response.json()).error.details;
};

const archive = async (key: string) => {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/archive`,
    headers: await as(),
  });
  expect(response.statusCode, response.body).toBe(200);
};

const markDuplicate = async (key: string, originalKey: string) =>
  ctx.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/mark-duplicate`,
    payload: { originalKey },
    headers: await as(),
  });

const historyOf = async (key: string) => {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/timeline`,
    headers: await as('owner'),
  });
  return (response.json() as unknown[])
    .map((item) => timelineItemSchema.parse(item))
    .flatMap((item) =>
      item.kind === 'event' ? [describeTicketEvent(item.event, item.actor!.displayName)] : [],
    );
};

const setRule = async (projectKey: string, on: boolean, identity = 'owner') =>
  ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/orgs/${f.acmeId}/projects/${projectKey}`,
    payload: { blockersStopCompletion: on },
    headers: await as(identity),
  });

// Seed statuses used here: WEB-1 In the Forge, WEB-3 Tempering, WEB-5 In the Forge, WEB-9 Scrapped,
// API-1 In the Forge, API-2 Quenched, API-4 and API-6 Warming.
describe('the blocker rule', () => {
  it('refuses done while a blocker is open', async () => {
    await link('WEB-1', 'blocked_by', 'API-4');
    expect(await refusedMove('WEB-1', 'done')).toEqual([
      { path: 'statusId', message: "WEB-1 can't be quenched while API-4 is open." },
    ]);
  });

  it('lists every open blocker in the message', async () => {
    await link('WEB-1', 'blocked_by', 'API-6');
    await link('WEB-1', 'blocked_by', 'API-4');
    expect(await refusedMove('WEB-1', 'done')).toEqual([
      { path: 'statusId', message: "WEB-1 can't be quenched while API-4 and API-6 are open." },
    ]);
  });

  it('allows scrapping a blocked ticket', async () => {
    await link('WEB-1', 'blocked_by', 'API-4');
    await moveOk('WEB-1', 'cancelled');
  });

  it('allows done once the blocker is quenched', async () => {
    await link('WEB-1', 'blocked_by', 'API-1');
    await moveOk('API-1', 'done');
    await moveOk('WEB-1', 'done');
  });

  it('a reopened blocker blocks again', async () => {
    await link('WEB-3', 'blocked_by', 'API-2');
    await moveOk('API-2', 'open');
    expect(await refusedMove('WEB-3', 'done')).toEqual([
      { path: 'statusId', message: "WEB-3 can't be quenched while API-2 is open." },
    ]);
  });

  it('a scrapped blocker no longer blocks', async () => {
    await link('WEB-1', 'blocked_by', 'WEB-9');
    await moveOk('WEB-1', 'done');
  });

  it('an archived open blocker still blocks', async () => {
    await link('WEB-1', 'blocked_by', 'API-4');
    await archive('API-4');
    expect(await refusedMove('WEB-1', 'done')).toEqual([
      { path: 'statusId', message: "WEB-1 can't be quenched while API-4 is open." },
    ]);
  });

  it('follows the blocked ticket’s project setting, wherever the blocker lives', async () => {
    await link('WEB-1', 'blocked_by', 'API-4');
    expect((await setRule('WEB', false)).statusCode).toBe(200);
    await moveOk('WEB-1', 'done');

    // API's rule is still on, so API-1 blocked by WEB-2 cannot be quenched.
    await link('API-1', 'blocked_by', 'WEB-2');
    expect(await refusedMove('API-1', 'done')).toEqual([
      { path: 'statusId', message: "API-1 can't be quenched while WEB-2 is open." },
    ]);
  });

  it('bulk edit reports the refusal for that ticket only', async () => {
    await link('WEB-1', 'blocked_by', 'API-4');
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/bulk`,
      payload: { keys: ['WEB-1', 'WEB-5'], changes: { statusKey: 'done' } },
      headers: await as(),
    });
    expect(response.statusCode, response.body).toBe(200);
    const { results } = bulkTicketResultSchema.parse(response.json());
    expect(results.map((r) => (r.ok ? `${r.key} ok` : `${r.key}: ${r.error.message}`))).toEqual([
      "WEB-1: WEB-1 can't be quenched while API-4 is open.",
      'WEB-5 ok',
    ]);
  });

  it('remembers the status before Jammed and forgets it on leaving', async () => {
    const before = async () => (await ticketRow(ctx.db, 'WEB-1'))!.statusBeforeJamId;
    await moveOk('WEB-1', 'blocked');
    expect(await before()).toBe(f.statusId('WEB', 'in_progress'));
    await moveOk('WEB-1', 'in_progress');
    expect(await before()).toBeNull();
  });
});

describe('the project setting', () => {
  it('is on by default, and only someone who manages projects can change it', async () => {
    const read = async () =>
      projectSchema.parse(
        (
          await ctx.app.inject({
            method: 'GET',
            url: `/api/v1/orgs/${f.acmeId}/projects`,
            headers: await as('owner'),
          })
        ).json()[0],
      );
    expect((await read()).blockersStopCompletion).toBe(true);

    expect((await setRule('WEB', false, 'developer')).statusCode).toBe(403);
    const off = await setRule('WEB', false);
    expect(off.statusCode, off.body).toBe(200);
    expect(projectSchema.parse(off.json()).blockersStopCompletion).toBe(false);
    const on = await setRule('WEB', true);
    expect(projectSchema.parse(on.json()).blockersStopCompletion).toBe(true);
  });
});

describe('marking a ticket as a duplicate', () => {
  it('links and scraps it in one go', async () => {
    const response = await markDuplicate('WEB-2', 'WEB-8');
    expect(response.statusCode, response.body).toBe(200);
    const detail = ticketDetailSchema.parse(response.json());
    expect(detail.status.key).toBe('cancelled');
    expect(detail.links.map((l) => `${l.label} ${l.ticket.key}`)).toEqual(['Duplicates WEB-8']);

    const name = (
      await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, f.userId('developer')))
    )[0]!.displayName;
    expect(await historyOf('WEB-2')).toEqual(
      expect.arrayContaining([`${name} marked this as a duplicate of WEB-8`]),
    );
    expect(await historyOf('WEB-8')).toEqual(
      expect.arrayContaining([`${name} added a link: duplicated by WEB-2`]),
    );
  });

  it('works on a blocked ticket, since scrapping is always allowed', async () => {
    await link('WEB-1', 'blocked_by', 'API-4');
    expect((await markDuplicate('WEB-1', 'WEB-8')).statusCode).toBe(200);
  });

  it('refuses a quenched ticket and changes nothing', async () => {
    const response = await markDuplicate('WEB-6', 'WEB-8');
    expect(response.statusCode, response.body).toBe(422);
    expect(apiErrorSchema.parse(response.json()).error.details).toEqual([
      { path: 'statusId', message: "WEB-6 can't be scrapped from Quenched." },
    ]);
    expect(
      await ctx.db.select().from(ticketLinks).where(eq(ticketLinks.kind, 'duplicates')),
    ).toHaveLength(0);
    const [row] = await ctx.db
      .select({ statusId: tickets.statusId })
      .from(tickets)
      .where(and(eq(tickets.organisationId, f.acmeId), eq(tickets.key, 'WEB-6')));
    expect(row!.statusId).toBe(f.statusId('WEB', 'done'));
  });

  it('refuses an archived original, itself, and a ticket that does not exist', async () => {
    await archive('WEB-8');
    expect((await markDuplicate('WEB-2', 'WEB-8')).statusCode).toBe(409);
    const self = await markDuplicate('WEB-2', 'WEB-2');
    expect(self.statusCode).toBe(422);
    expect(apiErrorSchema.parse(self.json()).error.details).toEqual([
      { path: 'originalKey', message: "A ticket can't be a duplicate of itself." },
    ]);
    const missing = await markDuplicate('WEB-2', 'WEB-999');
    expect(apiErrorSchema.parse(missing.json()).error.details).toEqual([
      { path: 'originalKey', message: 'There is no ticket WEB-999 in this workspace.' },
    ]);
  });

  it('needs tickets.edit', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-2/mark-duplicate`,
      payload: { originalKey: 'WEB-8' },
      headers: await as('readonly'),
    });
    expect(response.statusCode).toBe(403);
  });
});
