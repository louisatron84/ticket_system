import {
  apiErrorSchema,
  describeTicketEvent,
  ticketDetailSchema,
  timelineItemSchema,
  type LinkChoice,
} from '@forge/shared';
import { ticketLinks, users } from '@forge/db';
import { eq } from 'drizzle-orm';
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

const addLink = async (key: string, choice: LinkChoice, otherKey: string, as = 'developer') =>
  ctx.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/links`,
    payload: { choice, otherKey },
    headers: { cookie: await ctx.cookieFor(as) },
  });

const linkOk = async (key: string, choice: LinkChoice, otherKey: string) => {
  const response = await addLink(key, choice, otherKey);
  expect(response.statusCode, response.body).toBe(201);
  return ticketDetailSchema.parse(response.json());
};

const removeLink = async (key: string, linkId: string, as = 'developer') =>
  ctx.app.inject({
    method: 'DELETE',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/links/${linkId}`,
    headers: { cookie: await ctx.cookieFor(as) },
  });

const detailOf = async (key: string) => {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}`,
    headers: { cookie: await ctx.cookieFor('owner') },
  });
  expect(response.statusCode, response.body).toBe(200);
  return ticketDetailSchema.parse(response.json());
};

/** Each link as "<label> <other key>", the way the page lists them. */
const linksOf = async (key: string) =>
  (await detailOf(key)).links.map((link) => `${link.label} ${link.ticket.key}`);

const historyOf = async (key: string) => {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/timeline`,
    headers: { cookie: await ctx.cookieFor('owner') },
  });
  return (response.json() as unknown[])
    .map((item) => timelineItemSchema.parse(item))
    .flatMap((item) =>
      item.kind === 'event' ? [describeTicketEvent(item.event, item.actor!.displayName)] : [],
    );
};

const archive = async (key: string) =>
  ctx.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/archive`,
    headers: { cookie: await ctx.cookieFor('developer') },
  });

describe('ticket links', () => {
  it('adds each kind and shows it from both sides with the right label', async () => {
    await linkOk('WEB-1', 'blocks', 'WEB-2');
    await linkOk('WEB-3', 'blocked_by', 'WEB-1');
    await linkOk('WEB-1', 'relates_to', 'WEB-4');
    await linkOk('WEB-1', 'duplicates', 'WEB-5');
    await linkOk('WEB-1', 'duplicated_by', 'WEB-6');

    expect(await linksOf('WEB-1')).toEqual([
      'Blocks WEB-2',
      'Blocks WEB-3',
      'Relates to WEB-4',
      'Duplicates WEB-5',
      'Duplicated by WEB-6',
    ]);
    expect(await linksOf('WEB-2')).toEqual(['Blocked by WEB-1']);
    expect(await linksOf('WEB-3')).toEqual(['Blocked by WEB-1']);
    expect(await linksOf('WEB-4')).toEqual(['Relates to WEB-1']);
    expect(await linksOf('WEB-5')).toEqual(['Duplicated by WEB-1']);
    expect(await linksOf('WEB-6')).toEqual(['Duplicates WEB-1']);
  });

  it('answers with the ticket it was added from', async () => {
    const detail = await linkOk('WEB-2', 'blocked_by', 'WEB-1');
    expect(detail.key).toBe('WEB-2');
    expect(detail.links.map((l) => [l.label, l.ticket.key])).toEqual([['Blocked by', 'WEB-1']]);
  });

  it('stores relates-to once, whichever side adds it', async () => {
    await linkOk('WEB-2', 'relates_to', 'WEB-1');
    const again = await addLink('WEB-1', 'relates_to', 'WEB-2');
    expect(again.statusCode, again.body).toBe(409);
    expect(apiErrorSchema.parse(again.json()).error.message).toBe(
      'These tickets are already linked that way.',
    );
    expect(
      await ctx.db.select().from(ticketLinks).where(eq(ticketLinks.kind, 'relates_to')),
    ).toHaveLength(1);
  });

  it('refuses the same link twice', async () => {
    await linkOk('WEB-1', 'blocks', 'WEB-2');
    const again = await addLink('WEB-2', 'blocked_by', 'WEB-1');
    expect(again.statusCode).toBe(409);
  });

  it('refuses a self link', async () => {
    const response = await addLink('WEB-1', 'relates_to', 'WEB-1');
    expect(response.statusCode).toBe(422);
    expect(apiErrorSchema.parse(response.json()).error.details).toEqual([
      { path: 'otherKey', message: "A ticket can't be linked to itself." },
    ]);
  });

  it('refuses A blocks B when B already blocks A', async () => {
    await linkOk('API-4', 'blocks', 'WEB-3');
    const response = await addLink('WEB-3', 'blocks', 'API-4');
    expect(response.statusCode).toBe(422);
    expect(apiErrorSchema.parse(response.json()).error.details).toEqual([
      { path: 'otherKey', message: "WEB-3 is already blocked by API-4, so it can't block it." },
    ]);
  });

  it('allows two kinds between the same pair, across projects', async () => {
    await linkOk('WEB-1', 'blocks', 'API-1');
    await linkOk('WEB-1', 'relates_to', 'API-1');
    expect(await linksOf('API-1')).toEqual(['Blocked by WEB-1', 'Relates to WEB-1']);
  });

  it('names a ticket that does not exist in this workspace', async () => {
    for (const other of ['WEB-999', 'OPS-1', 'nonsense']) {
      const response = await addLink('WEB-1', 'blocks', other);
      expect(response.statusCode).toBe(422);
      expect(apiErrorSchema.parse(response.json()).error.details).toEqual([
        { path: 'otherKey', message: `There is no ticket ${other} in this workspace.` },
      ]);
    }
    expect((await addLink('WEB-999', 'blocks', 'WEB-1')).statusCode).toBe(404);
  });

  it('refuses an archived ticket on either side', async () => {
    expect((await archive('WEB-2')).statusCode).toBe(200);
    for (const [key, other] of [
      ['WEB-1', 'WEB-2'],
      ['WEB-2', 'WEB-1'],
    ] as const) {
      const response = await addLink(key, 'relates_to', other);
      expect(response.statusCode).toBe(409);
      expect(apiErrorSchema.parse(response.json()).error.message).toBe(ARCHIVED_MESSAGE);
    }
  });

  it('removes a link from either side, even when one side is archived', async () => {
    const detail = await linkOk('WEB-1', 'blocks', 'WEB-2');
    const linkId = detail.links[0]!.id;
    expect((await archive('WEB-1')).statusCode).toBe(200);

    const response = await removeLink('WEB-2', linkId);
    expect(response.statusCode, response.body).toBe(204);
    expect(await linksOf('WEB-1')).toEqual([]);
    expect(await linksOf('WEB-2')).toEqual([]);
  });

  it('answers 404 for a link that does not touch the ticket in the address', async () => {
    const detail = await linkOk('WEB-1', 'blocks', 'WEB-2');
    expect((await removeLink('WEB-3', detail.links[0]!.id)).statusCode).toBe(404);
    expect((await removeLink('WEB-1', '01a1656b-1a49-7146-94ac-1c72df43ddb4')).statusCode).toBe(
      404,
    );
    expect((await removeLink('WEB-1', 'not-an-id')).statusCode).toBe(404);
  });

  it('writes history on both tickets', async () => {
    const name = (
      await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, f.userId('developer')))
    )[0]!.displayName;
    const detail = await linkOk('WEB-2', 'blocked_by', 'API-4');
    await removeLink('WEB-2', detail.links[0]!.id);

    expect(await historyOf('WEB-2')).toEqual(
      expect.arrayContaining([
        `${name} added a link: blocked by API-4`,
        `${name} removed a link: blocked by API-4`,
      ]),
    );
    expect(await historyOf('API-4')).toEqual(
      expect.arrayContaining([
        `${name} added a link: blocks WEB-2`,
        `${name} removed a link: blocks WEB-2`,
      ]),
    );
  });

  it('needs tickets.edit to add or remove', async () => {
    expect((await addLink('WEB-1', 'blocks', 'WEB-2', 'readonly')).statusCode).toBe(403);
    const detail = await linkOk('WEB-1', 'blocks', 'WEB-2');
    expect((await removeLink('WEB-1', detail.links[0]!.id, 'readonly')).statusCode).toBe(403);
  });
});
