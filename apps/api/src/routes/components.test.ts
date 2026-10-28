import { auditEvents, components } from '@forge/db';
import { componentSchema, projectDetailSchema, ticketConfigSchema } from '@forge/shared';
import { eq } from 'drizzle-orm';
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
  f = await loadFacts(ctx.db);
});

afterAll(async () => {
  await ctx.close();
});

const createComponent = (projectKey: string, payload: unknown, cookie?: string, orgId = f.acmeId) =>
  ctx.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/projects/${projectKey}/components`,
    payload: payload as object,
    headers: cookie ? { cookie } : {},
  });
const componentCount = async () => (await ctx.db.select().from(components)).length;
const componentAudits = async () =>
  ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'component.created'));
const get = async (url: string, as = 'owner') =>
  ctx.app.inject({ method: 'GET', url, headers: { cookie: await ctx.cookieFor(as) } });

describe('who may add a component', () => {
  const matrix: [string, number][] = [
    ['owner', 201],
    ['admin', 201],
    ['developer', 403],
    ['reviewer', 403],
    ['readonly', 403],
    ['restricted', 403],
    ['other-owner', 404],
  ];

  it.each(matrix)('%s gets %i', async (identity, expected) => {
    const before = await componentCount();
    const response = await createComponent(
      'WEB',
      { name: 'Billing' },
      await ctx.cookieFor(identity),
    );
    expect(response.statusCode).toBe(expected);
    expect(await componentCount()).toBe(before + (expected === 201 ? 1 : 0));
  });

  it('answers 401 to someone who is not signed in', async () => {
    const before = await componentCount();
    expect((await createComponent('WEB', { name: 'Billing' })).statusCode).toBe(401);
    expect(await componentCount()).toBe(before);
  });
});

describe('adding a component', () => {
  it('stores it in the project, returns it, lists it, and records an audit event', async () => {
    const response = await createComponent(
      'WEB',
      { name: '  Billing  ' },
      await ctx.cookieFor('admin'),
    );
    expect(response.statusCode).toBe(201);
    const created = componentSchema.parse(response.json());
    expect(created).toMatchObject({ name: 'Billing', projectId: f.projectId('WEB') });

    const [row] = await ctx.db.select().from(components).where(eq(components.id, created.id));
    expect(row).toMatchObject({ organisationId: f.acmeId, projectId: f.projectId('WEB') });

    const detail = projectDetailSchema.parse(
      (await get(`/api/v1/orgs/${f.acmeId}/projects/WEB`)).json(),
    );
    expect(detail.components.find((c) => c.id === created.id)).toEqual(created);
    const config = ticketConfigSchema.parse(
      (await get(`/api/v1/orgs/${f.acmeId}/ticket-config`)).json(),
    );
    expect(config.components.find((c) => c.id === created.id)).toEqual(created);
    // It belongs to WEB only.
    const api = projectDetailSchema.parse(
      (await get(`/api/v1/orgs/${f.acmeId}/projects/API`)).json(),
    );
    expect(api.components.map((c) => c.id)).not.toContain(created.id);

    const [event] = await componentAudits();
    expect(event).toMatchObject({
      organisationId: f.acmeId,
      actorUserId: f.userId('admin'),
      outcome: 'success',
      source: 'user',
      targetType: 'component',
      targetId: created.id,
      after: { project: 'WEB', name: 'Billing' },
    });
  });

  it('can be put on a ticket of that project straight away', async () => {
    const created = componentSchema.parse(
      (await createComponent('WEB', { name: 'Billing' }, await ctx.cookieFor('owner'))).json(),
    );
    const ticket = f.ticket('WEB-1');
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-1`,
      payload: { version: ticket.version, componentId: created.id },
      headers: { cookie: await ctx.cookieFor('developer') },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().component).toEqual(created);
  });

  it('finds the project whatever the case of its key', async () => {
    const response = await createComponent(
      'web',
      { name: 'Billing' },
      await ctx.cookieFor('owner'),
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().projectId).toBe(f.projectId('WEB'));
  });

  describe('a name already used in the project, whatever its case or spacing, gets 409', () => {
    it.each(['Frontend', 'FRONTEND', 'frontend', '  Frontend  '])('%j', async (name) => {
      const before = await componentCount();
      const response = await createComponent('WEB', { name }, await ctx.cookieFor('owner'));
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('conflict');
      expect(await componentCount()).toBe(before);
      expect(await componentAudits()).toHaveLength(0);
    });
  });

  it('allows the same name in another project, and in another workspace', async () => {
    const owner = await ctx.cookieFor('owner');
    expect((await createComponent('WEB', { name: 'Billing' }, owner)).statusCode).toBe(201);
    expect((await createComponent('API', { name: 'Billing' }, owner)).statusCode).toBe(201);
    expect(
      (
        await createComponent(
          'OPS',
          { name: 'Billing' },
          await ctx.cookieFor('other-owner'),
          f.northwindId,
        )
      ).statusCode,
    ).toBe(201);
  });

  it('lets exactly one of two simultaneous creations of the same name win', async () => {
    const owner = await ctx.cookieFor('owner');
    const before = await componentCount();
    const responses = await Promise.all([
      createComponent('WEB', { name: 'Race' }, owner),
      createComponent('WEB', { name: 'race' }, owner),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await componentCount()).toBe(before + 1);
  });

  describe('a project that is not there or not theirs gets a plain 404, and writes nothing', () => {
    it.each(['NOPE', 'W', 'WEB-1', '..%2Fx', 'OPS'])('%s', async (key) => {
      const before = await componentCount();
      const response = await createComponent(
        key,
        { name: 'Billing' },
        await ctx.cookieFor('owner'),
      );
      expect(response.statusCode).toBe(404);
      expect(await componentCount()).toBe(before);
    });

    it("Acme's project through Northwind's address, and the reverse", async () => {
      const before = await componentCount();
      expect(
        (
          await createComponent(
            'WEB',
            { name: 'Billing' },
            await ctx.cookieFor('other-owner'),
            f.northwindId,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await createComponent(
            'OPS',
            { name: 'Billing' },
            await ctx.cookieFor('owner'),
            f.northwindId,
          )
        ).statusCode,
      ).toBe(404);
      expect(await componentCount()).toBe(before);
    });
  });

  describe('refuses bad input with 422 and writes nothing', () => {
    const id = '01a1656b-1a49-7146-94ac-1c72df43ddb4';
    const cases: [string, unknown][] = [
      ['no name', {}],
      ['an empty name', { name: '' }],
      ['a blank name', { name: '  ' }],
      ['61 characters', { name: 'a'.repeat(61) }],
      ['a line break', { name: 'a\nb' }],
      ['a NUL character', { name: 'a\u0000b' }],
      ['a name that is not text', { name: 7 }],
      ['a project the client chose', { name: 'Billing', projectId: id }],
      ['a workspace the client chose', { name: 'Billing', organisationId: id }],
    ];

    it.each(cases)('%s', async (_label, payload) => {
      const before = await componentCount();
      const response = await createComponent('WEB', payload, await ctx.cookieFor('owner'));
      expect(response.statusCode).toBe(422);
      expect(await componentCount()).toBe(before);
      expect(await componentAudits()).toHaveLength(0);
    });
  });

  it('keeps markup, emoji and right-to-left text exactly as typed', async () => {
    const owner = await ctx.cookieFor('owner');
    for (const name of ['<img src=x onerror=alert(1)>', 'مرحبا 👋', 'a'.repeat(60)]) {
      const response = await createComponent('WEB', { name }, owner);
      expect(response.statusCode).toBe(201);
      expect(componentSchema.parse(response.json()).name).toBe(name);
    }
  });
});
