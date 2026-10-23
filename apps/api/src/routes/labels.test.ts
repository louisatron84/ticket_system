import { auditEvents, labels } from '@forge/db';
import { labelSchema, ticketConfigSchema } from '@forge/shared';
import { eq } from 'drizzle-orm';
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

const createLabel = (payload: unknown, cookie?: string, orgId = f.acmeId) =>
  ctx.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgId}/labels`,
    payload: payload as object,
    headers: cookie ? { cookie } : {},
  });
const labelCount = async () => (await ctx.db.select().from(labels)).length;
const labelAudits = async () =>
  ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'label.created'));

const config = async (as = 'owner', orgId = f.acmeId) =>
  ticketConfigSchema.parse(
    (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${orgId}/ticket-config`,
        headers: { cookie: await ctx.cookieFor(as) },
      })
    ).json(),
  );

describe('who may create labels', () => {
  const matrix: [string, number][] = [
    ['owner', 201],
    ['admin', 201],
    ['developer', 201],
    ['reviewer', 403],
    ['readonly', 403],
    ['restricted', 403],
    ['other-owner', 404],
  ];

  it.each(matrix)('%s gets %i', async (identity, expected) => {
    const before = await labelCount();
    const response = await createLabel(
      { name: 'urgent-fix', color: 'red' },
      await ctx.cookieFor(identity),
    );
    expect(response.statusCode).toBe(expected);
    expect(await labelCount()).toBe(before + (expected === 201 ? 1 : 0));
  });

  it('answers 401 to someone who is not signed in', async () => {
    const before = await labelCount();
    expect((await createLabel({ name: 'urgent-fix', color: 'red' })).statusCode).toBe(401);
    expect(await labelCount()).toBe(before);
  });
});

describe('creating a label', () => {
  it('stores it in the workspace, returns it, lists it, and records an audit event', async () => {
    const response = await createLabel(
      { name: '  Customer reported  ', color: 'amber' },
      await ctx.cookieFor('developer'),
    );
    expect(response.statusCode).toBe(201);
    const created = labelSchema.parse(response.json());
    expect(created).toMatchObject({ name: 'Customer reported', color: 'amber' });

    const [row] = await ctx.db.select().from(labels).where(eq(labels.id, created.id));
    expect(row).toMatchObject({ organisationId: f.acmeId, name: 'Customer reported' });

    const listed = (await config()).labels;
    expect(listed.find((l) => l.id === created.id)).toEqual(created);
    // Still in the order people read them: by name, ignoring case.
    const names = listed.map((l) => l.name.toLowerCase());
    expect(names).toEqual([...names].sort());
    // Another workspace does not see it.
    expect((await config('other-owner', f.northwindId)).labels.map((l) => l.id)).not.toContain(
      created.id,
    );

    const [event] = await labelAudits();
    expect(event).toMatchObject({
      organisationId: f.acmeId,
      actorUserId: f.userId('developer'),
      outcome: 'success',
      source: 'user',
      targetType: 'label',
      targetId: created.id,
      after: { name: 'Customer reported', color: 'amber' },
    });
  });

  it('keeps markup, emoji and right-to-left text exactly as typed', async () => {
    const owner = await ctx.cookieFor('owner');
    for (const name of ['<img src=x onerror=alert(1)>', 'مرحبا 👋', 'a'.repeat(40)]) {
      const response = await createLabel({ name, color: 'blue' }, owner);
      expect(response.statusCode).toBe(201);
      expect(labelSchema.parse(response.json()).name).toBe(name);
    }
  });

  describe('a name that is already taken, whatever its case or spacing, gets 409', () => {
    it.each(['bug', 'BUG', 'Bug', '  bug  '])('%j', async (name) => {
      const before = await labelCount();
      const response = await createLabel({ name, color: 'red' }, await ctx.cookieFor('owner'));
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('conflict');
      expect(await labelCount()).toBe(before);
      expect(await labelAudits()).toHaveLength(0);
    });
  });

  it('lets another workspace use the same name', async () => {
    expect(
      (await createLabel({ name: 'shared-name', color: 'teal' }, await ctx.cookieFor('owner')))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await createLabel(
          { name: 'shared-name', color: 'teal' },
          await ctx.cookieFor('other-owner'),
          f.northwindId,
        )
      ).statusCode,
    ).toBe(201);
  });

  it('lets exactly one of two simultaneous creations of the same name win', async () => {
    const owner = await ctx.cookieFor('owner');
    const before = await labelCount();
    const responses = await Promise.all([
      createLabel({ name: 'Race', color: 'red' }, owner),
      createLabel({ name: 'race', color: 'blue' }, owner),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await labelCount()).toBe(before + 1);
    expect(await labelAudits()).toHaveLength(1);
  });

  describe('refuses bad input with 422 and writes nothing', () => {
    const cases: [string, unknown][] = [
      ['a colour outside the list', { name: 'x', color: 'pink' }],
      ['an uppercase colour', { name: 'x', color: 'Red' }],
      ['a hex colour', { name: 'x', color: '#ff0000' }],
      ['no colour', { name: 'x' }],
      ['no name', { color: 'red' }],
      ['an empty name', { name: '', color: 'red' }],
      ['a blank name', { name: '   ', color: 'red' }],
      ['41 characters', { name: 'a'.repeat(41), color: 'red' }],
      ['a line break in the name', { name: 'a\nb', color: 'red' }],
      ['a NUL character', { name: 'a\u0000b', color: 'red' }],
      ['a name that is not text', { name: 7, color: 'red' }],
      ['an id the client chose', { name: 'x', color: 'red', id: SOME_ID }],
      ['a workspace the client chose', { name: 'x', color: 'red', organisationId: SOME_ID }],
    ];

    it.each(cases)('%s', async (_label, payload) => {
      const before = await labelCount();
      const response = await createLabel(payload, await ctx.cookieFor('owner'));
      expect(response.statusCode).toBe(422);
      expect(await labelCount()).toBe(before);
      expect(await labelAudits()).toHaveLength(0);
    });
  });
});
