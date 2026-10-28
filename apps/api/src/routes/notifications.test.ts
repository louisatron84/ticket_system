import { notifications, ticketWatchers, userPreferences } from '@forge/db';
import {
  notificationEventSchema,
  notificationListSchema,
  ticketDetailSchema,
  type NotificationList,
} from '@forge/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { remindDueDates } from '../notifications/jobs';
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
  options: { as?: string; payload?: unknown; org?: string } = {},
) =>
  ctx.app.inject({
    method,
    url: `/api/v1/orgs/${options.org ?? f.acmeId}${url}`,
    ...(options.payload !== undefined ? { payload: options.payload as never } : {}),
    headers: { cookie: await ctx.cookieFor(options.as ?? 'developer') },
  });

const inbox = async (as: string, filter: 'all' | 'unread' = 'all'): Promise<NotificationList> => {
  const response = await call('GET', `/notifications?filter=${filter}`, { as });
  expect(response.statusCode, response.body).toBe(200);
  return notificationListSchema.parse(response.json());
};
const texts = async (as: string) => (await inbox(as)).items.map((n) => n.text);

const version = async (key: string) =>
  ticketDetailSchema.parse((await call('GET', `/tickets/${key}`, { as: 'owner' })).json()).version;

const mention = (identity: string, name: string) => `@[${name}](user:${f.userId(identity)})`;

describe('who is told what', () => {
  it('assigning tells the assignee, and they start watching', async () => {
    await call('PATCH', '/tickets/WEB-4', {
      as: 'owner',
      payload: { version: await version('WEB-4'), assigneeId: f.userId('admin') },
    });
    expect(await texts('admin')).toEqual(['Olivia Owner assigned WEB-4 to you']);
    const watchers = ticketDetailSchema.parse(
      (await call('GET', '/tickets/WEB-4')).json(),
    ).watchers;
    expect(watchers.map((w) => w.displayName)).toContain('Adam Admin');
  });

  it('a mention tells that person once, and only when newly mentioned', async () => {
    const body = { body: `Can you look, ${mention('admin', 'Adam Admin')}?` };
    const comment = (await call('POST', '/tickets/WEB-2/comments', { payload: body })).json() as {
      id: string;
    };
    expect(await texts('admin')).toEqual(['Dana Developer mentioned you in a comment on WEB-2']);
    // Editing the same comment without a new mention tells nobody again.
    await call('PATCH', `/tickets/WEB-2/comments/${comment.id}`, {
      payload: { body: `${body.body} Thanks.` },
    });
    expect(await texts('admin')).toHaveLength(1);
  });

  it('watchers hear about comments and moves, but never about their own', async () => {
    await call('PUT', '/tickets/WEB-2/watch', { as: 'reviewer' });
    await call('POST', '/tickets/WEB-2/comments', { as: 'reviewer', payload: { body: 'Mine' } });
    expect(await texts('reviewer')).toEqual([]);
    await call('POST', '/tickets/WEB-2/comments', { payload: { body: 'Progress' } });
    const statuses = (await call('GET', '/projects/WEB', { as: 'owner' })).json() as {
      statuses: { id: string; key: string }[];
    };
    await call('PATCH', '/tickets/WEB-2', {
      payload: {
        version: await version('WEB-2'),
        statusId: statuses.statuses.find((s) => s.key === 'in_progress')!.id,
      },
    });
    expect(await texts('reviewer')).toEqual([
      'Dana Developer moved WEB-2 from Warming to In the Forge',
      'Dana Developer commented on WEB-2',
    ]);
  });

  it('unwatching sticks: commenting again does not add you back', async () => {
    await call('POST', '/tickets/WEB-2/comments', { as: 'reviewer', payload: { body: 'Hi' } });
    await call('DELETE', '/tickets/WEB-2/watch', { as: 'reviewer' });
    await call('POST', '/tickets/WEB-2/comments', { as: 'reviewer', payload: { body: 'Again' } });
    await call('POST', '/tickets/WEB-2/comments', { payload: { body: 'Reply' } });
    expect(await texts('reviewer')).toEqual([]);
  });

  it('a kind switched off is not delivered', async () => {
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/me/preferences',
      headers: { cookie: await ctx.cookieFor('admin') },
      payload: { notifications: { assigned: false } },
    });
    await call('PATCH', '/tickets/WEB-4', {
      as: 'owner',
      payload: { version: await version('WEB-4'), assigneeId: f.userId('admin') },
    });
    expect(await texts('admin')).toEqual([]);
    const [prefs] = await ctx.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, f.userId('admin')));
    expect((prefs!.data as { notifications: unknown }).notifications).toEqual({ assigned: false });
  });

  it('a mention of someone outside the workspace notifies nobody', async () => {
    await call('POST', '/tickets/WEB-2/comments', {
      payload: { body: `Hey ${mention('other-owner', 'Nora Northwind')}` },
    });
    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, f.userId('other-owner')));
    expect(rows).toEqual([]);
    const watchers = await ctx.db
      .select()
      .from(ticketWatchers)
      .where(eq(ticketWatchers.userId, f.userId('other-owner')));
    expect(watchers).toEqual([]);
  });
});

describe('the inbox', () => {
  it('is per person and per workspace, reads and marks read', async () => {
    await call('PATCH', '/tickets/WEB-4', {
      as: 'owner',
      payload: { version: await version('WEB-4'), assigneeId: f.userId('admin') },
    });
    const list = await inbox('admin');
    expect(list.unread).toBe(1);
    expect(list.items[0]).toMatchObject({
      kind: 'assigned',
      ticket: { key: 'WEB-4' },
      read: false,
      actor: { displayName: 'Olivia Owner' },
    });
    // Nobody else sees it, and another workspace has none.
    expect((await inbox('owner')).items).toEqual([]);
    const other = await call('GET', '/notifications', { as: 'other-owner', org: f.northwindId });
    expect((other.json() as NotificationList).items).toEqual([]);
    // Someone else's id marks nothing.
    const stray = await call('POST', '/notifications/read', {
      as: 'owner',
      payload: { ids: [list.items[0]!.id] },
    });
    expect(stray.json()).toEqual({ unread: 0 });
    expect((await inbox('admin')).unread).toBe(1);

    const read = await call('POST', '/notifications/read', {
      as: 'admin',
      payload: { ids: [list.items[0]!.id] },
    });
    expect(read.json()).toEqual({ unread: 0 });
    expect((await inbox('admin', 'unread')).items).toEqual([]);
    expect((await inbox('admin')).items[0]!.read).toBe(true);
  });

  it('pages without skipping or repeating', async () => {
    for (let i = 0; i < 35; i += 1) {
      await call('POST', '/tickets/WEB-2/comments', {
        payload: { body: `${mention('admin', 'Adam Admin')} ${i}` },
      });
    }
    const first = await inbox('admin');
    expect(first.items).toHaveLength(30);
    expect(first.next).not.toBeNull();
    const second = notificationListSchema.parse(
      (
        await call('GET', `/notifications?before=${encodeURIComponent(first.next!)}`, {
          as: 'admin',
        })
      ).json(),
    );
    expect(second.items).toHaveLength(5);
    const ids = new Set([...first.items, ...second.items].map((n) => n.id));
    expect(ids.size).toBe(35);
    await call('POST', '/notifications/read', { as: 'admin', payload: { all: true } });
    expect((await inbox('admin')).unread).toBe(0);
  });
});

describe('due dates', () => {
  it('reminds the assignee once when due tomorrow and once when overdue', async () => {
    const now = new Date();
    const day = (offset: number) =>
      new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    await ctx.db.execute(
      sql`update tickets set due_date = ${day(1)} where key = 'WEB-2' and organisation_id = ${f.acmeId}`,
    );
    await ctx.db.execute(
      sql`update tickets set due_date = ${day(-3)} where key = 'WEB-3' and organisation_id = ${f.acmeId}`,
    );
    await remindDueDates(ctx.db, now);
    await remindDueDates(ctx.db, now);
    const mine = await texts('developer');
    expect(mine.filter((t) => t === 'WEB-2 is due tomorrow')).toHaveLength(1);
    expect(mine.filter((t) => t === 'WEB-3 is overdue')).toHaveLength(1);
  });
});

describe('the live stream', () => {
  it('delivers a new notification to its recipient only, after the change commits', async () => {
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const cookie = await ctx.cookieFor('admin');
    const controller = new AbortController();
    const response = await fetch(`${address}/api/v1/me/events`, {
      headers: { cookie },
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    await ctx.app.notificationHub.ensureListening();
    // Wait until the stream is registered before causing anything.
    for (let i = 0; i < 50 && ctx.app.notificationHub.openStreams === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await call('PATCH', '/tickets/WEB-4', {
      as: 'owner',
      payload: { version: await version('WEB-4'), assigneeId: f.userId('admin') },
    });

    let text = '';
    const deadline = Date.now() + 5000;
    while (!text.includes('event: notification') && Date.now() < deadline) {
      const { value } = await reader.read();
      text += decoder.decode(value);
    }
    controller.abort();
    const data = /event: notification\ndata: (.*)\n/.exec(text)?.[1];
    const event = notificationEventSchema.parse(JSON.parse(data!));
    expect(event.unread).toBe(1);
    expect(event.notification?.text).toBe('Olivia Owner assigned WEB-4 to you');
    const own = await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientId, f.userId('owner'))));
    expect(own).toEqual([]);
  });

  it('is for browser sessions only', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/me/events' });
    expect(response.statusCode).toBe(401);
  });
});

describe('notification settings', () => {
  it('switching one kind off keeps the others as they were', async () => {
    const patch = (notifications: object) =>
      ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/me/preferences',
        headers: { cookie: '' },
        payload: { notifications },
      });
    const cookie = await ctx.cookieFor('admin');
    const send = (notifications: object) =>
      ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/me/preferences',
        headers: { cookie },
        payload: { notifications },
      });
    expect((await patch({ assigned: false })).statusCode).toBe(401);
    await send({ assigned: false });
    const saved = (await send({ mentioned: false })).json() as { notifications: object };
    expect(saved.notifications).toEqual({ assigned: false, mentioned: false });
    expect((await send({ bogus: true })).statusCode).toBe(422);
  });
});

describe('only people who may see tickets', () => {
  it('a member without tickets.view is neither notified nor made a watcher', async () => {
    await call('POST', '/tickets/WEB-2/comments', {
      payload: { body: `Look ${mention('restricted', 'Casey Restricted')}` },
    });
    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, f.userId('restricted')));
    expect(rows).toEqual([]);
    const watching = await ctx.db
      .select()
      .from(ticketWatchers)
      .where(eq(ticketWatchers.userId, f.userId('restricted')));
    expect(watching).toEqual([]);
  });
});
