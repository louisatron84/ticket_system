import {
  apiErrorSchema,
  commentSchema,
  describeTicketEvent,
  ticketDetailSchema,
  ticketListSchema,
  timelineItemSchema,
} from '@forge/shared';
import {
  components,
  organisationMemberships,
  projects,
  roles,
  ticketComments,
  tickets,
  users,
} from '@forge/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, ticketRow, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';
import { addListDataset } from '../test-support/ticket-dataset';

let ctx: Integration;
let f: Facts;
let lstProjectId: string;

const ARCHIVED_MESSAGE = 'This ticket is archived. Unarchive it to change it.';

beforeAll(async () => {
  ctx = await startIntegration();
});

beforeEach(async () => {
  await ctx.reseed();
  f = await loadFacts(ctx.db);
  ({ projectId: lstProjectId } = await addListDataset(ctx.db, f));
});

afterAll(async () => {
  await ctx.close();
});

type Call = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: object;
  cookie?: string;
};
const call = ({ cookie, ...rest }: Call) =>
  ctx.app.inject({ ...rest, headers: cookie ? { cookie } : {} });

async function act(
  action: 'archive' | 'unarchive' | 'duplicate',
  key: string,
  as?: string,
  orgId = f.acmeId,
) {
  return call({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/tickets/${key}/${action}`,
    ...(as ? { cookie: await ctx.cookieFor(as) } : {}),
  });
}
const patchTicket = async (key: string, payload: object, as = 'owner') =>
  call({
    method: 'PATCH',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}`,
    payload,
    cookie: await ctx.cookieFor(as),
  });
const listKeys = async (query = '') => {
  const response = await call({
    method: 'GET',
    url: `/api/v1/orgs/${f.acmeId}/tickets?project=LST&pageSize=100${query}`,
    cookie: await ctx.cookieFor('owner'),
  });
  expect(response.statusCode, response.body).toBe(200);
  return ticketListSchema.parse(response.json()).items.map((t) => t.key);
};
/** The history lines of a ticket, oldest first, the way the page words them. */
const historyOf = async (key: string) => {
  const response = await call({
    method: 'GET',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/timeline`,
    cookie: await ctx.cookieFor('owner'),
  });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as unknown[])
    .map((item) => timelineItemSchema.parse(item))
    .flatMap((item) =>
      item.kind === 'event' ? [describeTicketEvent(item.event, item.actor!.displayName)] : [],
    );
};
const nameOf = async (identity: string) =>
  (
    await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, f.userId(identity)))
  )[0]!.displayName;

const expectConflict = (response: { statusCode: number; json: () => unknown }) => {
  expect(response.statusCode).toBe(409);
  expect(apiErrorSchema.parse(response.json()).error).toMatchObject({
    code: 'conflict',
    message: ARCHIVED_MESSAGE,
  });
};

// Derived from the system roles: archive and unarchive need tickets.edit, duplicate needs
// tickets.create. Owner, admin and developer hold both; reviewer and read-only hold neither.
describe.each([
  ['archive', 'LST-1', 200],
  ['unarchive', 'LST-7', 200],
  ['duplicate', 'LST-1', 201],
] as const)('who may %s a ticket', (action, key, allowed) => {
  const matrix: [string, number][] = [
    ['owner', allowed],
    ['admin', allowed],
    ['developer', allowed],
    ['reviewer', 403],
    ['readonly', 403],
    ['restricted', 403],
    ['other-owner', 404],
  ];

  it.each(matrix)('%s gets %i', async (identity, expected) => {
    expect((await act(action, key, identity)).statusCode).toBe(expected);
  });

  it('answers 401 to someone who is not signed in', async () => {
    expect((await act(action, key)).statusCode).toBe(401);
  });

  it('answers 404 when the ticket is another workspace’s', async () => {
    // Nora owns Northwind: asking Northwind for an Acme key finds nothing.
    expect((await act(action, key, 'other-owner', f.northwindId)).statusCode).toBe(404);
    expect((await act(action, 'LST-999', 'owner')).statusCode).toBe(404);
  });
});

describe('archiving and unarchiving', () => {
  it('archives and unarchives, with history', async () => {
    const before = (await ticketRow(ctx.db, 'LST-1'))!;
    expect(await listKeys()).toContain('LST-1');

    const archived = await act('archive', 'LST-1', 'developer');
    expect(archived.statusCode, archived.body).toBe(200);
    const detail = ticketDetailSchema.parse(archived.json());
    expect(detail.key).toBe('LST-1');
    expect(detail.archivedAt).not.toBeNull();
    expect(detail.version).toBe(before.version + 1);
    // The dataset back-dates updatedAt; archiving stamps it with the real time.
    expect(Math.abs(Date.now() - Date.parse(detail.updatedAt))).toBeLessThan(60_000);

    expect(await listKeys()).not.toContain('LST-1');
    expect(await listKeys('&archived=true')).toContain('LST-1');
    const dev = await nameOf('developer');
    // The dataset back-dates "created" into 2030, so it is checked apart from the new lines.
    const history = await historyOf('LST-1');
    expect(history).toContain(`${await nameOf('owner')} created this ticket`);
    expect(history.filter((line) => !line.endsWith('created this ticket'))).toEqual([
      `${dev} archived this ticket`,
    ]);

    const restored = await act('unarchive', 'LST-1', 'developer');
    expect(restored.statusCode, restored.body).toBe(200);
    const back = ticketDetailSchema.parse(restored.json());
    expect(back.archivedAt).toBeNull();
    expect(back.version).toBe(before.version + 2);
    expect(await listKeys()).toContain('LST-1');
    expect(
      (await historyOf('LST-1')).filter((line) => !line.endsWith('created this ticket')),
    ).toEqual([`${dev} archived this ticket`, `${dev} unarchived this ticket`]);
  });

  it('does nothing, and says nothing, when the ticket is already in that state', async () => {
    const active = (await ticketRow(ctx.db, 'LST-1'))!;
    const again = await act('unarchive', 'LST-1', 'owner');
    expect(again.statusCode).toBe(200);
    expect(ticketDetailSchema.parse(again.json()).version).toBe(active.version);

    const gone = (await ticketRow(ctx.db, 'LST-7'))!;
    const twice = await act('archive', 'LST-7', 'owner');
    expect(twice.statusCode).toBe(200);
    expect(ticketDetailSchema.parse(twice.json())).toMatchObject({
      version: gone.version,
      archivedAt: gone.archivedAt!.toISOString(),
    });

    expect((await ticketRow(ctx.db, 'LST-1'))!.updatedAt).toEqual(active.updatedAt);
    expect(await historyOf('LST-1')).toEqual([`${await nameOf('owner')} created this ticket`]);
    expect(await historyOf('LST-7')).toEqual([`${await nameOf('owner')} created this ticket`]);
  });

  it('refuses edits and comments while archived', async () => {
    const owner = await ctx.cookieFor('owner');
    const commentUrl = `/api/v1/orgs/${f.acmeId}/tickets/LST-1/comments`;
    const added = await call({
      method: 'POST',
      url: commentUrl,
      payload: { body: 'Written before the archive' },
      cookie: owner,
    });
    expect(added.statusCode, added.body).toBe(201);
    const comment = commentSchema.parse(added.json());

    expect((await act('archive', 'LST-1', 'owner')).statusCode).toBe(200);
    const archivedVersion = (await ticketRow(ctx.db, 'LST-1'))!.version;

    expectConflict(await patchTicket('LST-1', { version: archivedVersion, title: 'Renamed' }));
    expectConflict(
      await call({ method: 'POST', url: commentUrl, payload: { body: 'Late' }, cookie: owner }),
    );
    expectConflict(
      await call({
        method: 'PATCH',
        url: `${commentUrl}/${comment.id}`,
        payload: { body: 'Edited late' },
        cookie: owner,
      }),
    );
    expectConflict(
      await call({ method: 'DELETE', url: `${commentUrl}/${comment.id}`, cookie: owner }),
    );

    // Nothing was written by any of the refusals.
    const row = (await ticketRow(ctx.db, 'LST-1'))!;
    expect(row.title).toBe('Fix login redirect');
    expect(row.version).toBe(archivedVersion);
    const stored = await ctx.db
      .select()
      .from(ticketComments)
      .where(eq(ticketComments.ticketId, row.id));
    expect(stored.map((c) => c.body)).toEqual(['Written before the archive']);

    expect((await act('unarchive', 'LST-1', 'owner')).statusCode).toBe(200);
    const after = await patchTicket('LST-1', { version: archivedVersion + 1, title: 'Renamed' });
    expect(after.statusCode, after.body).toBe(200);
    expect(ticketDetailSchema.parse(after.json()).title).toBe('Renamed');
  });

  it('answers 404, not a conflict, for a comment on a ticket that does not exist', async () => {
    const response = await call({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/LST-999/comments`,
      payload: { body: 'Hello' },
      cookie: await ctx.cookieFor('owner'),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('duplicating', () => {
  async function dressUpSource() {
    const [component] = await ctx.db
      .insert(components)
      .values({ organisationId: f.acmeId, projectId: lstProjectId, name: 'Auth' })
      .returning();
    await ctx.db
      .update(tickets)
      .set({
        description: 'Steps\nto reproduce',
        estimateMinutes: 90,
        componentId: component!.id,
      })
      .where(eq(tickets.key, 'LST-1'));
    return component!;
  }

  it('duplicates fields but not comments or history', async () => {
    const component = await dressUpSource();
    const owner = await ctx.cookieFor('owner');
    await call({
      method: 'POST',
      url: `/api/v1/orgs/${f.acmeId}/tickets/LST-1/comments`,
      payload: { body: 'Stays on the original' },
      cookie: owner,
    });
    // LST-1 is "open"; the copy must start at the project's initial status instead.
    const source = ticketDetailSchema.parse(
      (
        await call({
          method: 'GET',
          url: `/api/v1/orgs/${f.acmeId}/tickets/LST-1`,
          cookie: owner,
        })
      ).json(),
    );
    expect(source.status.key).toBe('open');

    const response = await act('duplicate', 'LST-1', 'developer');
    expect(response.statusCode, response.body).toBe(201);
    const copy = ticketDetailSchema.parse(response.json());

    expect(copy.key).toBe('LST-13');
    expect(copy).toMatchObject({
      title: 'Copy of Fix login redirect',
      description: 'Steps\nto reproduce',
      type: source.type,
      priority: source.priority,
      component: { id: component.id },
      dueDate: source.dueDate,
      estimateMinutes: 90,
      project: source.project,
      status: { key: 'backlog' },
      version: 1,
      completedAt: null,
      archivedAt: null,
      commentCount: 0,
      reporter: { email: 'developer@acme.test' },
    });
    expect(copy.labels.map((l) => l.name).sort()).toEqual(['bug', 'frontend']);
    expect(copy.assignee?.email).toBe('developer@acme.test');

    expect(await historyOf('LST-13')).toEqual([
      `${await nameOf('developer')} created this ticket`,
      `${await nameOf('developer')} duplicated this from LST-1`,
    ]);

    // The original is untouched.
    const original = (await ticketRow(ctx.db, 'LST-1'))!;
    expect(original.version).toBe(source.version);
    expect(await historyOf('LST-1')).toEqual([`${await nameOf('owner')} created this ticket`]);
  });

  it('cuts a long title to 200 characters', async () => {
    const long = 'x'.repeat(200);
    await ctx.db.update(tickets).set({ title: long }).where(eq(tickets.key, 'LST-1'));
    const copy = ticketDetailSchema.parse((await act('duplicate', 'LST-1', 'owner')).json());
    expect(copy.title).toBe(`Copy of ${long}`.slice(0, 200));
    expect(copy.title).toHaveLength(200);
  });

  it('a duplicate by someone who cannot assign has no assignee', async () => {
    const [custom] = await ctx.db
      .insert(roles)
      .values({
        organisationId: f.acmeId,
        key: 'create-only',
        name: 'Create only',
        permissions: ['workspace.view', 'tickets.view', 'tickets.create'],
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

    // LST-1 is assigned to the developer; the copy keeps everything but the assignee.
    const response = await act('duplicate', 'LST-1', 'developer');
    expect(response.statusCode, response.body).toBe(201);
    expect(ticketDetailSchema.parse(response.json()).assignee).toBeNull();
  });

  it('keeps an unassigned ticket unassigned', async () => {
    const copy = ticketDetailSchema.parse((await act('duplicate', 'LST-2', 'owner')).json());
    expect(copy.assignee).toBeNull();
  });

  it('can copy an archived ticket, and the copy is not archived', async () => {
    const response = await act('duplicate', 'LST-7', 'owner');
    expect(response.statusCode, response.body).toBe(201);
    expect(ticketDetailSchema.parse(response.json())).toMatchObject({
      title: 'Copy of Archived leftovers',
      archivedAt: null,
    });
  });

  it('duplicating into an archived project is refused', async () => {
    await ctx.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.key, 'LST'));
    const response = await act('duplicate', 'LST-1', 'owner');
    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.message).toBe(
      'This project is archived and cannot take new tickets.',
    );
    expect(await ticketRow(ctx.db, 'LST-13')).toBeUndefined();
  });
});
