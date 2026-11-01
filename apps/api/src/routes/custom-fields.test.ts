import {
  auditEvents,
  customFieldOptions,
  customFields,
  projects,
  ticketEvents,
  ticketFieldValues,
} from '@forge/db';
import {
  apiErrorSchema,
  customFieldSchema,
  ticketDetailSchema,
  ticketListSchema,
  type CustomField,
} from '@forge/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, ticketRow, type Facts } from '../test-support/facts';
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

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = async (
  method: Method,
  path: string,
  options: { payload?: unknown; as?: string | null; orgId?: string } = {},
) =>
  ctx.app.inject({
    method,
    url: `/api/v1/orgs/${options.orgId ?? f.acmeId}${path}`,
    ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
    headers: options.as === null ? {} : { cookie: await ctx.cookieFor(options.as ?? 'owner') },
  });

const messageOf = (response: { json(): unknown }) =>
  apiErrorSchema.parse(response.json()).error.message;
const issuesOf = (response: { json(): unknown }) =>
  apiErrorSchema.parse(response.json()).error.details?.map((issue) => issue.message) ?? [];

async function createField(body: Record<string, unknown>, as = 'owner'): Promise<CustomField> {
  const response = await call('POST', '/custom-fields', { payload: body, as });
  expect(response.statusCode, response.body).toBe(201);
  return customFieldSchema.parse(response.json());
}

const version = async (key: string) => (await ticketRow(ctx.db, key))!.version;
const setValue = async (key: string, fieldId: string, value: unknown, as = 'owner') =>
  call('PUT', `/tickets/${key}/fields/${fieldId}`, {
    payload: { version: await version(key), value },
    as,
  });
const detailOf = async (key: string, as = 'owner') =>
  ticketDetailSchema.parse((await call('GET', `/tickets/${key}`, { as })).json());
const keysFor = async (query: string) =>
  ticketListSchema
    .parse((await call('GET', `/tickets?project=WEB&pageSize=100&${query}`)).json())
    .items.map((ticket) => ticket.key);
const audits = (action: string) =>
  ctx.db.select().from(auditEvents).where(eq(auditEvents.action, action));
const fieldCount = async () =>
  (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(customFields))[0]!.n;

describe('who may manage fields', () => {
  const matrix: [string, number][] = [
    ['owner', 201],
    ['admin', 201],
    ['developer', 403],
    ['reviewer', 403],
    ['readonly', 403],
    ['restricted', 403],
    ['other-owner', 404],
  ];

  it.each(matrix)('%s creating one gets %i', async (as, expected) => {
    const before = await fieldCount();
    const response = await call('POST', '/custom-fields', {
      payload: { name: 'Customer', kind: 'text' },
      as,
    });
    expect(response.statusCode).toBe(expected);
    expect(await fieldCount()).toBe(before + (expected === 201 ? 1 : 0));
  });

  it('answers 401 to someone who is not signed in', async () => {
    const response = await call('POST', '/custom-fields', {
      payload: { name: 'Customer', kind: 'text' },
      as: null,
    });
    expect(response.statusCode).toBe(401);
  });

  it('lets anyone who can see tickets read the fields, and no one else', async () => {
    const field = await createField({ name: 'Customer', kind: 'text' });
    for (const as of ['readonly', 'reviewer', 'developer']) {
      const response = await call('GET', '/custom-fields', { as });
      expect(response.statusCode).toBe(200);
      expect(
        customFieldSchema
          .array()
          .parse(response.json())
          .map((item) => item.id),
      ).toEqual([field.id]);
    }
    expect((await call('GET', '/custom-fields', { as: 'restricted' })).statusCode).toBe(403);
    // Another workspace sees only its own (none), and cannot reach this one's.
    const theirs = await call('GET', '/custom-fields', { as: 'other-owner', orgId: f.northwindId });
    expect(customFieldSchema.array().parse(theirs.json())).toEqual([]);
    expect((await call('GET', '/custom-fields', { as: 'other-owner' })).statusCode).toBe(404);
  });

  it("keeps every change to another workspace's field out of reach (404)", async () => {
    const field = await createField({ name: 'Size', kind: 'select', options: ['S', 'M'] });
    const option = field.options[0]!;
    const other = { as: 'other-owner', orgId: f.northwindId };
    const attempts = [
      call('PATCH', `/custom-fields/${field.id}`, { payload: { name: 'Mine' }, ...other }),
      call('DELETE', `/custom-fields/${field.id}`, other),
      call('POST', `/custom-fields/${field.id}/options`, { payload: { name: 'L' }, ...other }),
      call('PATCH', `/custom-fields/${field.id}/options/${option.id}`, {
        payload: { active: false },
        ...other,
      }),
      call('DELETE', `/custom-fields/${field.id}/options/${option.id}`, other),
      call('PUT', `/custom-fields/${field.id}/options/order`, {
        payload: { ids: field.options.map((item) => item.id) },
        ...other,
      }),
    ];
    for (const response of await Promise.all(attempts)) expect(response.statusCode).toBe(404);
    const [row] = await ctx.db.select().from(customFields).where(eq(customFields.id, field.id));
    expect(row).toMatchObject({ name: 'Size', isActive: true });
    expect(
      (
        await ctx.db
          .select()
          .from(customFieldOptions)
          .where(eq(customFieldOptions.fieldId, field.id))
      ).length,
    ).toBe(2);
  });
});

describe('creating and changing fields', () => {
  it('stores a field with its options and types, lists it in order, and audits it', async () => {
    const field = await createField({
      name: '  Customer tier ',
      description: 'Which plan the reporter is on.',
      kind: 'select',
      typeIds: [f.typeId('acme', 'bug')],
      options: ['Free', 'Pro', 'Enterprise'],
    });
    expect(field).toMatchObject({
      name: 'Customer tier',
      kind: 'select',
      typeIds: [f.typeId('acme', 'bug')],
      active: true,
      valueCount: 0,
    });
    expect(field.options.map((option) => [option.name, option.active, option.used])).toEqual([
      ['Free', true, false],
      ['Pro', true, false],
      ['Enterprise', true, false],
    ]);
    const second = await createField({ name: 'Estimate points', kind: 'number' });
    const listed = customFieldSchema.array().parse((await call('GET', '/custom-fields')).json());
    expect(listed.map((item) => item.id)).toEqual([field.id, second.id]);

    const [event] = await audits('custom_field.created');
    expect(event).toMatchObject({
      organisationId: f.acmeId,
      actorUserId: f.userId('owner'),
      targetType: 'custom_field',
      targetId: field.id,
      outcome: 'success',
    });
  });

  it('refuses a name already taken, whatever its case (409)', async () => {
    await createField({ name: 'Customer', kind: 'text' });
    const response = await call('POST', '/custom-fields', {
      payload: { name: 'CUSTOMER', kind: 'number' },
    });
    expect(response.statusCode).toBe(409);
    expect(messageOf(response)).toBe('A field named "CUSTOMER" already exists.');
  });

  it("refuses another workspace's ticket types (422)", async () => {
    const response = await call('POST', '/custom-fields', {
      payload: { name: 'X', kind: 'text', typeIds: [f.typeId('northwind', 'bug')] },
    });
    expect(response.statusCode).toBe(422);
    expect(await fieldCount()).toBe(0);
  });

  it('stops at 50 fields in a workspace', async () => {
    await ctx.db.insert(customFields).values(
      Array.from({ length: 50 }, (_, index) => ({
        organisationId: f.acmeId,
        name: `Field ${index}`,
        kind: 'text',
        sortOrder: index,
      })),
    );
    const response = await call('POST', '/custom-fields', {
      payload: { name: 'One more', kind: 'text' },
    });
    expect(response.statusCode).toBe(409);
    expect(messageOf(response)).toMatch(/at most 50 fields/);
    // Another workspace has its own allowance.
    expect(
      (
        await call('POST', '/custom-fields', {
          payload: { name: 'One more', kind: 'text' },
          as: 'other-owner',
          orgId: f.northwindId,
        })
      ).statusCode,
    ).toBe(201);
  });

  it('renames, changes the description and types, deactivates and reactivates, each audited', async () => {
    const field = await createField({ name: 'Customer', kind: 'text' });
    const patch = (payload: unknown) =>
      call('PATCH', `/custom-fields/${field.id}`, { payload, as: 'admin' });

    const renamed = customFieldSchema.parse(
      (
        await patch({
          name: 'Client',
          description: 'Who asked',
          typeIds: [f.typeId('acme', 'feature')],
        })
      ).json(),
    );
    expect(renamed).toMatchObject({
      name: 'Client',
      description: 'Who asked',
      typeIds: [f.typeId('acme', 'feature')],
      kind: 'text',
    });
    expect(customFieldSchema.parse((await patch({ active: false })).json()).active).toBe(false);
    expect(
      customFieldSchema.parse((await patch({ active: true, typeIds: [] })).json()),
    ).toMatchObject({ active: true, typeIds: [] });
    const events = await audits('custom_field.updated');
    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({ before: { active: true }, after: { active: false } });
  });

  it('never changes the kind (422)', async () => {
    const field = await createField({ name: 'Customer', kind: 'text' });
    const response = await call('PATCH', `/custom-fields/${field.id}`, {
      payload: { kind: 'number' },
    });
    expect(response.statusCode).toBe(422);
    const [row] = await ctx.db.select().from(customFields).where(eq(customFields.id, field.id));
    expect(row!.kind).toBe('text');
  });

  it('reorders all fields at once, and refuses a list that leaves one out', async () => {
    const a = await createField({ name: 'A', kind: 'text' });
    const b = await createField({ name: 'B', kind: 'number' });
    const c = await createField({ name: 'C', kind: 'boolean' });
    const response = await call('PUT', '/custom-fields/order', {
      payload: { ids: [c.id, a.id, b.id] },
    });
    expect(response.statusCode).toBe(200);
    expect(
      customFieldSchema
        .array()
        .parse(response.json())
        .map((item) => item.name),
    ).toEqual(['C', 'A', 'B']);
    expect(
      (await call('PUT', '/custom-fields/order', { payload: { ids: [c.id, a.id] } })).statusCode,
    ).toBe(422);
    expect(
      (await call('PUT', '/custom-fields/order', { payload: { ids: [c.id, a.id, SOME_ID] } }))
        .statusCode,
    ).toBe(422);
    expect(await audits('custom_field.reordered')).toHaveLength(1);
  });

  it('deletes a field nobody has used, and refuses one with a value (409)', async () => {
    const unused = await createField({ name: 'Unused', kind: 'select', options: ['x'] });
    expect((await call('DELETE', `/custom-fields/${unused.id}`)).statusCode).toBe(204);
    expect(await fieldCount()).toBe(0);
    expect(await audits('custom_field.deleted')).toHaveLength(1);

    const used = await createField({ name: 'Used', kind: 'text' });
    expect((await setValue('WEB-1', used.id, 'Acme')).statusCode).toBe(200);
    const response = await call('DELETE', `/custom-fields/${used.id}`);
    expect(response.statusCode).toBe(409);
    expect(messageOf(response)).toBe(
      'Tickets have values for this field, so it cannot be deleted. Turn it off instead.',
    );
    expect(await fieldCount()).toBe(1);
    expect((await call('DELETE', `/custom-fields/${SOME_ID}`)).statusCode).toBe(404);
  });
});

describe('options', () => {
  it('adds, renames, reorders, deactivates and removes options, each audited', async () => {
    const field = await createField({ name: 'Size', kind: 'multi_select', options: ['S', 'M'] });
    const added = customFieldSchema.parse(
      (await call('POST', `/custom-fields/${field.id}/options`, { payload: { name: 'L' } })).json(),
    );
    expect(added.options.map((option) => option.name)).toEqual(['S', 'M', 'L']);
    const [s, m, l] = added.options;

    const renamed = await call('PATCH', `/custom-fields/${field.id}/options/${l!.id}`, {
      payload: { name: 'Large' },
    });
    expect(customFieldSchema.parse(renamed.json()).options[2]!.name).toBe('Large');

    const reordered = await call('PUT', `/custom-fields/${field.id}/options/order`, {
      payload: { ids: [l!.id, m!.id, s!.id] },
    });
    expect(customFieldSchema.parse(reordered.json()).options.map((option) => option.name)).toEqual([
      'Large',
      'M',
      'S',
    ]);

    const off = await call('PATCH', `/custom-fields/${field.id}/options/${m!.id}`, {
      payload: { active: false },
    });
    expect(customFieldSchema.parse(off.json()).options[1]).toMatchObject({ active: false });

    const removed = await call('DELETE', `/custom-fields/${field.id}/options/${s!.id}`);
    expect(customFieldSchema.parse(removed.json()).options.map((option) => option.name)).toEqual([
      'Large',
      'M',
    ]);
    for (const action of ['created', 'updated', 'reordered', 'deleted']) {
      expect((await audits(`custom_field_option.${action}`)).length).toBeGreaterThan(0);
    }
  });

  it('refuses to remove an option in use (409) but lets it be turned off', async () => {
    const field = await createField({ name: 'Size', kind: 'select', options: ['S', 'M'] });
    const [s] = field.options;
    expect((await setValue('WEB-1', field.id, s!.id)).statusCode).toBe(200);
    const listed = customFieldSchema.array().parse((await call('GET', '/custom-fields')).json());
    expect(listed[0]!.options[0]).toMatchObject({ used: true });
    expect(listed[0]!.valueCount).toBe(1);

    const response = await call('DELETE', `/custom-fields/${field.id}/options/${s!.id}`);
    expect(response.statusCode).toBe(409);
    expect(messageOf(response)).toBe(
      'Tickets have "S" chosen, so it cannot be removed. Turn it off instead.',
    );
    expect(
      (
        await call('PATCH', `/custom-fields/${field.id}/options/${s!.id}`, {
          payload: { active: false },
        })
      ).statusCode,
    ).toBe(200);
    // The ticket keeps it, and still shows its name.
    const [shown] = (await detailOf('WEB-1')).fields;
    expect(shown).toMatchObject({ value: s!.id, text: 'S' });
    expect(shown!.options.map((option) => [option.name, option.active])).toEqual([
      ['S', false],
      ['M', true],
    ]);
  });

  it('refuses a duplicate name (409), options on a field without them (409) and the 101st', async () => {
    const field = await createField({ name: 'Size', kind: 'select', options: ['S'] });
    const duplicate = await call('POST', `/custom-fields/${field.id}/options`, {
      payload: { name: 's' },
    });
    expect(duplicate.statusCode).toBe(409);

    const text = await createField({ name: 'Notes', kind: 'text' });
    expect(
      (await call('POST', `/custom-fields/${text.id}/options`, { payload: { name: 'x' } }))
        .statusCode,
    ).toBe(409);

    await ctx.db.insert(customFieldOptions).values(
      Array.from({ length: 99 }, (_, index) => ({
        organisationId: f.acmeId,
        fieldId: field.id,
        name: `Option ${index}`,
        sortOrder: index + 1,
      })),
    );
    const tooMany = await call('POST', `/custom-fields/${field.id}/options`, {
      payload: { name: 'One more' },
    });
    expect(tooMany.statusCode).toBe(409);
    expect(messageOf(tooMany)).toMatch(/at most 100 options/);
  });

  it('needs fields.manage', async () => {
    const field = await createField({ name: 'Size', kind: 'select', options: ['S'] });
    for (const as of ['developer', 'readonly']) {
      expect(
        (await call('POST', `/custom-fields/${field.id}/options`, { payload: { name: 'M' }, as }))
          .statusCode,
      ).toBe(403);
    }
  });
});

describe("setting a ticket's value", () => {
  it('sets each kind, shows it on the ticket and its summary, and writes the history', async () => {
    const tier = await createField({ name: 'Tier', kind: 'select', options: ['Free', 'Pro'] });
    const areas = await createField({
      name: 'Areas',
      kind: 'multi_select',
      options: ['Login', 'Billing', 'Search'],
    });
    const cases: [CustomField, unknown, string][] = [
      [await createField({ name: 'Customer', kind: 'text' }), '  Acme  ', 'Acme'],
      [
        await createField({ name: 'Notes', kind: 'long_text' }),
        'Line\n\n**bold**',
        'Line\n\n**bold**',
      ],
      [await createField({ name: 'Points', kind: 'number' }), 2.5, '2.5'],
      [await createField({ name: 'Hotfix', kind: 'boolean' }), false, 'No'],
      [await createField({ name: 'Release', kind: 'date' }), '2026-12-01', '2026-12-01'],
      [
        await createField({ name: 'Spec', kind: 'url' }),
        'https://example.com/spec',
        'https://example.com/spec',
      ],
      [
        await createField({ name: 'Owner', kind: 'person' }),
        f.userId('reviewer'),
        'Riley Reviewer',
      ],
      [tier, tier.options[1]!.id, 'Pro'],
      // Shown in the field's order, not the order picked.
      [areas, [areas.options[2]!.id, areas.options[0]!.id], 'Login, Search'],
    ];

    for (const [field, value, text] of cases) {
      const before = await version('WEB-1');
      const response = await setValue('WEB-1', field.id, value, 'developer');
      expect(response.statusCode, `${field.name}: ${response.body}`).toBe(200);
      const detail = ticketDetailSchema.parse(response.json());
      expect(detail.version).toBe(before + 1);
      expect(detail.fields.find((item) => item.fieldId === field.id)!.text).toBe(text);
    }

    const detail = await detailOf('WEB-1');
    // Every field that applies, in the workspace's order.
    expect(detail.fields.map((item) => item.name)).toEqual([
      'Tier',
      'Areas',
      'Customer',
      'Notes',
      'Points',
      'Hotfix',
      'Release',
      'Spec',
      'Owner',
    ]);
    expect(detail.fieldValues.find((item) => item.name === 'Hotfix')).toMatchObject({ text: 'No' });

    const [summary] = ticketListSchema
      .parse((await call('GET', '/tickets?q=WEB-1&project=WEB')).json())
      .items.filter((item) => item.key === 'WEB-1');
    expect(summary!.fieldValues.map((item) => [item.name, item.text])).toEqual([
      ['Tier', 'Pro'],
      ['Areas', 'Login, Search'],
      ['Customer', 'Acme'],
      ['Notes', 'Line\n\n**bold**'],
      ['Points', '2.5'],
      ['Hotfix', 'No'],
      ['Release', '2026-12-01'],
      ['Spec', 'https://example.com/spec'],
      ['Owner', 'Riley Reviewer'],
    ]);

    const history = await ctx.db
      .select({ data: ticketEvents.data })
      .from(ticketEvents)
      .where(
        and(
          eq(ticketEvents.ticketId, f.ticket('WEB-1').id),
          eq(ticketEvents.type, 'field.changed'),
        ),
      )
      .orderBy(ticketEvents.createdAt);
    expect(history.map((event) => event.data)).toContainEqual({
      field: 'Customer',
      from: null,
      to: 'Acme',
    });
    // A long text is only said to have changed.
    expect(history.map((event) => event.data)).toContainEqual({
      field: 'Notes',
      from: null,
      to: null,
    });
  });

  it('records old and new values when changing and clearing, and a no-op changes nothing', async () => {
    const field = await createField({ name: 'Customer', kind: 'text' });
    await setValue('WEB-1', field.id, 'Acme');
    await setValue('WEB-1', field.id, 'Globex');
    const unchanged = await version('WEB-1');
    expect((await setValue('WEB-1', field.id, 'Globex')).statusCode).toBe(200);
    expect(await version('WEB-1')).toBe(unchanged);

    const cleared = ticketDetailSchema.parse((await setValue('WEB-1', field.id, null)).json());
    expect(cleared.fields[0]).toMatchObject({ value: null, text: null });
    expect(cleared.fieldValues).toEqual([]);
    expect(await ctx.db.select().from(ticketFieldValues)).toEqual([]);

    const history = await ctx.db
      .select({ data: ticketEvents.data })
      .from(ticketEvents)
      .where(eq(ticketEvents.type, 'field.changed'))
      .orderBy(ticketEvents.createdAt);
    expect(history.map((event) => event.data)).toEqual([
      { field: 'Customer', from: null, to: 'Acme' },
      { field: 'Customer', from: 'Acme', to: 'Globex' },
      { field: 'Customer', from: 'Globex', to: null },
    ]);
  });

  it('refuses a stale version (409) and writes nothing', async () => {
    const field = await createField({ name: 'Customer', kind: 'text' });
    const stale = (await version('WEB-1')) - 1 || 99;
    const response = await call('PUT', `/tickets/WEB-1/fields/${field.id}`, {
      payload: { version: stale, value: 'Acme' },
    });
    expect(response.statusCode).toBe(409);
    expect(await ctx.db.select().from(ticketFieldValues)).toEqual([]);
  });

  it('lets exactly one of two simultaneous edits from the same version win', async () => {
    const field = await createField({ name: 'Customer', kind: 'text' });
    const seen = await version('WEB-1');
    const responses = await Promise.all(
      ['Acme', 'Globex'].map((value) =>
        call('PUT', `/tickets/WEB-1/fields/${field.id}`, { payload: { version: seen, value } }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
  });

  it('needs tickets.edit, and is out of reach from another workspace', async () => {
    const field = await createField({ name: 'Customer', kind: 'text' });
    for (const as of ['reviewer', 'readonly', 'restricted']) {
      expect((await setValue('WEB-1', field.id, 'x', as)).statusCode).toBe(403);
    }
    expect((await setValue('WEB-1', field.id, 'x', 'other-owner')).statusCode).toBe(404);
    // A Northwind ticket with an Acme field, and an unknown field, are not found.
    const ops = await call('PUT', `/tickets/OPS-1/fields/${field.id}`, {
      payload: { version: await version('OPS-1'), value: 'x' },
      as: 'other-owner',
      orgId: f.northwindId,
    });
    expect(ops.statusCode).toBe(404);
    expect((await setValue('WEB-1', SOME_ID, 'x')).statusCode).toBe(404);
    expect((await setValue('WEB-1', 'not-an-id', 'x')).statusCode).toBe(404);
    expect(await ctx.db.select().from(ticketFieldValues)).toEqual([]);
  });

  describe('checks the value against the kind (422)', () => {
    const cases: [string, Record<string, unknown>, unknown][] = [
      ['text too long', { kind: 'text' }, 'x'.repeat(501)],
      ['text on two lines', { kind: 'text' }, 'a\nb'],
      ['long text too long', { kind: 'long_text' }, 'x'.repeat(10_001)],
      ['long text with a control character', { kind: 'long_text' }, 'a\u0007b'],
      ['a number as text', { kind: 'number' }, '5'],
      ['a yes/no as text', { kind: 'boolean' }, 'yes'],
      ['a date that does not exist', { kind: 'date' }, '2026-02-30'],
      ['a javascript link', { kind: 'url' }, 'javascript:alert(1)'],
      ['an ftp link', { kind: 'url' }, 'ftp://example.com/file'],
      ['a person who is not an id', { kind: 'person' }, 'Rachel'],
      ['a select with two values', { kind: 'select', options: ['A'] }, [SOME_ID]],
      ['an unknown option', { kind: 'select', options: ['A'] }, SOME_ID],
      [
        'a multi-select with a repeat',
        { kind: 'multi_select', options: ['A'] },
        [SOME_ID, SOME_ID],
      ],
      ['no value at all', { kind: 'text' }, undefined],
    ];
    it.each(cases)('%s', async (_name, definition, value) => {
      const field = await createField({ name: 'Field', ...definition });
      const before = await version('WEB-1');
      const response = await call('PUT', `/tickets/WEB-1/fields/${field.id}`, {
        payload: value === undefined ? { version: before } : { version: before, value },
      });
      expect(response.statusCode).toBe(422);
      expect(await version('WEB-1')).toBe(before);
      expect(await ctx.db.select().from(ticketFieldValues)).toEqual([]);
    });
  });

  it("refuses an inactive option, another field's option, and more than 20 options", async () => {
    const field = await createField({ name: 'Areas', kind: 'multi_select', options: ['A', 'B'] });
    const other = await createField({ name: 'Other', kind: 'select', options: ['C'] });
    await call('PATCH', `/custom-fields/${field.id}/options/${field.options[1]!.id}`, {
      payload: { active: false },
    });
    const inactive = await setValue('WEB-1', field.id, [field.options[1]!.id]);
    expect(inactive.statusCode).toBe(422);
    expect(issuesOf(inactive)).toEqual(['That is not one of the options of Areas.']);
    expect((await setValue('WEB-1', field.id, [other.options[0]!.id])).statusCode).toBe(422);

    const many = Array.from({ length: 21 }, (_, index) => ({
      organisationId: f.acmeId,
      fieldId: field.id,
      name: `More ${index}`,
      sortOrder: index + 2,
    }));
    const rows = await ctx.db
      .insert(customFieldOptions)
      .values(many)
      .returning({ id: customFieldOptions.id });
    const tooMany = await setValue(
      'WEB-1',
      field.id,
      rows.map((row) => row.id),
    );
    expect(tooMany.statusCode).toBe(422);
    expect(issuesOf(tooMany)).toEqual(['Choose at most 20.']);
  });

  it('keeps an inactive option the ticket already has when another is added', async () => {
    const field = await createField({ name: 'Areas', kind: 'multi_select', options: ['A', 'B'] });
    const [a, b] = field.options;
    await setValue('WEB-1', field.id, [a!.id]);
    await call('PATCH', `/custom-fields/${field.id}/options/${a!.id}`, {
      payload: { active: false },
    });
    const response = await setValue('WEB-1', field.id, [a!.id, b!.id]);
    expect(response.statusCode).toBe(200);
    expect(ticketDetailSchema.parse(response.json()).fields[0]!.text).toBe('A, B');
  });

  it('takes only a member who can see tickets as a person', async () => {
    const field = await createField({ name: 'Owner', kind: 'person' });
    // No permissions at all, so they cannot see the ticket they would be named on.
    expect((await setValue('WEB-1', field.id, f.userId('restricted'))).statusCode).toBe(422);
    // Someone from another workspace.
    const outsider = await setValue('WEB-1', field.id, f.userId('other-owner'));
    expect(outsider.statusCode).toBe(422);
    expect(issuesOf(outsider)).toEqual([
      'Choose a member of this workspace who can see its tickets.',
    ]);
    expect((await setValue('WEB-1', field.id, f.userId('reporter'))).statusCode).toBe(200);
  });

  it('applies only to the chosen ticket types', async () => {
    const field = await createField({
      name: 'Steps to reproduce',
      kind: 'long_text',
      typeIds: [f.typeId('acme', 'bug')],
    });
    // WEB-1 is a bug, WEB-2 a feature.
    expect((await detailOf('WEB-1')).fields.map((item) => item.name)).toEqual([
      'Steps to reproduce',
    ]);
    expect((await detailOf('WEB-2')).fields).toEqual([]);
    const refused = await setValue('WEB-2', field.id, 'Click');
    expect(refused.statusCode).toBe(422);
    expect(issuesOf(refused)).toEqual(['Steps to reproduce is not used for Feature tickets.']);
    expect((await setValue('WEB-1', field.id, 'Click')).statusCode).toBe(200);

    // A ticket that changes type keeps the value, hidden, until its type is chosen again.
    await call('PATCH', '/tickets/WEB-1', {
      payload: { version: await version('WEB-1'), typeId: f.typeId('acme', 'feature') },
    });
    expect((await detailOf('WEB-1')).fields).toEqual([]);
    expect(await ctx.db.select().from(ticketFieldValues)).toHaveLength(1);
  });

  it('hides an inactive field everywhere and refuses values for it', async () => {
    const field = await createField({ name: 'Customer', kind: 'text' });
    await setValue('WEB-1', field.id, 'Acme');
    await call('PATCH', `/custom-fields/${field.id}`, { payload: { active: false } });
    const detail = await detailOf('WEB-1');
    expect(detail.fields).toEqual([]);
    expect(detail.fieldValues).toEqual([]);
    const refused = await setValue('WEB-1', field.id, 'Globex');
    expect(refused.statusCode).toBe(422);
    expect(issuesOf(refused)).toEqual(['Customer is turned off.']);
    expect(await keysFor(`cf=${field.id}.set`)).toEqual([]);

    // Turned back on, the value is there again.
    await call('PATCH', `/custom-fields/${field.id}`, { payload: { active: true } });
    expect((await detailOf('WEB-1')).fields[0]!.text).toBe('Acme');
  });

  it('refuses archived tickets and tickets of archived projects (409)', async () => {
    const field = await createField({ name: 'Customer', kind: 'text' });
    await call('POST', '/tickets/WEB-1/archive');
    const archived = await setValue('WEB-1', field.id, 'Acme');
    expect(archived.statusCode).toBe(409);
    expect(messageOf(archived)).toBe('This ticket is archived. Unarchive it to change it.');

    await ctx.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.key, 'WEB'));
    const frozen = await setValue('WEB-2', field.id, 'Acme');
    expect(frozen.statusCode).toBe(409);
    expect(messageOf(frozen)).toBe('This project is archived. Unarchive it to change its tickets.');
    expect(await ctx.db.select().from(ticketFieldValues)).toEqual([]);
  });
});

describe('filtering and sorting by fields', () => {
  it('filters by option, person, yes/no, and has a value or not', async () => {
    const tier = await createField({
      name: 'Tier',
      kind: 'multi_select',
      options: ['Free', 'Pro'],
    });
    const owner = await createField({ name: 'Owner', kind: 'person' });
    const hotfix = await createField({ name: 'Hotfix', kind: 'boolean' });
    const [free, pro] = tier.options;
    await setValue('WEB-1', tier.id, [free!.id]);
    await setValue('WEB-2', tier.id, [free!.id, pro!.id]);
    await setValue('WEB-3', tier.id, [pro!.id]);
    await setValue('WEB-1', owner.id, f.userId('owner'));
    await setValue('WEB-2', owner.id, f.userId('developer'));
    await setValue('WEB-1', hotfix.id, true);
    await setValue('WEB-2', hotfix.id, false);

    const sorted = async (query: string) => (await keysFor(`${query}&sort=key&dir=asc`)).sort();
    expect(await sorted(`cf=${tier.id}.${free!.id}`)).toEqual(['WEB-1', 'WEB-2']);
    // Two options of one field: either will do.
    expect(await sorted(`cf=${tier.id}.${free!.id}&cf=${tier.id}.${pro!.id}`)).toEqual([
      'WEB-1',
      'WEB-2',
      'WEB-3',
    ]);
    // Two fields: both must match.
    expect(await sorted(`cf=${tier.id}.${pro!.id}&cf=${owner.id}.set`)).toEqual(['WEB-2']);
    expect(await sorted(`cf=${owner.id}.me`)).toEqual(['WEB-1']);
    expect(await sorted(`cf=${owner.id}.${f.userId('developer')}`)).toEqual(['WEB-2']);
    expect(await sorted(`cf=${hotfix.id}.yes`)).toEqual(['WEB-1']);
    expect(await sorted(`cf=${hotfix.id}.no`)).toEqual(['WEB-2']);
    expect(await sorted(`cf=${hotfix.id}.set`)).toEqual(['WEB-1', 'WEB-2']);
    const empty = await sorted(`cf=${tier.id}.empty`);
    expect(empty).not.toContain('WEB-1');
    expect(empty).toContain('WEB-4');
    expect(empty.length).toBe((await keysFor('')).length - 3);
  });

  it('sorts by a number, a date or a text field, empty values last either way', async () => {
    const points = await createField({ name: 'Points', kind: 'number' });
    const release = await createField({ name: 'Release', kind: 'date' });
    const customer = await createField({ name: 'Customer', kind: 'text' });
    await setValue('WEB-1', points.id, 8);
    await setValue('WEB-2', points.id, -1);
    await setValue('WEB-3', points.id, 3);
    await setValue('WEB-1', release.id, '2027-01-01');
    await setValue('WEB-2', release.id, '2026-11-01');
    await setValue('WEB-1', customer.id, 'globex');
    await setValue('WEB-3', customer.id, 'Acme');

    const firstThree = async (query: string) => (await keysFor(query)).slice(0, 3);
    expect(await firstThree(`sortField=${points.id}&dir=asc`)).toEqual(['WEB-2', 'WEB-3', 'WEB-1']);
    expect(await firstThree(`sortField=${points.id}&dir=desc`)).toEqual([
      'WEB-1',
      'WEB-3',
      'WEB-2',
    ]);
    expect((await firstThree(`sortField=${release.id}&dir=asc`)).slice(0, 2)).toEqual([
      'WEB-2',
      'WEB-1',
    ]);
    // Text ignores case.
    expect((await firstThree(`sortField=${customer.id}&dir=asc`)).slice(0, 2)).toEqual([
      'WEB-3',
      'WEB-1',
    ]);
    // The rest, without a value, still come after, ordered by the usual sort.
    const all = await keysFor(`sortField=${points.id}&dir=desc&sort=key`);
    expect(all.slice(0, 3)).toEqual(['WEB-1', 'WEB-3', 'WEB-2']);
    expect(all.length).toBe((await keysFor('')).length);
  });

  it('works on the board too', async () => {
    const points = await createField({ name: 'Points', kind: 'number' });
    await setValue('WEB-1', points.id, 1);
    const response = await call('GET', `/projects/WEB/board?cf=${points.id}.set`);
    expect(response.statusCode).toBe(200);
    const keys = (response.json() as { columns: { tickets: { key: string }[] }[] }).columns.flatMap(
      (column) => column.tickets.map((ticket) => ticket.key),
    );
    expect(keys).toEqual(['WEB-1']);
  });

  it.each([
    ['not a field test', 'cf=status.open'],
    ['an unknown word', `cf=${SOME_ID}.maybe`],
    ['a sort field that is not an id', 'sortField=title'],
  ])('refuses %s (422)', async (_name, query) => {
    expect((await call('GET', `/tickets?${query}`)).statusCode).toBe(422);
  });

  it("finds nothing with another workspace's field", async () => {
    const field = await createField({ name: 'Customer', kind: 'text' });
    await setValue('WEB-1', field.id, 'Acme');
    const theirs = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${f.northwindId}/tickets?cf=${field.id}.set`,
      headers: { cookie: await ctx.cookieFor('other-owner') },
    });
    expect(ticketListSchema.parse(theirs.json()).items).toEqual([]);
  });
});
