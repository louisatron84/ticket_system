import { apiErrorSchema, ticketDetailSchema } from '@forge/shared';
import { tickets } from '@forge/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;
let f: Facts;

// The demo data: WEB-5 is an epic over WEB-8, WEB-11 and WEB-12; WEB-10 is a sub-task of WEB-8.

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

const addChild = async (parentKey: string, as = 'developer', extra: object = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${parentKey}/children`,
    payload: {
      title: 'Restyle the date picker',
      typeId: f.typeId('acme', 'task'),
      priorityId: f.priorityId('acme', 'normal'),
      ...extra,
    },
    headers: { cookie: await ctx.cookieFor(as) },
  });

const webCount = async () =>
  (
    await ctx.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          eq(tickets.organisationId, f.acmeId),
          eq(tickets.projectId, f.ticket('WEB-1').projectId),
        ),
      )
  ).length;

describe('adding a new child ticket', () => {
  it('makes the ticket in the parent’s project and puts it under the parent in one go', async () => {
    const response = await addChild('WEB-5');
    expect(response.statusCode, response.body).toBe(201);
    const child = ticketDetailSchema.parse(response.json());
    expect(child.key).toBe('WEB-13');
    expect(child.parentKey).toBe('WEB-5');
    expect(child.ancestors.map((a) => a.key)).toEqual(['WEB-5']);
  });

  it('makes nothing when the parent cannot take a child', async () => {
    const before = await webCount();
    const response = await addChild('WEB-10');
    expect(response.statusCode).toBe(422);
    expect(apiErrorSchema.parse(response.json()).error.message).toBe(
      "WEB-10 is already at the third level, so it can't have children.",
    );
    expect(await webCount()).toBe(before);
  });

  it('makes nothing when the parent is archived', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-5/archive`,
      headers: { cookie: await ctx.cookieFor('developer') },
    });
    const before = await webCount();
    expect((await addChild('WEB-5')).statusCode).toBe(409);
    expect(await webCount()).toBe(before);
  });

  it('needs the right to create and to edit', async () => {
    expect((await addChild('WEB-5', 'readonly')).statusCode).toBe(403);
  });
});

describe('duplicates', () => {
  it('refuses marking the original as a duplicate of its own duplicate', async () => {
    const first = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-2/mark-duplicate`,
      payload: { originalKey: 'WEB-8' },
      headers: { cookie: await ctx.cookieFor('developer') },
    });
    expect(first.statusCode, first.body).toBe(200);

    const back = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-8/mark-duplicate`,
      payload: { originalKey: 'WEB-2' },
      headers: { cookie: await ctx.cookieFor('developer') },
    });
    expect(back.statusCode).toBe(422);
    expect(apiErrorSchema.parse(back.json()).error.message).toBe(
      "WEB-2 is already a duplicate of WEB-8, so WEB-8 can't be a duplicate of it.",
    );
    const linkBack = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-8/links`,
      payload: { choice: 'duplicates', otherKey: 'WEB-2' },
      headers: { cookie: await ctx.cookieFor('developer') },
    });
    expect(linkBack.statusCode).toBe(422);
  });
});
