import {
  apiErrorSchema,
  describeTicketEvent,
  ticketDetailSchema,
  timelineItemSchema,
} from '@forge/shared';
import { tickets, users } from '@forge/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;
let f: Facts;

const ARCHIVED_MESSAGE = 'This ticket is archived. Unarchive it to change it.';

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

const setParent = async (
  key: string,
  parentKey: string | null,
  as = 'developer',
  orgId = f.acmeId,
) =>
  ctx.app.inject({
    method: 'PUT',
    url: `/api/v1/orgs/${orgId}/tickets/${key}/parent`,
    payload: { parentKey },
    headers: { cookie: await ctx.cookieFor(as) },
  });

const parentOk = async (key: string, parentKey: string | null) => {
  const response = await setParent(key, parentKey);
  expect(response.statusCode, response.body).toBe(200);
  return ticketDetailSchema.parse(response.json());
};

const refusal = async (key: string, parentKey: string | null, status: number) => {
  const response = await setParent(key, parentKey);
  expect(response.statusCode, response.body).toBe(status);
  return apiErrorSchema.parse(response.json()).error;
};

const historyOf = async (key: string) => {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/timeline`,
    headers: { cookie: await ctx.cookieFor('owner') },
  });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as unknown[])
    .map((item) => timelineItemSchema.parse(item))
    .flatMap((item) =>
      item.kind === 'event' ? [describeTicketEvent(item.event, item.actor!.displayName)] : [],
    );
};

const developerName = async () =>
  (
    await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, f.userId('developer')))
  )[0]!.displayName;

const parentIdOf = async (key: string) =>
  (
    await ctx.db
      .select({ parentId: tickets.parentId })
      .from(tickets)
      .where(and(eq(tickets.organisationId, f.acmeId), eq(tickets.key, key)))
  )[0]!.parentId;

const patch = async (key: string, payload: object, as = 'developer') =>
  ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}`,
    payload,
    headers: { cookie: await ctx.cookieFor(as) },
  });

const archive = async (key: string) => {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/archive`,
    headers: { cookie: await ctx.cookieFor('developer') },
  });
  expect(response.statusCode, response.body).toBe(200);
};

describe('setting a ticket parent', () => {
  it('sets, changes and clears a parent, with history on every ticket involved', async () => {
    const name = await developerName();

    await parentOk('WEB-2', 'WEB-1');
    expect(await parentIdOf('WEB-2')).toBe(f.ticket('WEB-1').id);

    await parentOk('WEB-2', 'WEB-3');
    expect(await parentIdOf('WEB-2')).toBe(f.ticket('WEB-3').id);

    await parentOk('WEB-2', null);
    expect(await parentIdOf('WEB-2')).toBeNull();

    expect(await historyOf('WEB-2')).toEqual(
      expect.arrayContaining([
        `${name} set the parent to WEB-1`,
        `${name} set the parent to WEB-3`,
        `${name} removed the parent WEB-3`,
      ]),
    );
    for (const parent of ['WEB-1', 'WEB-3']) {
      expect(await historyOf(parent)).toEqual(
        expect.arrayContaining([
          `${name} added WEB-2 as a child`,
          `${name} removed WEB-2 from its children`,
        ]),
      );
    }
  });

  it('changes nothing and writes no history when the parent is already that ticket', async () => {
    await parentOk('WEB-2', 'WEB-1');
    const before = (await historyOf('WEB-2')).length;
    await parentOk('WEB-2', 'WEB-1');
    expect((await historyOf('WEB-2')).length).toBe(before);
  });

  it('allows a parent in another project of the same workspace', async () => {
    await parentOk('API-1', 'WEB-1');
    expect(await parentIdOf('API-1')).toBe(f.ticket('WEB-1').id);
  });

  it('refuses a ticket as its own parent', async () => {
    const error = await refusal('WEB-1', 'WEB-1', 422);
    expect(error.details).toEqual([
      { path: 'parentKey', message: "A ticket can't be its own parent." },
    ]);
  });

  it('refuses a loop', async () => {
    await parentOk('WEB-2', 'WEB-1');
    const error = await refusal('WEB-1', 'WEB-2', 422);
    expect(error.details).toEqual([
      { path: 'parentKey', message: "WEB-2 is already under WEB-1, so it can't be its parent." },
    ]);
  });

  it('refuses a fourth level', async () => {
    await parentOk('WEB-2', 'WEB-1');
    await parentOk('WEB-3', 'WEB-2');
    const error = await refusal('WEB-4', 'WEB-3', 422);
    expect(error.details).toEqual([
      {
        path: 'parentKey',
        message: "WEB-3 is already at the third level, so it can't have children.",
      },
    ]);
  });

  it('refuses a fourth level through the subtree', async () => {
    await parentOk('WEB-9', 'WEB-4'); // WEB-4 has a sub-task
    await parentOk('WEB-2', 'WEB-1');
    const error = await refusal('WEB-4', 'WEB-2', 422);
    expect(error.details).toEqual([
      {
        path: 'parentKey',
        message:
          "WEB-4 already has sub-tasks, so it can't go under WEB-2; that would make four levels.",
      },
    ]);
    // Under a top-level ticket it fits: three levels.
    await parentOk('WEB-4', 'WEB-1');
  });

  it('refuses a parent for an epic', async () => {
    const response = await patch('WEB-1', {
      version: f.ticket('WEB-1').version,
      typeId: f.typeId('acme', 'epic'),
    });
    expect(response.statusCode, response.body).toBe(200);
    const error = await refusal('WEB-1', 'WEB-2', 422);
    expect(error.details).toEqual([
      { path: 'parentKey', message: "An epic is always top level, so it can't have a parent." },
    ]);
    // An epic can be a parent.
    await parentOk('WEB-2', 'WEB-1');
  });

  it('refuses changing the type to Epic while the ticket has a parent', async () => {
    await parentOk('WEB-2', 'WEB-1');
    const response = await patch('WEB-2', {
      version: f.ticket('WEB-2').version,
      typeId: f.typeId('acme', 'epic'),
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(apiErrorSchema.parse(response.json()).error.details).toEqual([
      { path: 'typeId', message: 'An epic is always top level; remove its parent first.' },
    ]);
  });

  it('refuses an archived parent and an archived child', async () => {
    await archive('WEB-1');
    expect((await refusal('WEB-2', 'WEB-1', 409)).message).toBe(ARCHIVED_MESSAGE);
    expect((await refusal('WEB-1', 'WEB-2', 409)).message).toBe(ARCHIVED_MESSAGE);
  });

  it('refuses a parent in an archived project', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/orgs/${f.acmeId}/projects/API`,
      payload: { archived: true },
      headers: { cookie: await ctx.cookieFor('owner') },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((await refusal('WEB-2', 'API-1', 409)).message).toBe('API-1 is in an archived project.');
  });

  it('keeps the parent of a ticket in an archived project', async () => {
    await parentOk('API-2', 'API-1');
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/orgs/${f.acmeId}/projects/API`,
      payload: { archived: true },
      headers: { cookie: await ctx.cookieFor('owner') },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((await refusal('API-2', null, 409)).message).toBe('API-2 is in an archived project.');
    expect(await parentIdOf('API-2')).toBe(f.ticket('API-1').id);
  });

  it('lets a child be taken out of an archived parent', async () => {
    await parentOk('WEB-2', 'WEB-1');
    await archive('WEB-1');
    await parentOk('WEB-2', null);
    expect(await parentIdOf('WEB-2')).toBeNull();
  });

  it('changes neither ticket version', async () => {
    const detail = await parentOk('WEB-2', 'WEB-1');
    expect(detail.version).toBe(f.ticket('WEB-2').version);
    const [parent] = await ctx.db
      .select({ version: tickets.version })
      .from(tickets)
      .where(eq(tickets.id, f.ticket('WEB-1').id));
    expect(parent!.version).toBe(f.ticket('WEB-1').version);
  });

  it('needs tickets.edit', async () => {
    const response = await setParent('WEB-2', 'WEB-1', 'readonly');
    expect(response.statusCode).toBe(403);
    expect(await parentIdOf('WEB-2')).toBeNull();
  });

  it('answers 404 for an unknown ticket, and names a parent that does not exist here', async () => {
    expect((await setParent('WEB-999', 'WEB-1')).statusCode).toBe(404);
    expect((await refusal('WEB-2', 'WEB-999', 422)).details).toEqual([
      { path: 'parentKey', message: 'There is no ticket WEB-999 in this workspace.' },
    ]);
    // OPS-1 lives in another workspace.
    expect((await refusal('WEB-2', 'OPS-1', 422)).details).toEqual([
      { path: 'parentKey', message: 'There is no ticket OPS-1 in this workspace.' },
    ]);
    expect((await setParent('OPS-1', null)).statusCode).toBe(404);
  });
});
