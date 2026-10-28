import {
  apiErrorSchema,
  uploadResultSchema,
  commentSchema,
  criterionSchema,
  describeTicketEvent,
  ticketDetailSchema,
  ticketListSchema,
  timelineItemSchema,
} from '@forge/shared';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;
let f: Facts;

beforeAll(async () => {
  ctx = await startIntegration();
});

beforeEach(async () => {
  await ctx.reseed();
  await rm(ctx.config.attachmentsDir, { recursive: true, force: true });
  f = await loadFacts(ctx.db);
});

afterAll(async () => {
  await ctx.close();
});

const ARCHIVED_MESSAGE = 'This ticket is archived. Unarchive it to change it.';

const call = async (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: { as?: string; payload?: unknown; headers?: Record<string, string>; org?: string } = {},
) =>
  ctx.app.inject({
    method,
    url: `/api/v1/orgs/${options.org ?? f.acmeId}${url}`,
    ...(options.payload !== undefined ? { payload: options.payload as never } : {}),
    headers: { cookie: await ctx.cookieFor(options.as ?? 'developer'), ...options.headers },
  });

const detailOf = async (key: string) => {
  const response = await call('GET', `/tickets/${key}`, { as: 'owner' });
  expect(response.statusCode, response.body).toBe(200);
  return ticketDetailSchema.parse(response.json());
};

const historyOf = async (key: string) => {
  const response = await call('GET', `/tickets/${key}/timeline`, { as: 'owner' });
  return (response.json() as unknown[])
    .map((item) => timelineItemSchema.parse(item))
    .flatMap((item) =>
      item.kind === 'event' ? [describeTicketEvent(item.event, item.actor!.displayName)] : [],
    );
};

const criteriaOf = (response: { json(): unknown }) =>
  criterionSchema.array().parse(response.json());

const addCriterion = async (key: string, text: string, as = 'developer') =>
  call('POST', `/tickets/${key}/criteria`, { as, payload: { text } });

const version = async (key: string) => (await detailOf(key)).version;

describe('goal', () => {
  it('is saved with the ticket version and recorded without its text', async () => {
    const response = await call('PATCH', '/tickets/WEB-1', {
      payload: { version: await version('WEB-1'), goal: 'Shoppers can pay faster' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const ticket = ticketDetailSchema.parse(response.json());
    expect(ticket.goal).toBe('Shoppers can pay faster');
    expect((await historyOf('WEB-1')).at(-1)).toBe('Dana Developer edited the goal');
  });

  it('is at most 500 characters', async () => {
    const response = await call('PATCH', '/tickets/WEB-1', {
      payload: { version: await version('WEB-1'), goal: 'x'.repeat(501) },
    });
    expect(response.statusCode).toBe(422);
  });

  it('can be given, with criteria, when the ticket is made', async () => {
    const response = await call('POST', '/projects/WEB/tickets', {
      payload: {
        title: 'Export',
        typeId: f.typeId('acme', 'task'),
        priorityId: f.priorityId('acme', 'normal'),
        goal: 'Finance can reconcile',
        criteria: ['Exports as CSV', 'Totals match'],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const ticket = ticketDetailSchema.parse(response.json());
    expect(ticket.goal).toBe('Finance can reconcile');
    expect(ticket.criteriaItems.map((c) => [c.text, c.done])).toEqual([
      ['Exports as CSV', false],
      ['Totals match', false],
    ]);
    expect(ticket.criteria).toEqual({ done: 0, total: 2 });
  });
});

describe('acceptance criteria', () => {
  it('adds, ticks, edits, reorders and removes, each in the history', async () => {
    await addCriterion('WEB-6', 'Exports as CSV');
    const list = criteriaOf(await addCriterion('WEB-6', 'Totals match'));
    expect(list.map((c) => c.text)).toEqual(['Exports as CSV', 'Totals match']);
    const [csv, totals] = list as [(typeof list)[0], (typeof list)[0]];

    const ticked = await call('PATCH', `/tickets/WEB-6/criteria/${csv.id}`, {
      payload: { done: true },
    });
    expect(ticked.statusCode, ticked.body).toBe(200);
    const after = criteriaOf(ticked)[0]!;
    expect(after.done).toBe(true);
    expect(after.doneBy?.id).toBe(f.userId('developer'));
    expect(after.doneAt).not.toBeNull();

    await call('PATCH', `/tickets/WEB-6/criteria/${totals.id}`, {
      payload: { text: 'Totals match the ledger' },
    });
    const reordered = await call('PUT', '/tickets/WEB-6/criteria/order', {
      payload: { ids: [totals.id, csv.id] },
    });
    expect(criteriaOf(reordered).map((c) => c.text)).toEqual([
      'Totals match the ledger',
      'Exports as CSV',
    ]);
    await call('PATCH', `/tickets/WEB-6/criteria/${csv.id}`, { payload: { done: false } });
    const removed = await call('DELETE', `/tickets/WEB-6/criteria/${totals.id}`);
    expect(criteriaOf(removed).map((c) => c.text)).toEqual(['Exports as CSV']);

    expect((await historyOf('WEB-6')).slice(-7)).toEqual([
      'Dana Developer added the criterion "Exports as CSV"',
      'Dana Developer added the criterion "Totals match"',
      'Dana Developer ticked "Exports as CSV"',
      'Dana Developer changed the criterion "Totals match" to "Totals match the ledger"',
      'Dana Developer reordered the acceptance criteria',
      'Dana Developer unticked "Exports as CSV"',
      'Dana Developer removed the criterion "Totals match the ledger"',
    ]);
  });

  it('sending what a criterion already is records nothing', async () => {
    const [item] = criteriaOf(await addCriterion('WEB-6', 'Same'));
    const before = (await historyOf('WEB-6')).length;
    await call('PATCH', `/tickets/WEB-6/criteria/${item!.id}`, {
      payload: { text: 'Same', done: false },
    });
    await call('PUT', '/tickets/WEB-6/criteria/order', { payload: { ids: [item!.id] } });
    expect((await historyOf('WEB-6')).length).toBe(before);
  });

  it('does not touch the ticket version, so ticking never conflicts with an edit', async () => {
    const start = await version('WEB-1');
    const [item] = criteriaOf(await addCriterion('WEB-1', 'One'));
    await call('PATCH', `/tickets/WEB-1/criteria/${item!.id}`, { payload: { done: true } });
    expect(await version('WEB-1')).toBe(start);
    const saved = await call('PATCH', '/tickets/WEB-1', {
      payload: { version: start, description: 'Still fine' },
    });
    expect(saved.statusCode).toBe(200);
  });

  it('counts on the list and the board', async () => {
    const [a] = criteriaOf(await addCriterion('WEB-6', 'A'));
    await addCriterion('WEB-6', 'B');
    await call('PATCH', `/tickets/WEB-6/criteria/${a!.id}`, { payload: { done: true } });
    const list = ticketListSchema.parse(
      (
        await call('GET', '/tickets?search=' + encodeURIComponent((await detailOf('WEB-6')).title))
      ).json(),
    );
    expect(list.items.find((t) => t.key === 'WEB-6')!.criteria).toEqual({ done: 1, total: 2 });
    const board = (await call('GET', '/projects/WEB/board')).json() as {
      columns: { tickets: { key: string; criteria: unknown }[] }[];
    };
    const card = board.columns.flatMap((c) => c.tickets).find((t) => t.key === 'WEB-6');
    expect(card!.criteria).toEqual({ done: 1, total: 2 });
  });

  it('does not stop a ticket being quenched', async () => {
    await addCriterion('WEB-12', 'Never ticked');
    const detail = await detailOf('WEB-12');
    expect(detail.criteria).toEqual({ done: 0, total: 1 });
    expect(detail.status.category).toBe('completed');
  });

  it('refuses a 51st criterion, empty or overlong text, and a stale order', async () => {
    for (let i = 0; i < 50; i += 1) await addCriterion('WEB-2', `Item ${i}`);
    const over = await addCriterion('WEB-2', 'One too many');
    expect(over.statusCode).toBe(422);
    expect(apiErrorSchema.parse(over.json()).error.message).toBe(
      'A ticket can have at most 50 acceptance criteria.',
    );
    expect((await addCriterion('WEB-3', '   ')).statusCode).toBe(422);
    expect((await addCriterion('WEB-3', 'x'.repeat(301))).statusCode).toBe(422);
    expect((await addCriterion('WEB-3', 'two\nlines')).statusCode).toBe(422);

    const [one] = criteriaOf(await addCriterion('WEB-3', 'One'));
    await addCriterion('WEB-3', 'Two');
    const stale = await call('PUT', '/tickets/WEB-3/criteria/order', {
      payload: { ids: [one!.id] },
    });
    expect(stale.statusCode).toBe(409);
  });

  it('a criterion id only works under its own ticket', async () => {
    const [item] = criteriaOf(await addCriterion('WEB-1', 'Mine'));
    const elsewhere = await call('PATCH', `/tickets/WEB-2/criteria/${item!.id}`, {
      payload: { done: true },
    });
    expect(elsewhere.statusCode).toBe(404);
    const foreign = await call('PATCH', `/tickets/WEB-1/criteria/${item!.id}`, {
      as: 'other-owner',
      org: f.northwindId,
      payload: { done: true },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('needs tickets.edit, and an archived ticket refuses changes', async () => {
    for (const as of ['reviewer', 'readonly']) {
      expect((await addCriterion('WEB-1', 'No', as)).statusCode).toBe(403);
    }
    await call('POST', '/tickets/WEB-1/archive');
    const refused = await addCriterion('WEB-1', 'Late');
    expect(refused.statusCode).toBe(409);
    expect(apiErrorSchema.parse(refused.json()).error.message).toBe(ARCHIVED_MESSAGE);
  });

  it('is copied, unticked, by duplicate', async () => {
    const [item] = criteriaOf(await addCriterion('WEB-6', 'Carried over'));
    await call('PATCH', `/tickets/WEB-6/criteria/${item!.id}`, { payload: { done: true } });
    const copy = ticketDetailSchema.parse((await call('POST', '/tickets/WEB-6/duplicate')).json());
    expect(copy.criteriaItems.map((c) => [c.text, c.done])).toEqual([['Carried over', false]]);
  });
});

describe('ticket references', () => {
  it('records where a ticket is mentioned, from every kind of text, and forgets removed text', async () => {
    await call('PATCH', '/tickets/WEB-1', {
      payload: { version: await version('WEB-1'), description: 'Needs API-2 first' },
    });
    const [item] = criteriaOf(await addCriterion('WEB-3', 'Same as API-2'));
    const comment = commentSchema.parse(
      (
        await call('POST', '/tickets/WEB-4/comments', { payload: { body: 'See API-2 and WEB-4' } })
      ).json(),
    );
    expect((await detailOf('API-2')).mentionedIn.map((t) => t.key)).toEqual([
      'WEB-1',
      'WEB-3',
      'WEB-4',
    ]);
    // A ticket mentioning itself is not "mentioned in" itself.
    expect((await detailOf('WEB-4')).mentionedIn.map((t) => t.key)).not.toContain('WEB-4');

    await call('DELETE', `/tickets/WEB-3/criteria/${item!.id}`);
    await call('DELETE', `/tickets/WEB-4/comments/${comment.id}`);
    await call('PATCH', '/tickets/WEB-1', {
      payload: { version: await version('WEB-1'), description: 'No longer' },
    });
    expect((await detailOf('API-2')).mentionedIn).toEqual([]);
  });

  it('resolves only keys of this workspace, ignoring code and unknown keys', async () => {
    await call('PATCH', '/tickets/WEB-1', {
      payload: {
        version: await version('WEB-1'),
        description: 'API-2, OPS-1 (another workspace), WEB-999 and `API-3`',
      },
    });
    expect((await detailOf('WEB-1')).references.map((t) => t.key)).toEqual(['API-2']);
    expect((await detailOf('API-3')).mentionedIn).toEqual([]);
  });

  it('lists references from comments too', async () => {
    await call('POST', '/tickets/WEB-1/comments', { payload: { body: 'Like API-4' } });
    expect((await detailOf('WEB-1')).references.map((t) => t.key)).toContain('API-4');
  });
});

describe('attachments', () => {
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 1),
  ]);
  const upload = async (key: string, name: string, bytes: Buffer, as = 'developer') =>
    call('POST', `/tickets/${key}/attachments`, {
      as,
      payload: bytes,
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(name),
      },
    });

  it('stores a file, lists it, serves it as a download and removes it', async () => {
    const response = await upload('WEB-1', 'screen shot ü.png', PNG);
    expect(response.statusCode, response.body).toBe(201);
    const { created: file, attachments } = uploadResultSchema.parse(response.json());
    expect(attachments.map((a) => a.id)).toEqual([file.id]);
    expect(file).toMatchObject({
      fileName: 'screen shot ü.png',
      contentType: 'image/png',
      sizeBytes: 40,
    });
    expect((await detailOf('WEB-1')).attachments.map((a) => a.id)).toEqual([file.id]);

    const download = await call('GET', `/tickets/WEB-1/attachments/${file.id}/file`, {
      as: 'readonly',
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.equals(PNG)).toBe(true);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['content-disposition']).toMatch(/^attachment; /);
    expect(download.headers['content-disposition']).toContain(
      "filename*=UTF-8''screen%20shot%20%C3%BC.png",
    );
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['content-security-policy']).toBe("default-src 'none'; sandbox");

    const inline = await call('GET', `/tickets/WEB-1/attachments/${file.id}/file?inline=1`);
    expect(inline.headers['content-disposition']).toMatch(/^inline; /);

    // Stored under a random key, never the name.
    const folders = await readdir(ctx.config.attachmentsDir);
    const stored = await readdir(path.join(ctx.config.attachmentsDir, folders[0]!));
    expect(stored[0]).toMatch(/^[0-9a-f]{64}$/);

    const removed = await call('DELETE', `/tickets/WEB-1/attachments/${file.id}`);
    expect(removed.statusCode).toBe(204);
    expect(await readdir(path.join(ctx.config.attachmentsDir, folders[0]!))).toEqual([]);
    expect((await historyOf('WEB-1')).slice(-2)).toEqual([
      'Dana Developer attached screen shot ü.png',
      'Dana Developer removed the attachment screen shot ü.png',
    ]);
  });

  it('judges a file by its content, not its name', async () => {
    const cases: [string, Buffer][] = [
      [
        'logo.png',
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      ],
      ['page.txt', Buffer.from('<!doctype html><script>alert(1)</script>')],
      ['notes.txt', Buffer.from([0x61, 0x00, 0x62])],
      ['tool.exe', Buffer.from('MZ\x90\x00')],
      ['image.svg', Buffer.from('<svg/>')],
    ];
    for (const [name, bytes] of cases) {
      const response = await upload('WEB-1', name, bytes);
      expect(response.statusCode, name).toBe(422);
    }
    const text = await upload('WEB-1', 'notes.md', Buffer.from('# Notes\nplain'));
    expect(uploadResultSchema.parse(text.json()).created.contentType).toBe('text/markdown');
    // A text file is never shown inline.
    const file = uploadResultSchema.parse(text.json()).created;
    const inline = await call('GET', `/tickets/WEB-1/attachments/${file.id}/file?inline=1`);
    expect(inline.headers['content-disposition']).toMatch(/^attachment; /);
  });

  it('keeps only the last part of a path as the name', async () => {
    const response = await upload('WEB-1', '../../etc/passwd.png', PNG);
    expect(uploadResultSchema.parse(response.json()).created.fileName).toBe('passwd.png');
  });

  it('refuses more than 10 MB, an empty file and a missing name', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 - PNG.length + 1)]);
    expect((await upload('WEB-1', 'big.png', big)).statusCode).toBe(413);
    expect((await upload('WEB-1', 'empty.png', Buffer.alloc(0))).statusCode).toBe(422);
    const unnamed = await call('POST', '/tickets/WEB-1/attachments', {
      payload: PNG,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(unnamed.statusCode).toBe(422);
  });

  it('needs tickets.edit to upload and tickets.view to download, in this workspace only', async () => {
    expect((await upload('WEB-1', 'a.png', PNG, 'reviewer')).statusCode).toBe(403);
    const file = uploadResultSchema.parse((await upload('WEB-1', 'a.png', PNG)).json()).created;
    const foreign = await call('GET', `/tickets/WEB-1/attachments/${file.id}/file`, {
      as: 'other-owner',
      org: f.northwindId,
    });
    expect(foreign.statusCode).toBe(404);
    const wrongTicket = await call('GET', `/tickets/WEB-2/attachments/${file.id}/file`);
    expect(wrongTicket.statusCode).toBe(404);
    const unauthenticated = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-1/attachments/${file.id}/file`,
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(
      (await call('DELETE', `/tickets/WEB-1/attachments/${file.id}`, { as: 'reviewer' }))
        .statusCode,
    ).toBe(403);
  });

  it('an archived ticket takes no new files', async () => {
    await call('POST', '/tickets/WEB-1/archive');
    expect((await upload('WEB-1', 'a.png', PNG)).statusCode).toBe(409);
    expect(await readdir(ctx.config.attachmentsDir).catch(() => [])).toEqual([]);
  });
});

describe('reactions', () => {
  const firstComment = async () => {
    const created = await call('POST', '/tickets/WEB-1/comments', { payload: { body: 'Nice' } });
    return commentSchema.parse(created.json());
  };
  const react = async (commentId: string, reaction: string, on: boolean, as = 'developer') =>
    call('PUT', `/tickets/WEB-1/comments/${commentId}/reactions`, {
      as,
      payload: { reaction, on },
    });

  it('adds and takes back reactions, showing who and whether they are mine', async () => {
    const comment = await firstComment();
    await react(comment.id, 'thumbs_up', true);
    await react(comment.id, 'thumbs_up', true); // twice is still once
    const second = commentSchema.parse(
      (await react(comment.id, 'thumbs_up', true, 'reviewer')).json(),
    );
    expect(second.reactions).toEqual([
      { reaction: 'thumbs_up', count: 2, mine: true, names: ['Dana Developer', 'Riley Reviewer'] },
    ]);
    const timeline = (await call('GET', '/tickets/WEB-1/timeline')).json() as {
      kind: string;
      comment?: { id: string; reactions: { mine: boolean; count: number }[] };
    }[];
    const seen = timeline.find((item) => item.comment?.id === comment.id)!.comment!;
    expect(seen.reactions[0]).toMatchObject({ count: 2, mine: true });

    const back = commentSchema.parse((await react(comment.id, 'thumbs_up', false)).json());
    expect(back.reactions[0]).toMatchObject({ count: 1, mine: false, names: ['Riley Reviewer'] });
  });

  it('refuses reactions outside the set, and from someone who cannot comment', async () => {
    const comment = await firstComment();
    expect((await react(comment.id, 'skull', true)).statusCode).toBe(422);
    expect((await react(comment.id, 'heart', true, 'readonly')).statusCode).toBe(403);
  });

  it('a comment with reactions can still be deleted', async () => {
    const comment = await firstComment();
    await react(comment.id, 'tada', true);
    expect((await call('DELETE', `/tickets/WEB-1/comments/${comment.id}`)).statusCode).toBe(204);
  });
});
