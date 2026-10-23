import { organisationMemberships, roles, ticketComments, ticketEvents, tickets } from '@forge/db';
import { commentSchema, timelineItemSchema, type TimelineItem } from '@forge/shared';
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

type Call = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: unknown;
  cookie?: string;
};
const call = ({ cookie, payload, ...rest }: Call) =>
  ctx.app.inject({
    ...rest,
    ...(payload === undefined ? {} : { payload: payload as object }),
    headers: cookie ? { cookie } : {},
  });

const base = (key: string, orgId = f.acmeId) => `/api/v1/orgs/${orgId}/tickets/${key}`;
const postComment = (key: string, payload: unknown, cookie?: string, orgId?: string) =>
  call({
    method: 'POST',
    url: `${base(key, orgId)}/comments`,
    payload,
    ...(cookie ? { cookie } : {}),
  });
const editComment = (
  key: string,
  commentId: string,
  payload: unknown,
  cookie?: string,
  orgId?: string,
) =>
  call({
    method: 'PATCH',
    url: `${base(key, orgId)}/comments/${commentId}`,
    payload,
    ...(cookie ? { cookie } : {}),
  });
const deleteComment = (key: string, commentId: string, cookie?: string, orgId?: string) =>
  call({
    method: 'DELETE',
    url: `${base(key, orgId)}/comments/${commentId}`,
    ...(cookie ? { cookie } : {}),
  });
const getTimeline = (key: string, cookie?: string, orgId?: string) =>
  call({ method: 'GET', url: `${base(key, orgId)}/timeline`, ...(cookie ? { cookie } : {}) });

const timelineOf = async (key: string, as = 'owner') => {
  const response = await getTimeline(key, await ctx.cookieFor(as));
  expect(response.statusCode).toBe(200);
  return z.array(timelineItemSchema).parse(response.json());
};

/** Adds a comment through the API and returns it. */
async function comment(key: string, as: string, body = 'Looks good to me') {
  const response = await postComment(key, { body }, await ctx.cookieFor(as));
  expect(response.statusCode).toBe(201);
  return commentSchema.parse(response.json());
}

const commentRows = async (key: string) =>
  ctx.db
    .select()
    .from(ticketComments)
    .where(eq(ticketComments.ticketId, (await ticketRow(ctx.db, key))!.id))
    .orderBy(asc(ticketComments.createdAt), asc(ticketComments.id));
const eventRows = async (key: string) =>
  ctx.db
    .select()
    .from(ticketEvents)
    .where(eq(ticketEvents.ticketId, (await ticketRow(ctx.db, key))!.id))
    .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id));
const allCommentCount = async () => (await ctx.db.select().from(ticketComments)).length;
const allEventCount = async () => (await ctx.db.select().from(ticketEvents)).length;

/** Gives the developer a role that may view and edit tickets but not comment. */
async function developerCannotComment() {
  const [custom] = await ctx.db
    .insert(roles)
    .values({
      organisationId: f.acmeId,
      key: 'no-comment',
      name: 'No comment',
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
}

describe('who may comment', () => {
  const matrix: [string, number][] = [
    ['owner', 201],
    ['admin', 201],
    ['developer', 201],
    ['reviewer', 201],
    ['readonly', 403],
    ['restricted', 403],
    ['other-owner', 404],
  ];

  it.each(matrix)('%s gets %i', async (identity, expected) => {
    const before = await allCommentCount();
    const response = await postComment('WEB-2', { body: 'Hello' }, await ctx.cookieFor(identity));
    expect(response.statusCode).toBe(expected);
    expect(await allCommentCount()).toBe(before + (expected === 201 ? 1 : 0));
  });

  it('answers 401 to someone who is not signed in, and writes nothing', async () => {
    const before = await allCommentCount();
    expect((await postComment('WEB-2', { body: 'Hello' })).statusCode).toBe(401);
    expect(await allCommentCount()).toBe(before);
  });

  it('refuses a member whose role cannot comment, even though it can edit', async () => {
    await developerCannotComment();
    const response = await postComment(
      'WEB-2',
      { body: 'Hello' },
      await ctx.cookieFor('developer'),
    );
    expect(response.statusCode).toBe(403);
  });
});

describe('adding a comment', () => {
  it('credits the author, stores it, and writes one history event', async () => {
    const eventsBefore = (await eventRows('WEB-2')).length;
    const response = await postComment(
      'WEB-2',
      { body: '  Needs a second look  ' },
      await ctx.cookieFor('developer'),
    );
    expect(response.statusCode).toBe(201);
    const created = commentSchema.parse(response.json());
    expect(created).toMatchObject({
      body: 'Needs a second look',
      editedAt: null,
      author: { email: 'developer@acme.test', displayName: 'Dana Developer' },
    });

    const rows = await commentRows('WEB-2');
    expect(rows.at(-1)).toMatchObject({ id: created.id, body: 'Needs a second look' });
    const events = await eventRows('WEB-2');
    expect(events).toHaveLength(eventsBefore + 1);
    expect(events.at(-1)).toMatchObject({
      type: 'comment.added',
      actorUserId: f.userId('developer'),
      source: 'user',
      data: { commentId: created.id },
    });
  });

  it('does not change the ticket itself: no new version, no new updated time', async () => {
    const before = (await ticketRow(ctx.db, 'WEB-2'))!;
    await comment('WEB-2', 'developer');
    const after = (await ticketRow(ctx.db, 'WEB-2'))!;
    expect(after.version).toBe(before.version);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it('finds the ticket whatever the case of its key', async () => {
    const before = (await commentRows('WEB-2')).length;
    const response = await postComment('web-2', { body: 'Hello' }, await ctx.cookieFor('owner'));
    expect(response.statusCode).toBe(201);
    expect(await commentRows('WEB-2')).toHaveLength(before + 1);
  });

  it('stores and returns markup exactly as typed', async () => {
    const body = '<img src=x onerror=alert(1)>\n<script>alert("x")</script> &lt;b&gt;';
    const created = commentSchema.parse(
      (await postComment('WEB-2', { body }, await ctx.cookieFor('owner'))).json(),
    );
    expect(created.body).toBe(body);
    expect((await commentRows('WEB-2')).at(-1)!.body).toBe(body);
  });

  it('round-trips emoji and right-to-left text', async () => {
    const body = 'مرحبا 👋 العالم — naïve café 世界';
    const created = commentSchema.parse(
      (await postComment('WEB-2', { body }, await ctx.cookieFor('owner'))).json(),
    );
    expect(created.body).toBe(body);
    expect(
      (await timelineOf('WEB-2')).some((i) => i.kind === 'comment' && i.comment.body === body),
    ).toBe(true);
  });

  it('keeps line breaks and tabs, and accepts exactly 10,000 characters', async () => {
    const owner = await ctx.cookieFor('owner');
    const lines = 'line one\r\n\tline two';
    expect(
      commentSchema.parse((await postComment('WEB-2', { body: lines }, owner)).json()).body,
    ).toBe(lines);
    expect((await postComment('WEB-2', { body: 'a'.repeat(10_000) }, owner)).statusCode).toBe(201);
  });

  describe('refuses bad input and writes nothing', () => {
    const cases: [string, unknown][] = [
      ['an empty comment', { body: '' }],
      ['a blank comment', { body: ' \n\t ' }],
      ['10,001 characters', { body: 'a'.repeat(10_001) }],
      ['a NUL character', { body: 'a\u0000b' }],
      ['a vertical tab', { body: 'a\u000Bb' }],
      ['no body', {}],
      ['a body that is not text', { body: 42 }],
      [
        'an author the client chose',
        { body: 'Hi', authorId: '01a1656b-1a49-7146-94ac-1c72df43ddb4' },
      ],
      ['a timestamp the client chose', { body: 'Hi', createdAt: '2001-01-01T00:00:00Z' }],
      [
        'a ticket id the client chose',
        { body: 'Hi', ticketId: '01a1656b-1a49-7146-94ac-1c72df43ddb4' },
      ],
    ];

    it.each(cases)('%s → 422', async (_label, payload) => {
      const comments = await allCommentCount();
      const events = await allEventCount();
      const response = await postComment('WEB-2', payload, await ctx.cookieFor('owner'));
      expect(response.statusCode).toBe(422);
      expect(await allCommentCount()).toBe(comments);
      expect(await allEventCount()).toBe(events);
    });
  });

  describe('a ticket that is not there or not theirs gets a plain 404, and writes nothing', () => {
    it.each(['WEB-999', 'WEB-0', 'WEB-012', 'WEB-99999999999', 'WEB-', '..%2Fx', 'OPS-1'])(
      '%s',
      async (key) => {
        const comments = await allCommentCount();
        const response = await postComment(key, { body: 'Hello' }, await ctx.cookieFor('owner'));
        expect(response.statusCode).toBe(404);
        expect(await allCommentCount()).toBe(comments);
      },
    );

    it("a Northwind ticket through Acme's address, and Acme's through Northwind's", async () => {
      const comments = await allCommentCount();
      const nora = await ctx.cookieFor('other-owner');
      const olivia = await ctx.cookieFor('owner');
      const foreign = await postComment('OPS-1', { body: 'Hello' }, olivia, f.acmeId);
      expect((await postComment('OPS-1', { body: 'Hello' }, nora, f.acmeId)).statusCode).toBe(404);
      expect((await postComment('WEB-2', { body: 'Hello' }, nora, f.northwindId)).statusCode).toBe(
        404,
      );
      expect(
        (await postComment('WEB-2', { body: 'Hello' }, olivia, f.northwindId)).statusCode,
      ).toBe(404);
      // The same answer as a ticket that does not exist at all (apart from the request id).
      const missing = await postComment('WEB-999', { body: 'Hello' }, olivia);
      expect(foreign.statusCode).toBe(404);
      expect({ ...foreign.json().error, requestId: '' }).toEqual({
        ...missing.json().error,
        requestId: '',
      });
      expect(await allCommentCount()).toBe(comments);
    });
  });
});

describe('the timeline', () => {
  async function newTicketAs(as: string) {
    const response = await call({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/projects/WEB/tickets`,
      payload: {
        title: 'Timeline ticket',
        typeId: f.typeId('acme', 'bug'),
        priorityId: f.priorityId('acme', 'high'),
      },
      cookie: await ctx.cookieFor(as),
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { key: string; version: number };
  }

  it('lists events and comments together, oldest first, told apart by kind', async () => {
    const ticket = await newTicketAs('developer');
    await comment(ticket.key, 'reviewer', 'First thoughts');
    const moved = await call({
      method: 'PATCH',
      url: base(ticket.key),
      payload: { version: ticket.version, statusId: f.statusId('WEB', 'open') },
      cookie: await ctx.cookieFor('developer'),
    });
    expect(moved.statusCode).toBe(200);
    await comment(ticket.key, 'developer', 'Picking this up');

    const items = await timelineOf(ticket.key);
    expect(items.map((i) => (i.kind === 'comment' ? 'comment' : i.event.type))).toEqual([
      'ticket.created',
      'comment',
      'ticket.status_changed',
      'comment',
    ]);

    const created = items[0] as Extract<TimelineItem, { kind: 'event' }>;
    expect(created.actor).toMatchObject({ displayName: 'Dana Developer' });
    expect(created.event).toEqual({ type: 'ticket.created', data: { title: 'Timeline ticket' } });
    const first = items[1] as Extract<TimelineItem, { kind: 'comment' }>;
    expect(first.comment).toMatchObject({
      body: 'First thoughts',
      author: { displayName: 'Riley Reviewer' },
    });
    // Oldest first, by real time.
    const times = items.map((i) => Date.parse(i.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("shows a seeded ticket's whole history: every comment and every event but the comment ones", async () => {
    const [seeded] = await ctx.db
      .select({ ticketId: ticketComments.ticketId, key: tickets.key })
      .from(ticketComments)
      .innerJoin(tickets, eq(tickets.id, ticketComments.ticketId))
      .limit(1);
    const key = seeded!.key;
    const items = await timelineOf(key);

    const comments = await commentRows(key);
    expect(items.filter((i) => i.kind === 'comment')).toHaveLength(comments.length);
    expect(comments.length).toBeGreaterThan(0);
    const events = (await eventRows(key)).filter(
      (e) => e.type !== 'comment.added' && e.type !== 'comment.edited',
    );
    expect(items.filter((i) => i.kind === 'event')).toHaveLength(events.length);
    const times = items.map((i) => Date.parse(i.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('lists a comment once, however often it was edited, and keeps a record of deleted ones', async () => {
    const mine = await comment('WEB-2', 'reviewer', 'Original');
    await editComment('WEB-2', mine.id, { body: 'Edited' }, await ctx.cookieFor('reviewer'));
    const gone = await comment('WEB-2', 'developer', 'Regrettable');
    await deleteComment('WEB-2', gone.id, await ctx.cookieFor('developer'));

    const items = await timelineOf('WEB-2');
    const shown = items.filter((i) => i.kind === 'comment');
    expect(shown.map((i) => (i as { comment: { id: string } }).comment.id)).toContain(mine.id);
    expect(shown.map((i) => (i as { comment: { id: string } }).comment.id)).not.toContain(gone.id);
    const mineItem = shown.find(
      (i) => (i as { comment: { id: string } }).comment.id === mine.id,
    ) as Extract<TimelineItem, { kind: 'comment' }>;
    expect(mineItem.comment.body).toBe('Edited');
    expect(mineItem.comment.editedAt).not.toBeNull();

    const types = items
      .filter((i) => i.kind === 'event')
      .map((i) => (i as { event: { type: string } }).event.type);
    expect(types).not.toContain('comment.added');
    expect(types).not.toContain('comment.edited');
    expect(types.filter((t) => t === 'comment.deleted')).toHaveLength(1);
  });

  it('is readable by everyone who can view tickets', async () => {
    const matrix: [string, number][] = [
      ['owner', 200],
      ['admin', 200],
      ['developer', 200],
      ['reviewer', 200],
      ['readonly', 200],
      ['restricted', 403],
      ['other-owner', 404],
    ];
    for (const [identity, expected] of matrix) {
      const response = await getTimeline('WEB-2', await ctx.cookieFor(identity));
      expect([identity, response.statusCode]).toEqual([identity, expected]);
    }
    expect((await getTimeline('WEB-2')).statusCode).toBe(401);
  });

  it.each(['WEB-999', 'WEB-0', 'WEB-012', 'WEB-', '..%2Fx', 'OPS-1'])(
    'answers 404 for the ticket key %s',
    async (key) => {
      expect((await getTimeline(key, await ctx.cookieFor('owner'))).statusCode).toBe(404);
    },
  );
});

describe('editing a comment', () => {
  it('lets the author change it, marks it edited, and writes one event', async () => {
    const mine = await comment('WEB-2', 'reviewer', 'First draft');
    const eventsBefore = (await eventRows('WEB-2')).length;
    const response = await editComment(
      'WEB-2',
      mine.id,
      { body: 'Second draft' },
      await ctx.cookieFor('reviewer'),
    );
    expect(response.statusCode).toBe(200);
    const edited = commentSchema.parse(response.json());
    expect(edited).toMatchObject({ id: mine.id, body: 'Second draft', createdAt: mine.createdAt });
    expect(edited.editedAt).not.toBeNull();
    expect(Date.parse(edited.editedAt!)).toBeGreaterThanOrEqual(Date.parse(mine.createdAt));

    const events = await eventRows('WEB-2');
    expect(events).toHaveLength(eventsBefore + 1);
    expect(events.at(-1)).toMatchObject({
      type: 'comment.edited',
      actorUserId: f.userId('reviewer'),
      data: { commentId: mine.id },
    });
  });

  it.each(['owner', 'admin', 'developer', 'readonly'])(
    "refuses %s editing someone else's comment, and changes nothing",
    async (identity) => {
      const theirs = await comment('WEB-2', 'reviewer', 'Mine, not yours');
      const events = await allEventCount();
      const response = await editComment(
        'WEB-2',
        theirs.id,
        { body: 'Hijacked' },
        await ctx.cookieFor(identity),
      );
      expect(response.statusCode).toBe(403);
      expect((await commentRows('WEB-2')).at(-1)).toMatchObject({
        body: 'Mine, not yours',
        editedAt: null,
      });
      expect(await allEventCount()).toBe(events);
    },
  );

  it('refuses an author whose role can no longer comment', async () => {
    const mine = await comment('WEB-2', 'developer', 'Written while allowed');
    await developerCannotComment();
    const response = await editComment(
      'WEB-2',
      mine.id,
      { body: 'Too late' },
      await ctx.cookieFor('developer'),
    );
    expect(response.statusCode).toBe(403);
    expect((await commentRows('WEB-2')).at(-1)!.body).toBe('Written while allowed');
  });

  it('treats the same text as no change: not marked edited, no event', async () => {
    const mine = await comment('WEB-2', 'reviewer', 'Steady');
    const events = await allEventCount();
    const response = await editComment(
      'WEB-2',
      mine.id,
      { body: '  Steady  ' },
      await ctx.cookieFor('reviewer'),
    );
    expect(response.statusCode).toBe(200);
    expect(commentSchema.parse(response.json()).editedAt).toBeNull();
    expect((await commentRows('WEB-2')).at(-1)!.editedAt).toBeNull();
    expect(await allEventCount()).toBe(events);
  });

  it.each([
    ['an empty comment', { body: '' }],
    ['10,001 characters', { body: 'a'.repeat(10_001) }],
    ['a NUL character', { body: 'a\u0000b' }],
    ['no body', {}],
    ['a different author', { body: 'Hi', authorId: '01a1656b-1a49-7146-94ac-1c72df43ddb4' }],
    ['a timestamp', { body: 'Hi', editedAt: '2001-01-01T00:00:00Z' }],
  ])('refuses %s with 422 and changes nothing', async (_label, payload) => {
    const mine = await comment('WEB-2', 'reviewer', 'Untouched');
    const events = await allEventCount();
    const response = await editComment('WEB-2', mine.id, payload, await ctx.cookieFor('reviewer'));
    expect(response.statusCode).toBe(422);
    expect((await commentRows('WEB-2')).at(-1)).toMatchObject({
      body: 'Untouched',
      editedAt: null,
    });
    expect(await allEventCount()).toBe(events);
  });

  describe('a comment id that does not belong to this ticket gets a plain 404', () => {
    it("another ticket's comment through this ticket's address", async () => {
      const elsewhere = await comment('WEB-3', 'reviewer', 'On WEB-3');
      const response = await editComment(
        'WEB-2',
        elsewhere.id,
        { body: 'Moved' },
        await ctx.cookieFor('reviewer'),
      );
      expect(response.statusCode).toBe(404);
      expect((await commentRows('WEB-3')).at(-1)!.body).toBe('On WEB-3');
    });

    it.each(['not-a-uuid', '..%2Fx', '01a1656b-1a49-7146-94ac-1c72df43ddb4', '0'])(
      'the id %s',
      async (id) => {
        const response = await editComment(
          'WEB-2',
          id,
          { body: 'Hi' },
          await ctx.cookieFor('reviewer'),
        );
        expect(response.statusCode).toBe(404);
      },
    );

    it("a Northwind comment through Acme's address", async () => {
      const [theirs] = await ctx.db
        .insert(ticketComments)
        .values({
          organisationId: f.northwindId,
          ticketId: f.ticket('OPS-1').id,
          authorId: f.userId('other-owner'),
          body: 'Northwind only',
        })
        .returning();
      const response = await editComment(
        'WEB-2',
        theirs!.id,
        { body: 'Hi' },
        await ctx.cookieFor('owner'),
      );
      expect(response.statusCode).toBe(404);
      const sameKey = await editComment(
        'OPS-1',
        theirs!.id,
        { body: 'Hi' },
        await ctx.cookieFor('owner'),
        f.acmeId,
      );
      expect(sameKey.statusCode).toBe(404);
    });
  });

  it('answers 401 when not signed in and 404 to a stranger', async () => {
    const mine = await comment('WEB-2', 'reviewer', 'Hello');
    expect((await editComment('WEB-2', mine.id, { body: 'Hi' })).statusCode).toBe(401);
    expect(
      (await editComment('WEB-2', mine.id, { body: 'Hi' }, await ctx.cookieFor('other-owner')))
        .statusCode,
    ).toBe(404);
  });
});

describe('deleting a comment', () => {
  it('lets the author delete it, writes one event, and a second delete finds nothing', async () => {
    const mine = await comment('WEB-2', 'reviewer', 'Oops');
    const reviewer = await ctx.cookieFor('reviewer');
    const response = await deleteComment('WEB-2', mine.id, reviewer);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect((await commentRows('WEB-2')).find((r) => r.id === mine.id)).toBeUndefined();
    expect((await eventRows('WEB-2')).at(-1)).toMatchObject({
      type: 'comment.deleted',
      actorUserId: f.userId('reviewer'),
      data: { commentId: mine.id },
    });
    expect((await deleteComment('WEB-2', mine.id, reviewer)).statusCode).toBe(404);
  });

  it.each(['owner', 'admin', 'developer'])(
    "lets %s, who may edit tickets, delete someone else's comment",
    async (identity) => {
      const theirs = await comment('WEB-2', 'reviewer', 'Off topic');
      const response = await deleteComment('WEB-2', theirs.id, await ctx.cookieFor(identity));
      expect(response.statusCode).toBe(204);
      expect((await eventRows('WEB-2')).at(-1)).toMatchObject({
        type: 'comment.deleted',
        actorUserId: f.userId(identity),
      });
    },
  );

  it.each([
    ['reviewer', 'developer'],
    ['readonly', 'reviewer'],
  ])("refuses %s deleting %s's comment, and keeps it", async (deleter, author) => {
    const theirs = await comment('WEB-2', author, 'Keep me');
    const events = await allEventCount();
    const response = await deleteComment('WEB-2', theirs.id, await ctx.cookieFor(deleter));
    expect(response.statusCode).toBe(403);
    expect((await commentRows('WEB-2')).at(-1)!.id).toBe(theirs.id);
    expect(await allEventCount()).toBe(events);
  });

  it('answers 403 to a restricted member, 404 to a stranger and 401 when not signed in', async () => {
    const mine = await comment('WEB-2', 'reviewer', 'Hello');
    expect(
      (await deleteComment('WEB-2', mine.id, await ctx.cookieFor('restricted'))).statusCode,
    ).toBe(403);
    expect(
      (await deleteComment('WEB-2', mine.id, await ctx.cookieFor('other-owner'))).statusCode,
    ).toBe(404);
    expect((await deleteComment('WEB-2', mine.id)).statusCode).toBe(401);
    // None of the refusals removed it.
    expect((await commentRows('WEB-2')).some((r) => r.id === mine.id)).toBe(true);
  });

  it("refuses another ticket's comment through this ticket's address", async () => {
    const elsewhere = await comment('WEB-3', 'reviewer', 'On WEB-3');
    const response = await deleteComment('WEB-2', elsewhere.id, await ctx.cookieFor('owner'));
    expect(response.statusCode).toBe(404);
    expect((await commentRows('WEB-3')).some((r) => r.id === elsewhere.id)).toBe(true);
  });

  it.each(['not-a-uuid', '01a1656b-1a49-7146-94ac-1c72df43ddb4'])(
    'finds nothing for the id %s',
    async (id) => {
      expect((await deleteComment('WEB-2', id, await ctx.cookieFor('owner'))).statusCode).toBe(404);
    },
  );
});
