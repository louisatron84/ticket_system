import { auditEvents, savedViews } from '@forge/db';
import { savedViewSchema, type SavedView } from '@forge/shared';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';

const SOME_ID = '01a1656b-1a49-7146-94ac-1c72df43ddb4';

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
  path: string;
  payload?: unknown;
  as?: string;
  orgId?: string;
};
async function call({ method, path, payload, as, orgId }: Call) {
  return ctx.app.inject({
    method,
    url: `/api/v1/orgs/${orgId ?? f.acmeId}/views${path}`,
    ...(payload === undefined ? {} : { payload: payload as object }),
    headers: as ? { cookie: await ctx.cookieFor(as) } : {},
  });
}

const definition = (filters: Record<string, unknown> = {}, display = 'list') => ({
  filters,
  display,
});
const body = (over: Record<string, unknown> = {}) => ({
  name: 'My open work',
  scope: 'personal',
  definition: definition({ assignee: ['me'] }),
  ...over,
});

const create = (payload: unknown, as?: string, orgId?: string) =>
  call({ method: 'POST', path: '', payload, ...(as ? { as } : {}), ...(orgId ? { orgId } : {}) });
const patch = (id: string, payload: unknown, as?: string, orgId?: string) =>
  call({
    method: 'PATCH',
    path: `/${id}`,
    payload,
    ...(as ? { as } : {}),
    ...(orgId ? { orgId } : {}),
  });
const remove = (id: string, as?: string, orgId?: string) =>
  call({ method: 'DELETE', path: `/${id}`, ...(as ? { as } : {}), ...(orgId ? { orgId } : {}) });
const list = (as?: string, orgId?: string) =>
  call({ method: 'GET', path: '', ...(as ? { as } : {}), ...(orgId ? { orgId } : {}) });

/** Creates a view and returns it, expecting success. */
async function made(payload: unknown, as: string): Promise<SavedView> {
  const response = await create(payload, as);
  expect(response.statusCode, response.body).toBe(201);
  return savedViewSchema.parse(response.json());
}
const names = async (as: string, orgId?: string) =>
  z
    .array(savedViewSchema)
    .parse((await list(as, orgId)).json())
    .map((v) => v.name);

const viewCount = async () => (await ctx.db.select().from(savedViews)).length;
const viewAudits = async () =>
  ctx.db
    .select()
    .from(auditEvents)
    .where(inArray(auditEvents.action, ['view.created', 'view.updated', 'view.deleted']));
const rowOf = async (id: string) =>
  (await ctx.db.select().from(savedViews).where(eq(savedViews.id, id)))[0];

describe('who may create a view', () => {
  const personal: [string, number][] = [
    ['owner', 201],
    ['admin', 201],
    ['developer', 201],
    ['reviewer', 201],
    ['readonly', 201],
    ['restricted', 403],
    ['other-owner', 404],
  ];
  it.each(personal)('a personal view: %s gets %i', async (identity, expected) => {
    const before = await viewCount();
    expect((await create(body(), identity)).statusCode).toBe(expected);
    expect(await viewCount()).toBe(before + (expected === 201 ? 1 : 0));
  });

  const shared: [string, number][] = [
    ['owner', 201],
    ['admin', 201],
    ['developer', 403],
    ['reviewer', 403],
    ['readonly', 403],
    ['restricted', 403],
    ['other-owner', 404],
  ];
  it.each(shared)('a shared view: %s gets %i', async (identity, expected) => {
    const before = await viewCount();
    expect((await create(body({ scope: 'shared' }), identity)).statusCode).toBe(expected);
    expect(await viewCount()).toBe(before + (expected === 201 ? 1 : 0));
  });

  it('answers 401 to someone who is not signed in', async () => {
    expect((await create(body())).statusCode).toBe(401);
    expect((await list()).statusCode).toBe(401);
  });
});

describe('creating a view', () => {
  it('stores it for the caller in the workspace and returns it whole', async () => {
    const view = await made(body({ name: '  My open work  ' }), 'developer');
    expect(view).toMatchObject({
      name: 'My open work',
      scope: 'personal',
      ownerUserId: f.userId('developer'),
    });
    expect(view.definition.display).toBe('list');
    expect(view.definition.filters.assignee).toEqual(['me']);
    expect(Number.isNaN(Date.parse(view.updatedAt))).toBe(false);
    expect(await rowOf(view.id)).toMatchObject({
      organisationId: f.acmeId,
      ownerUserId: f.userId('developer'),
      scope: 'personal',
    });
  });

  it('fills in the defaults, so what is stored is always complete', async () => {
    const view = await made(body({ definition: definition({}, 'board') }), 'developer');
    expect(view.definition.filters).toMatchObject({
      q: '',
      project: [],
      statusKey: [],
      archived: false,
      sort: 'updated',
      dir: 'desc',
      pageSize: 50,
    });
    expect(view.definition.filters).not.toHaveProperty('page');
    expect((await rowOf(view.id))!.definition).toEqual(view.definition);
  });

  it('keeps a project key in its canonical form', async () => {
    const view = await made(body({ definition: definition({ project: ['web'] }) }), 'developer');
    expect(view.definition.filters.project).toEqual(['WEB']);
  });

  it('keeps markup, emoji and right-to-left names exactly as typed', async () => {
    for (const name of ['<img src=x onerror=alert(1)>', 'مرحبا 👋', 'a'.repeat(80)]) {
      expect((await made(body({ name }), 'developer')).name).toBe(name);
    }
  });

  describe('names', () => {
    it('are unique per person for personal views, whatever the case or spacing', async () => {
      await made(body({ name: 'My Work' }), 'developer');
      for (const name of ['My Work', 'my work', '  MY WORK  ']) {
        const before = await viewCount();
        const response = await create(body({ name }), 'developer');
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe('conflict');
        expect(await viewCount()).toBe(before);
      }
    });

    it('may repeat across people, between personal and shared, and across workspaces', async () => {
      await made(body({ name: 'Backlog' }), 'developer');
      await made(body({ name: 'Backlog' }), 'reviewer');
      await made(body({ name: 'Backlog', scope: 'shared' }), 'owner');
      const nora = await create(
        body({ name: 'Backlog', scope: 'shared' }),
        'other-owner',
        f.northwindId,
      );
      expect(nora.statusCode).toBe(201);
    });

    it('are unique across the workspace for shared views, whoever made them', async () => {
      await made(body({ name: 'Team', scope: 'shared' }), 'owner');
      const again = await create(body({ name: 'team', scope: 'shared' }), 'admin');
      expect(again.statusCode).toBe(409);
    });

    it('let exactly one of two simultaneous creations win', async () => {
      const before = await viewCount();
      const responses = await Promise.all([
        create(body({ name: 'Race' }), 'developer'),
        create(body({ name: 'race' }), 'developer'),
      ]);
      expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(await viewCount()).toBe(before + 1);
    });
  });

  describe('refuses bad input with 422 and writes nothing', () => {
    const cases: [string, unknown][] = [
      ['no name', { scope: 'personal', definition: definition() }],
      ['an empty name', body({ name: '' })],
      ['an 81-character name', body({ name: 'a'.repeat(81) })],
      ['a NUL in the name', body({ name: 'a\u0000b' })],
      ['an unknown scope', body({ scope: 'public' })],
      ['no scope', { name: 'x', definition: definition() }],
      ['no definition', { name: 'x', scope: 'personal' }],
      ['an unknown display', body({ definition: definition({}, 'calendar') })],
      ['a page number in the definition', body({ definition: definition({ page: 2 }) })],
      ['an unknown filter', body({ definition: definition({ colour: 'red' }) })],
      ['an unknown sort', body({ definition: definition({ sort: 'password' }) })],
      ['21 projects', body({ definition: definition({ project: Array(21).fill('WEB') }) })],
      ['an owner the client chose', body({ ownerUserId: SOME_ID })],
      ['a workspace the client chose', body({ organisationId: SOME_ID })],
      ['an id the client chose', body({ id: SOME_ID })],
    ];
    it.each(cases)('%s', async (_label, payload) => {
      const before = await viewCount();
      const response = await create(payload, 'owner');
      expect(response.statusCode, response.body).toBe(422);
      expect(await viewCount()).toBe(before);
      expect(await viewAudits()).toHaveLength(0);
    });
  });

  it('records an audit event for a shared view, and none for a personal one', async () => {
    await made(body({ name: 'Mine' }), 'developer');
    expect(await viewAudits()).toHaveLength(0);

    const shared = await made(body({ name: 'Team', scope: 'shared' }), 'admin');
    const [event] = await viewAudits();
    expect(event).toMatchObject({
      action: 'view.created',
      organisationId: f.acmeId,
      actorUserId: f.userId('admin'),
      outcome: 'success',
      source: 'user',
      targetType: 'view',
      targetId: shared.id,
      after: { name: 'Team', scope: 'shared' },
    });
  });
});

describe('listing views', () => {
  beforeEach(async () => {
    await made(body({ name: 'b view' }), 'developer');
    await made(body({ name: 'A view' }), 'developer');
    await made(body({ name: 'Riley' }), 'reviewer');
    await made(body({ name: 'Team view', scope: 'shared' }), 'owner');
    await made(body({ name: 'Alpha team', scope: 'shared' }), 'admin');
  });

  it("shows a person their own views and everyone's shared ones, personal first, by name", async () => {
    expect(await names('developer')).toEqual(['A view', 'b view', 'Alpha team', 'Team view']);
    expect(await names('reviewer')).toEqual(['Riley', 'Alpha team', 'Team view']);
    expect(await names('readonly')).toEqual(['Alpha team', 'Team view']);
    expect(await names('owner')).toEqual(['Alpha team', 'Team view']);
  });

  it("never shows another workspace's views, or someone else's personal ones", async () => {
    const nora = await create(body({ name: 'Nora only' }), 'other-owner', f.northwindId);
    expect(nora.statusCode).toBe(201);
    expect(await names('other-owner', f.northwindId)).toEqual(['Nora only']);
    expect(await names('developer')).not.toContain('Nora only');
    expect(await names('developer')).not.toContain('Riley');
  });

  it('is refused to restricted members and strangers', async () => {
    expect((await list('restricted')).statusCode).toBe(403);
    expect((await list('other-owner')).statusCode).toBe(404);
  });
});

describe('changing a view', () => {
  it("lets the owner rename it and change what it shows, and moves its 'updated' time", async () => {
    const view = await made(body({ name: 'Before' }), 'developer');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const response = await patch(
      view.id,
      { name: ' After ', definition: definition({ priority: ['high'] }, 'board') },
      'developer',
    );
    expect(response.statusCode, response.body).toBe(200);
    const changed = savedViewSchema.parse(response.json());
    expect(changed).toMatchObject({
      id: view.id,
      name: 'After',
      scope: 'personal',
      ownerUserId: f.userId('developer'),
    });
    expect(changed.definition.display).toBe('board');
    expect(changed.definition.filters.priority).toEqual(['high']);
    expect(Date.parse(changed.updatedAt)).toBeGreaterThan(Date.parse(view.updatedAt));
  });

  it('can change just the name, or just the definition', async () => {
    const view = await made(body({ name: 'Keep' }), 'developer');
    const renamed = savedViewSchema.parse(
      (await patch(view.id, { name: 'Renamed' }, 'developer')).json(),
    );
    expect(renamed.definition).toEqual(view.definition);
    const reshaped = savedViewSchema.parse(
      (await patch(view.id, { definition: definition({}, 'board') }, 'developer')).json(),
    );
    expect(reshaped).toMatchObject({ name: 'Renamed' });
    expect(reshaped.definition.display).toBe('board');
  });

  it("does not let anyone touch another person's personal view, not even an owner: it is not there for them", async () => {
    const view = await made(body({ name: 'Private' }), 'developer');
    for (const identity of ['owner', 'admin', 'reviewer', 'readonly']) {
      expect((await patch(view.id, { name: 'Hijacked' }, identity)).statusCode).toBe(404);
    }
    expect((await rowOf(view.id))!.name).toBe('Private');
  });

  it('lets a manager edit any shared view, and nobody else', async () => {
    const view = await made(body({ name: 'Team', scope: 'shared' }), 'owner');
    expect((await patch(view.id, { name: 'Team 2' }, 'admin')).statusCode).toBe(200);
    for (const identity of ['developer', 'reviewer', 'readonly']) {
      expect((await patch(view.id, { name: 'Hijacked' }, identity)).statusCode).toBe(403);
    }
    expect((await rowOf(view.id))!.name).toBe('Team 2');
    expect((await patch(view.id, { name: 'x' }, 'restricted')).statusCode).toBe(403);
    expect((await patch(view.id, { name: 'x' }, 'other-owner')).statusCode).toBe(404);
    expect((await patch(view.id, { name: 'x' })).statusCode).toBe(401);
  });

  it('refuses a name already taken in the same scope, but allows changing only its case', async () => {
    await made(body({ name: 'Taken' }), 'developer');
    const mine = await made(body({ name: 'Mine' }), 'developer');
    expect((await patch(mine.id, { name: 'TAKEN' }, 'developer')).statusCode).toBe(409);
    expect((await rowOf(mine.id))!.name).toBe('Mine');
    expect((await patch(mine.id, { name: 'MINE' }, 'developer')).statusCode).toBe(200);

    await made(body({ name: 'Team', scope: 'shared' }), 'owner');
    const other = await made(body({ name: 'Other', scope: 'shared' }), 'owner');
    expect((await patch(other.id, { name: 'team' }, 'admin')).statusCode).toBe(409);
  });

  describe('refuses bad input with 422 and changes nothing', () => {
    const cases: [string, unknown][] = [
      ['nothing to change', {}],
      ['a scope change', { scope: 'shared' }],
      ['an owner change', { ownerUserId: SOME_ID }],
      ['an empty name', { name: '' }],
      ['an unknown filter', { definition: definition({ colour: 'red' }) }],
      ['a page in the definition', { definition: definition({ page: 3 }) }],
      ['an unknown key', { name: 'x', extra: 1 }],
    ];
    it.each(cases)('%s', async (_label, payload) => {
      const view = await made(body({ name: 'Stable' }), 'developer');
      const response = await patch(view.id, payload, 'developer');
      expect(response.statusCode, response.body).toBe(422);
      expect(await rowOf(view.id)).toMatchObject({ name: 'Stable', scope: 'personal' });
    });
  });

  it.each(['not-a-uuid', '..%2Fx', SOME_ID])('finds nothing for the id %s', async (id) => {
    expect((await patch(id, { name: 'x' }, 'developer')).statusCode).toBe(404);
  });

  it("does not reach another workspace's view through this workspace's address", async () => {
    const nora = savedViewSchema.parse(
      (await create(body({ name: 'Nora' }), 'other-owner', f.northwindId)).json(),
    );
    expect((await patch(nora.id, { name: 'x' }, 'owner')).statusCode).toBe(404);
    expect((await patch(nora.id, { name: 'x' }, 'other-owner', f.acmeId)).statusCode).toBe(404);
    expect((await rowOf(nora.id))!.name).toBe('Nora');
  });

  it('records an audit event for a shared view only', async () => {
    const mine = await made(body({ name: 'Mine' }), 'developer');
    await patch(mine.id, { name: 'Mine 2' }, 'developer');
    expect(await viewAudits()).toHaveLength(0);

    const shared = await made(body({ name: 'Team', scope: 'shared' }), 'owner');
    await patch(shared.id, { name: 'Team 2' }, 'admin');
    const events = await viewAudits();
    expect(events.map((e) => e.action).sort()).toEqual(['view.created', 'view.updated']);
    expect(events.find((e) => e.action === 'view.updated')).toMatchObject({
      actorUserId: f.userId('admin'),
      targetId: shared.id,
      before: { name: 'Team', scope: 'shared' },
      after: { name: 'Team 2', scope: 'shared' },
    });
  });
});

describe("another workspace's shared views", () => {
  // A shared view is visible to everyone in its own workspace, so only the workspace check keeps
  // a manager in one workspace away from it. Personal views are protected by ownership as well.
  it('cannot be read, changed or deleted through this workspace, even by a manager here', async () => {
    const theirs = savedViewSchema.parse(
      (
        await create(
          body({ name: 'Northwind team', scope: 'shared' }),
          'other-owner',
          f.northwindId,
        )
      ).json(),
    );

    expect(await names('owner')).not.toContain('Northwind team');
    expect((await patch(theirs.id, { name: 'Hijacked' }, 'owner')).statusCode).toBe(404);
    expect((await remove(theirs.id, 'owner')).statusCode).toBe(404);
    expect((await patch(theirs.id, { name: 'Hijacked' }, 'other-owner', f.acmeId)).statusCode).toBe(
      404,
    );
    expect((await remove(theirs.id, 'other-owner', f.acmeId)).statusCode).toBe(404);

    expect(await rowOf(theirs.id)).toMatchObject({ name: 'Northwind team' });
    expect(await viewAudits()).toHaveLength(1); // only its creation
  });
});

describe('deleting a view', () => {
  it('lets the owner delete a personal view; a second delete finds nothing', async () => {
    const view = await made(body({ name: 'Gone' }), 'developer');
    const response = await remove(view.id, 'developer');
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(await rowOf(view.id)).toBeUndefined();
    expect((await remove(view.id, 'developer')).statusCode).toBe(404);
  });

  it("does not let anyone delete another person's personal view", async () => {
    const view = await made(body({ name: 'Private' }), 'developer');
    for (const identity of ['owner', 'admin', 'reviewer', 'readonly']) {
      expect((await remove(view.id, identity)).statusCode).toBe(404);
    }
    expect(await rowOf(view.id)).toBeDefined();
  });

  it('lets a manager delete any shared view, and nobody else', async () => {
    const view = await made(body({ name: 'Team', scope: 'shared' }), 'owner');
    for (const identity of ['developer', 'reviewer', 'readonly', 'restricted']) {
      expect((await remove(view.id, identity)).statusCode).toBe(403);
    }
    expect((await remove(view.id, 'other-owner')).statusCode).toBe(404);
    expect((await remove(view.id)).statusCode).toBe(401);
    expect(await rowOf(view.id)).toBeDefined();

    expect((await remove(view.id, 'admin')).statusCode).toBe(204);
    expect(await rowOf(view.id)).toBeUndefined();
  });

  it.each(['not-a-uuid', SOME_ID])('finds nothing for the id %s', async (id) => {
    expect((await remove(id, 'owner')).statusCode).toBe(404);
  });

  it("does not reach another workspace's view", async () => {
    const nora = savedViewSchema.parse(
      (await create(body({ name: 'Nora' }), 'other-owner', f.northwindId)).json(),
    );
    expect((await remove(nora.id, 'owner')).statusCode).toBe(404);
    expect(await rowOf(nora.id)).toBeDefined();
  });

  it('records an audit event for a shared view only', async () => {
    const mine = await made(body({ name: 'Mine' }), 'developer');
    await remove(mine.id, 'developer');
    expect(await viewAudits()).toHaveLength(0);

    const shared = await made(body({ name: 'Team', scope: 'shared' }), 'owner');
    await remove(shared.id, 'admin');
    expect((await viewAudits()).find((e) => e.action === 'view.deleted')).toMatchObject({
      actorUserId: f.userId('admin'),
      targetId: shared.id,
      before: { name: 'Team', scope: 'shared' },
    });
  });
});
