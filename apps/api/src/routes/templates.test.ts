import { auditEvents, components, labels, projects, ticketTemplates, ticketTypes } from '@forge/db';
import { MAX_TEMPLATES, ticketTemplateSchema, type TicketTemplate } from '@forge/shared';
import { eq, like } from 'drizzle-orm';
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

const unknownId = '01a1656b-1a49-7146-94ac-1c72df43ddb4';
const url = (projectKey: string, rest = '', orgId = f.acmeId) =>
  `/api/v1/orgs/${orgId}/projects/${projectKey}/templates${rest}`;

const send = async (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  as: string | null = 'owner',
  payload?: unknown,
) =>
  ctx.app.inject({
    method,
    url: path,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    headers: as ? { cookie: await ctx.cookieFor(as) } : {},
  });

const create = (
  projectKey: string,
  payload: unknown,
  as: string | null = 'owner',
  orgId?: string,
) => send('POST', url(projectKey, '', orgId), as, payload);

const list = async (projectKey = 'WEB', as = 'owner'): Promise<TicketTemplate[]> => {
  const response = await send('GET', url(projectKey), as);
  expect(response.statusCode).toBe(200);
  return ticketTemplateSchema.array().parse(response.json());
};

const made = async (projectKey: string, payload: object): Promise<TicketTemplate> => {
  const response = await create(projectKey, payload);
  expect(response.statusCode).toBe(201);
  return ticketTemplateSchema.parse(response.json());
};

const templateCount = async () => (await ctx.db.select().from(ticketTemplates)).length;
const templateAudits = async () =>
  ctx.db.select().from(auditEvents).where(like(auditEvents.action, 'template.%'));
const archive = (projectKey: string) =>
  ctx.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.key, projectKey));

describe('who may list a project’s templates', () => {
  const matrix: [string, number][] = [
    ['owner', 200],
    ['admin', 200],
    ['developer', 200],
    ['reporter', 200],
    ['reviewer', 403],
    ['readonly', 403],
    ['restricted', 403],
    ['other-owner', 404],
  ];

  it.each(matrix)('%s gets %i', async (identity, expected) => {
    await made('WEB', { name: 'Bug report' });
    const response = await send('GET', url('WEB'), identity);
    expect(response.statusCode).toBe(expected);
    if (expected === 200) expect(response.json()).toHaveLength(1);
  });

  it('answers 401 to someone who is not signed in', async () => {
    expect((await send('GET', url('WEB'), null)).statusCode).toBe(401);
  });
});

describe('who may change templates', () => {
  const matrix: [string, number][] = [
    ['owner', 201],
    ['admin', 201],
    ['developer', 403],
    ['reporter', 403],
    ['reviewer', 403],
    ['readonly', 403],
    ['restricted', 403],
    ['other-owner', 404],
  ];

  it.each(matrix)('%s adding one gets %i', async (identity, expected) => {
    const before = await templateCount();
    const response = await create('WEB', { name: 'Bug report' }, identity);
    expect(response.statusCode).toBe(expected);
    expect(await templateCount()).toBe(before + (expected === 201 ? 1 : 0));
  });

  it('answers 401 to someone who is not signed in', async () => {
    expect((await create('WEB', { name: 'Bug report' }, null)).statusCode).toBe(401);
    expect(await templateCount()).toBe(0);
  });

  it('lets a reporter use templates but not change, reorder or delete them', async () => {
    const template = await made('WEB', { name: 'Bug report' });
    expect(await list('WEB', 'reporter')).toHaveLength(1);
    const patched = await send('PATCH', url('WEB', `/${template.id}`), 'reporter', {
      name: 'Mine now',
    });
    expect(patched.statusCode).toBe(403);
    const reordered = await send('PUT', url('WEB', '/order'), 'reporter', { ids: [template.id] });
    expect(reordered.statusCode).toBe(403);
    expect((await send('DELETE', url('WEB', `/${template.id}`), 'reporter')).statusCode).toBe(403);
    expect((await list())[0]!.name).toBe('Bug report');
  });
});

describe('adding a template', () => {
  it('stores every field, returns it, lists it in the project only, and records an audit event', async () => {
    const payload = {
      name: '  Bug report  ',
      titlePrefix: '  [Bug]  ',
      typeId: f.typeId('acme', 'bug'),
      priorityId: f.priorityId('acme', 'high'),
      componentId: f.componentId('WEB', 'Checkout'),
      labelIds: [f.labelId('acme', 'bug'), f.labelId('acme', 'frontend')],
      goal: 'Find out what broke.',
      criteria: ['It is reproduced', 'It is fixed'],
      description: '**Steps**\n1. Open\n2. Click',
    };
    const response = await create('WEB', payload, 'admin');
    expect(response.statusCode).toBe(201);
    const created = ticketTemplateSchema.parse(response.json());
    expect(created).toEqual({
      ...payload,
      id: created.id,
      name: 'Bug report',
      titlePrefix: '[Bug]',
    });

    const [row] = await ctx.db
      .select()
      .from(ticketTemplates)
      .where(eq(ticketTemplates.id, created.id));
    expect(row).toMatchObject({ organisationId: f.acmeId, projectId: f.projectId('WEB') });

    expect(await list('WEB')).toEqual([created]);
    expect(await list('API')).toEqual([]);

    const [event] = await templateAudits();
    expect(event).toMatchObject({
      organisationId: f.acmeId,
      actorUserId: f.userId('admin'),
      action: 'template.created',
      outcome: 'success',
      source: 'user',
      targetType: 'template',
      targetId: created.id,
      after: { project: 'WEB', name: 'Bug report', titlePrefix: '[Bug]' },
    });
  });

  it('needs only a name; the rest stays empty', async () => {
    const created = await made('WEB', { name: 'Blank' });
    expect(created).toMatchObject({
      titlePrefix: '',
      typeId: null,
      priorityId: null,
      componentId: null,
      labelIds: [],
      goal: '',
      criteria: [],
      description: '',
    });
  });

  it('lists templates in the order they were added, and finds the project in any case', async () => {
    await made('WEB', { name: 'First' });
    await made('web', { name: 'Second' });
    await made('WEB', { name: 'Third' });
    expect((await list('web')).map((t) => t.name)).toEqual(['First', 'Second', 'Third']);
  });

  describe('a name already used in the project, whatever its case or spacing, gets 409', () => {
    it.each(['Bug report', 'BUG REPORT', '  bug report  '])('%j', async (name) => {
      await made('WEB', { name: 'Bug report' });
      const response = await create('WEB', { name });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.message).toBe(
        'The project WEB already has a template named "' + name.trim() + '".',
      );
      expect(await templateCount()).toBe(1);
    });
  });

  it('allows the same name in another project, and in another workspace', async () => {
    await made('WEB', { name: 'Bug report' });
    expect((await create('API', { name: 'Bug report' })).statusCode).toBe(201);
    expect(
      (await create('OPS', { name: 'Bug report' }, 'other-owner', f.northwindId)).statusCode,
    ).toBe(201);
  });

  it(`stops at ${MAX_TEMPLATES} per project`, async () => {
    for (let i = 1; i <= MAX_TEMPLATES; i += 1) await made('WEB', { name: `Template ${i}` });
    const response = await create('WEB', { name: 'One too many' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe(
      'A project can have at most 20 templates. Delete one to add another.',
    );
    expect(await templateCount()).toBe(MAX_TEMPLATES);
    // Other projects have their own allowance.
    expect((await create('API', { name: 'Fine' })).statusCode).toBe(201);
  });

  it('lets only one of two simultaneous additions take the last place', async () => {
    for (let i = 1; i < MAX_TEMPLATES; i += 1) await made('WEB', { name: `Template ${i}` });
    const responses = await Promise.all([
      create('WEB', { name: 'Last A' }),
      create('WEB', { name: 'Last B' }),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await templateCount()).toBe(MAX_TEMPLATES);
  });

  describe('refuses references that are not available here with 422 and writes nothing', () => {
    const cases: [string, () => object, string][] = [
      ['an unknown type', () => ({ typeId: unknownId }), 'typeId'],
      ['a type of another workspace', () => ({ typeId: f.typeId('northwind', 'bug') }), 'typeId'],
      ['an unknown priority', () => ({ priorityId: unknownId }), 'priorityId'],
      [
        'a priority of another workspace',
        () => ({ priorityId: f.priorityId('northwind', 'high') }),
        'priorityId',
      ],
      [
        'a component of another project',
        () => ({ componentId: f.componentId('API', 'Gateway') }),
        'componentId',
      ],
      ['an unknown component', () => ({ componentId: unknownId }), 'componentId'],
      [
        'a label of another workspace',
        () => ({ labelIds: [f.labelId('northwind', 'ops')] }),
        'labelIds',
      ],
      [
        'an unknown label among good ones',
        () => ({ labelIds: [f.labelId('acme', 'bug'), unknownId] }),
        'labelIds',
      ],
    ];

    it.each(cases)('%s', async (_label, extra, path) => {
      const response = await create('WEB', { name: 'Bad', ...extra() });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.details).toEqual([expect.objectContaining({ path })]);
      expect(await templateCount()).toBe(0);
      expect(await templateAudits()).toHaveLength(0);
    });

    it('an inactive type', async () => {
      await ctx.db
        .update(ticketTypes)
        .set({ isActive: false })
        .where(eq(ticketTypes.id, f.typeId('acme', 'bug')));
      const response = await create('WEB', { name: 'Bad', typeId: f.typeId('acme', 'bug') });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.details).toEqual([expect.objectContaining({ path: 'typeId' })]);
    });

    it('an inactive component', async () => {
      const componentId = f.componentId('WEB', 'Checkout');
      await ctx.db
        .update(components)
        .set({ isActive: false })
        .where(eq(components.id, componentId));
      const response = await create('WEB', { name: 'Bad', componentId });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.details).toEqual([
        {
          path: 'componentId',
          message: 'The component Checkout is no longer in use. Choose another component.',
        },
      ]);
    });
  });

  describe('refuses bad input with 422 and writes nothing', () => {
    const cases: [string, unknown][] = [
      ['no name', {}],
      ['a blank name', { name: '  ' }],
      ['a 61-character name', { name: 'a'.repeat(61) }],
      ['a line break in the name', { name: 'a\nb' }],
      ['a 61-character title prefix', { name: 'T', titlePrefix: 'a'.repeat(61) }],
      ['a line break in the title prefix', { name: 'T', titlePrefix: '[a]\nb' }],
      ['a goal over 500 characters', { name: 'T', goal: 'a'.repeat(501) }],
      ['a NUL in the goal', { name: 'T', goal: 'a\u0000' }],
      ['a description over 20,000 characters', { name: 'T', description: 'a'.repeat(20_001) }],
      ['51 criteria', { name: 'T', criteria: Array.from({ length: 51 }, (_, i) => `c${i}`) }],
      ['a 301-character criterion', { name: 'T', criteria: ['a'.repeat(301)] }],
      ['a blank criterion', { name: 'T', criteria: ['  '] }],
      ['a criterion over two lines', { name: 'T', criteria: ['a\nb'] }],
      ['21 labels', { name: 'T', labelIds: Array.from({ length: 21 }, () => unknownId) }],
      ['the same label twice', { name: 'T', labelIds: [unknownId, unknownId] }],
      ['a type that is not an id', { name: 'T', typeId: 'bug' }],
      ['a status (templates do not set one)', { name: 'T', statusId: unknownId }],
      ['an assignee (templates do not set one)', { name: 'T', assigneeId: unknownId }],
      ['a project the client chose', { name: 'T', projectId: unknownId }],
      ['a workspace the client chose', { name: 'T', organisationId: unknownId }],
      ['an order the client chose', { name: 'T', sortOrder: 3 }],
    ];

    it.each(cases)('%s', async (_label, payload) => {
      const response = await create('WEB', payload);
      expect(response.statusCode).toBe(422);
      expect(await templateCount()).toBe(0);
      expect(await templateAudits()).toHaveLength(0);
    });
  });

  it('takes the longest values the create form takes', async () => {
    const created = await made('WEB', {
      name: 'a'.repeat(60),
      titlePrefix: 'p'.repeat(60),
      goal: 'g'.repeat(500),
      criteria: Array.from({ length: 50 }, () => 'c'.repeat(300)),
      description: 'd'.repeat(20_000),
    });
    expect(created.criteria).toHaveLength(50);
  });
});

describe('a template is not remembered on a ticket', () => {
  it('the create-ticket body has no place for one', async () => {
    const template = await made('WEB', { name: 'Bug report' });
    const response = await send('POST', `/api/v1/orgs/${f.acmeId}/projects/WEB/tickets`, 'owner', {
      title: 'From a template',
      typeId: f.typeId('acme', 'bug'),
      priorityId: f.priorityId('acme', 'normal'),
      templateId: template.id,
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('changing a template', () => {
  it('changes only the fields sent, and records before and after', async () => {
    const template = await made('WEB', {
      name: 'Bug report',
      typeId: f.typeId('acme', 'bug'),
      goal: 'Find it.',
    });
    const response = await send('PATCH', url('WEB', `/${template.id}`), 'admin', {
      name: 'Defect',
      typeId: null,
      criteria: ['Reproduced'],
    });
    expect(response.statusCode).toBe(200);
    expect(ticketTemplateSchema.parse(response.json())).toEqual({
      ...template,
      name: 'Defect',
      typeId: null,
      criteria: ['Reproduced'],
    });
    expect(await list()).toEqual([response.json()]);

    const updated = (await templateAudits()).find((e) => e.action === 'template.updated');
    expect(updated).toMatchObject({
      actorUserId: f.userId('admin'),
      targetId: template.id,
      before: { project: 'WEB', name: 'Bug report', typeId: f.typeId('acme', 'bug') },
      after: { project: 'WEB', name: 'Defect', typeId: null, goal: 'Find it.' },
    });
  });

  it('refuses a name another template of the project has', async () => {
    await made('WEB', { name: 'Bug report' });
    const other = await made('WEB', { name: 'Feature' });
    const response = await send('PATCH', url('WEB', `/${other.id}`), 'owner', {
      name: 'bug REPORT',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('conflict');
  });

  it('checks references as when adding', async () => {
    const template = await made('WEB', { name: 'Bug report' });
    const response = await send('PATCH', url('WEB', `/${template.id}`), 'owner', {
      componentId: f.componentId('API', 'Gateway'),
      labelIds: [f.labelId('northwind', 'ops')],
    });
    expect(response.statusCode).toBe(422);
    expect(
      response
        .json()
        .error.details.map((d: { path: string }) => d.path)
        .sort(),
    ).toEqual(['componentId', 'labelIds']);
    expect((await list())[0]).toEqual(template);
  });

  it.each([
    ['nothing to change', {}],
    ['a goal over 500 characters', { goal: 'a'.repeat(501) }],
    ['a blank name', { name: ' ' }],
    ['an unknown field', { colour: 'red' }],
  ])('refuses %s with 422', async (_label, payload) => {
    const template = await made('WEB', { name: 'Bug report' });
    expect((await send('PATCH', url('WEB', `/${template.id}`), 'owner', payload)).statusCode).toBe(
      422,
    );
  });
});

describe('deleting a template', () => {
  it('removes it, records it, and a second delete finds nothing', async () => {
    const template = await made('WEB', { name: 'Bug report' });
    const response = await send('DELETE', url('WEB', `/${template.id}`), 'admin');
    expect(response.statusCode).toBe(204);
    expect(await list()).toEqual([]);
    const deleted = (await templateAudits()).find((e) => e.action === 'template.deleted');
    expect(deleted).toMatchObject({
      actorUserId: f.userId('admin'),
      targetId: template.id,
      before: { project: 'WEB', name: 'Bug report' },
    });
    expect((await send('DELETE', url('WEB', `/${template.id}`), 'admin')).statusCode).toBe(404);
  });
});

describe('reordering templates', () => {
  it('puts them in the order given', async () => {
    const a = await made('WEB', { name: 'A' });
    const b = await made('WEB', { name: 'B' });
    const c = await made('WEB', { name: 'C' });
    const response = await send('PUT', url('WEB', '/order'), 'owner', { ids: [c.id, a.id, b.id] });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((t: TicketTemplate) => t.name)).toEqual(['C', 'A', 'B']);
    expect((await list()).map((t) => t.name)).toEqual(['C', 'A', 'B']);
    // A new one goes last.
    await made('WEB', { name: 'D' });
    expect((await list()).map((t) => t.name)).toEqual(['C', 'A', 'B', 'D']);
  });

  it('refuses a list that is missing one or names another project’s with 409', async () => {
    const a = await made('WEB', { name: 'A' });
    const b = await made('WEB', { name: 'B' });
    const elsewhere = await made('API', { name: 'X' });
    for (const ids of [[a.id], [a.id, elsewhere.id], [a.id, b.id, elsewhere.id]]) {
      const response = await send('PUT', url('WEB', '/order'), 'owner', { ids });
      expect(response.statusCode).toBe(409);
    }
    expect((await list()).map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('refuses the same template twice with 422', async () => {
    const a = await made('WEB', { name: 'A' });
    const response = await send('PUT', url('WEB', '/order'), 'owner', { ids: [a.id, a.id] });
    expect(response.statusCode).toBe(422);
  });
});

describe('an archived project keeps its templates but refuses changes', () => {
  it('lists, and answers 409 to add, change, reorder and delete', async () => {
    const template = await made('WEB', { name: 'Bug report' });
    await archive('WEB');
    expect(await list()).toHaveLength(1);

    const message = 'This project is archived. Unarchive it to change its templates.';
    const responses = [
      await create('WEB', { name: 'Another' }),
      await send('PATCH', url('WEB', `/${template.id}`), 'owner', { name: 'Renamed' }),
      await send('PUT', url('WEB', '/order'), 'owner', { ids: [template.id] }),
      await send('DELETE', url('WEB', `/${template.id}`), 'owner'),
    ];
    for (const response of responses) {
      expect(response.statusCode).toBe(409);
      expect(response.json().error.message).toBe(message);
    }
    expect(await list()).toEqual([template]);
  });
});

describe('templates stay inside their workspace and project', () => {
  it('another workspace’s owner cannot reach them, through either address', async () => {
    const template = await made('WEB', { name: 'Bug report' });
    for (const orgId of [f.acmeId, f.northwindId]) {
      const as = 'other-owner';
      expect((await send('GET', url('WEB', '', orgId), as)).statusCode).toBe(404);
      expect(
        (await send('PATCH', url('WEB', `/${template.id}`, orgId), as, { name: 'x' })).statusCode,
      ).toBe(404);
      expect((await send('DELETE', url('WEB', `/${template.id}`, orgId), as)).statusCode).toBe(404);
    }
    // Acme's owner cannot reach Northwind's project through Acme's address either.
    expect((await send('GET', url('OPS'), 'owner')).statusCode).toBe(404);
    expect((await list())[0]).toEqual(template);
  });

  it('a template of one project cannot be changed or deleted through another', async () => {
    const template = await made('API', { name: 'Endpoint' });
    expect(
      (await send('PATCH', url('WEB', `/${template.id}`), 'owner', { name: 'x' })).statusCode,
    ).toBe(404);
    expect((await send('DELETE', url('WEB', `/${template.id}`), 'owner')).statusCode).toBe(404);
    expect((await list('API'))[0]).toEqual(template);
  });

  describe('an address that is not a template gets a plain 404', () => {
    it.each(['not-an-id', unknownId, '..%2Fx'])('%s', async (id) => {
      expect((await send('PATCH', url('WEB', `/${id}`), 'owner', { name: 'x' })).statusCode).toBe(
        404,
      );
      expect((await send('DELETE', url('WEB', `/${id}`), 'owner')).statusCode).toBe(404);
    });
  });

  describe('a project that is not there gets a plain 404', () => {
    it.each(['NOPE', 'W', 'WEB-1', 'OPS'])('%s', async (key) => {
      expect((await send('GET', url(key), 'owner')).statusCode).toBe(404);
      expect((await create(key, { name: 'x' })).statusCode).toBe(404);
    });
  });
});

describe('a label deleted after the template was made', () => {
  it('drops out of the template, which can still be saved', async () => {
    const [label] = await ctx.db
      .insert(labels)
      .values({ organisationId: f.acmeId, name: 'short-lived', color: 'red' })
      .returning();
    const template = await made('WEB', {
      name: 'Bug report',
      labelIds: [f.labelId('acme', 'bug'), label!.id],
    });
    await ctx.db.delete(labels).where(eq(labels.id, label!.id));
    const [listed] = await list();
    expect(listed!.labelIds).toEqual([f.labelId('acme', 'bug')]);
    const response = await send('PATCH', url('WEB', `/${template.id}`), 'owner', {
      labelIds: listed!.labelIds,
    });
    expect(response.statusCode).toBe(200);
  });
});
