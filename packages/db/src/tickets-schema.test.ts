import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  components,
  createDb,
  createOrganisationWithSystemRoles,
  createPool,
  createProject,
  labels,
  loadDotEnv,
  organisationMemberships,
  priorities,
  projectStatuses,
  projects,
  resetDatabaseForTests,
  runMigrations,
  statusTransitions,
  ticketComments,
  ticketEvents,
  ticketLabels,
  ticketTypes,
  tickets,
  users,
  type Db,
} from './index';

let pool: Pool;
let db: Db;

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const source = (error as { cause?: { code?: string } }).cause ?? error;
    return (source as { code?: string }).code;
  }
}

const UNIQUE = '23505';
const FOREIGN_KEY = '23503';
const CHECK = '23514';
const RESTRICT = '23001';

beforeAll(async () => {
  loadDotEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env.');
  pool = createPool(url);
  db = createDb(pool);
  await resetDatabaseForTests(pool);
  await runMigrations(pool);
});

beforeEach(async () => {
  await pool.query(`TRUNCATE users, organisations CASCADE`);
});

afterAll(async () => {
  await pool.end();
});

/** Two workspaces, three people, three projects, and everything a ticket can point at. */
async function world() {
  const acme = await createOrganisationWithSystemRoles(db, { slug: 'acme', name: 'Acme' });
  const north = await createOrganisationWithSystemRoles(db, { slug: 'northwind', name: 'North' });

  const newUser = async (email: string) =>
    (await db.insert(users).values({ email, displayName: email }).returning())[0]!;
  const alice = await newUser('alice@acme.test'); // member of acme
  const bob = await newUser('bob@north.test'); // member of northwind only
  const carol = await newUser('carol@nowhere.test'); // member of nothing

  await db.insert(organisationMemberships).values([
    { organisationId: acme.organisationId, userId: alice.id, roleId: acme.roleIds.developer },
    { organisationId: north.organisationId, userId: bob.id, roleId: north.roleIds.developer },
  ]);

  const web = await createProject(db, {
    organisationId: acme.organisationId,
    key: 'WEB',
    name: 'Web',
    createdBy: alice.id,
  });
  const api = await createProject(db, {
    organisationId: acme.organisationId,
    key: 'API',
    name: 'API',
    createdBy: alice.id,
  });
  const ops = await createProject(db, {
    organisationId: north.organisationId,
    key: 'OPS',
    name: 'Ops',
    createdBy: bob.id,
  });

  const typeOf = async (orgId: string) =>
    (await db.select().from(ticketTypes).where(eq(ticketTypes.organisationId, orgId)))[0]!;
  const priorityOf = async (orgId: string) =>
    (await db.select().from(priorities).where(eq(priorities.organisationId, orgId)))[0]!;

  const [webComponent] = await db
    .insert(components)
    .values({ organisationId: acme.organisationId, projectId: web.projectId, name: 'Frontend' })
    .returning();
  const [apiComponent] = await db
    .insert(components)
    .values({ organisationId: acme.organisationId, projectId: api.projectId, name: 'Gateway' })
    .returning();
  const [acmeLabel] = await db
    .insert(labels)
    .values({ organisationId: acme.organisationId, name: 'bug', color: 'red' })
    .returning();
  const [northLabel] = await db
    .insert(labels)
    .values({ organisationId: north.organisationId, name: 'bug', color: 'red' })
    .returning();

  return {
    acme,
    north,
    alice,
    bob,
    carol,
    web,
    api,
    ops,
    acmeType: await typeOf(acme.organisationId),
    northType: await typeOf(north.organisationId),
    acmePriority: await priorityOf(acme.organisationId),
    northPriority: await priorityOf(north.organisationId),
    webComponent: webComponent!,
    apiComponent: apiComponent!,
    acmeLabel: acmeLabel!,
    northLabel: northLabel!,
  };
}
type World = Awaited<ReturnType<typeof world>>;

/** A valid ticket in WEB; tests override one thing to break it. */
const ticketRow = (w: World, overrides: Partial<typeof tickets.$inferInsert> = {}) => ({
  organisationId: w.acme.organisationId,
  projectId: w.web.projectId,
  number: 1,
  key: 'WEB-1',
  title: 'Fix login',
  typeId: w.acmeType.id,
  statusId: w.web.statusIds.backlog!,
  priorityId: w.acmePriority.id,
  reporterId: w.alice.id,
  ...overrides,
});

describe('a valid ticket', () => {
  it('is accepted, gets a v7 id, and defaults to version 1', async () => {
    const w = await world();
    const [ticket] = await db
      .insert(tickets)
      .values(ticketRow(w, { assigneeId: w.alice.id, componentId: w.webComponent.id }))
      .returning();
    expect(ticket?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(ticket?.version).toBe(1);
    expect(ticket?.completedAt).toBeNull();
  });
});

describe('tickets cannot point across workspaces or projects', () => {
  it('rejects a status of another project', async () => {
    const w = await world();
    expect(
      await pgCode(db.insert(tickets).values(ticketRow(w, { statusId: w.api.statusIds.backlog! }))),
    ).toBe(FOREIGN_KEY);
  });

  it('rejects a status of another workspace', async () => {
    const w = await world();
    expect(
      await pgCode(db.insert(tickets).values(ticketRow(w, { statusId: w.ops.statusIds.backlog! }))),
    ).toBe(FOREIGN_KEY);
  });

  it('rejects a type and a priority of another workspace', async () => {
    const w = await world();
    expect(await pgCode(db.insert(tickets).values(ticketRow(w, { typeId: w.northType.id })))).toBe(
      FOREIGN_KEY,
    );
    expect(
      await pgCode(db.insert(tickets).values(ticketRow(w, { priorityId: w.northPriority.id }))),
    ).toBe(FOREIGN_KEY);
  });

  it('rejects an assignee who is a member of a different workspace, or of none', async () => {
    const w = await world();
    expect(await pgCode(db.insert(tickets).values(ticketRow(w, { assigneeId: w.bob.id })))).toBe(
      FOREIGN_KEY,
    );
    expect(await pgCode(db.insert(tickets).values(ticketRow(w, { assigneeId: w.carol.id })))).toBe(
      FOREIGN_KEY,
    );
  });

  it('rejects a reporter who is not a member', async () => {
    const w = await world();
    expect(await pgCode(db.insert(tickets).values(ticketRow(w, { reporterId: w.carol.id })))).toBe(
      FOREIGN_KEY,
    );
  });

  it('rejects a component of another project', async () => {
    const w = await world();
    expect(
      await pgCode(db.insert(tickets).values(ticketRow(w, { componentId: w.apiComponent.id }))),
    ).toBe(FOREIGN_KEY);
  });

  it('rejects a project of another workspace', async () => {
    const w = await world();
    expect(
      await pgCode(db.insert(tickets).values(ticketRow(w, { projectId: w.ops.projectId }))),
    ).toBe(FOREIGN_KEY);
  });

  it('rejects a label of another workspace', async () => {
    const w = await world();
    const [ticket] = await db.insert(tickets).values(ticketRow(w)).returning();
    expect(
      await pgCode(
        db.insert(ticketLabels).values({
          organisationId: w.acme.organisationId,
          ticketId: ticket!.id,
          labelId: w.northLabel.id,
        }),
      ),
    ).toBe(FOREIGN_KEY);
    await db.insert(ticketLabels).values({
      organisationId: w.acme.organisationId,
      ticketId: ticket!.id,
      labelId: w.acmeLabel.id,
    });
  });

  it('rejects comments and events filed under the wrong workspace', async () => {
    const w = await world();
    const [ticket] = await db.insert(tickets).values(ticketRow(w)).returning();
    expect(
      await pgCode(
        db.insert(ticketComments).values({
          organisationId: w.north.organisationId,
          ticketId: ticket!.id,
          authorId: w.alice.id,
          body: 'hi',
        }),
      ),
    ).toBe(FOREIGN_KEY);
    expect(
      await pgCode(
        db.insert(ticketEvents).values({
          organisationId: w.north.organisationId,
          ticketId: ticket!.id,
          source: 'user',
          type: 'ticket.created',
          data: {},
        }),
      ),
    ).toBe(FOREIGN_KEY);
  });
});

describe('ticket identity and limits', () => {
  it('rejects a repeated number in a project and a repeated key in a workspace', async () => {
    const w = await world();
    await db.insert(tickets).values(ticketRow(w));
    expect(await pgCode(db.insert(tickets).values(ticketRow(w, { key: 'WEB-9' })))).toBe(UNIQUE);
    expect(await pgCode(db.insert(tickets).values(ticketRow(w, { number: 9 })))).toBe(UNIQUE);
  });

  it.each([
    ['an empty title', ''],
    ['a 201-character title', 'x'.repeat(201)],
  ])('rejects %s', async (_label, title) => {
    const w = await world();
    expect(await pgCode(db.insert(tickets).values(ticketRow(w, { title })))).toBe(CHECK);
  });

  it('accepts a 200-character title', async () => {
    const w = await world();
    await db.insert(tickets).values(ticketRow(w, { title: 'x'.repeat(200) }));
  });

  it('rejects version 0 and number 0', async () => {
    const w = await world();
    expect(await pgCode(db.insert(tickets).values(ticketRow(w, { version: 0 })))).toBe(CHECK);
    expect(await pgCode(db.insert(tickets).values(ticketRow(w, { number: 0 })))).toBe(CHECK);
  });
});

describe('projects', () => {
  it.each(['a1', 'A', 'ABCDEFGHIJK', '1AB', 'AB-C'])('rejects the key %j', async (key) => {
    const w = await world();
    expect(
      await pgCode(
        db.insert(projects).values({
          organisationId: w.acme.organisationId,
          key,
          name: 'X',
          createdBy: w.alice.id,
        }),
      ),
    ).toBe(CHECK);
  });

  it('allows the same key in different workspaces but not twice in one', async () => {
    const w = await world();
    await createProject(db, {
      organisationId: w.north.organisationId,
      key: 'WEB',
      name: 'Other web',
      createdBy: w.bob.id,
    });
    expect(
      await pgCode(
        createProject(db, {
          organisationId: w.acme.organisationId,
          key: 'WEB',
          name: 'Dup',
          createdBy: w.alice.id,
        }),
      ),
    ).toBe(UNIQUE);
  });

  it('starts counting tickets at 1', async () => {
    const w = await world();
    const [project] = await db.select().from(projects).where(eq(projects.id, w.web.projectId));
    expect(project?.nextTicketNumber).toBe(1);
  });
});

describe('workflow', () => {
  it('rejects a second initial status in a project', async () => {
    const w = await world();
    expect(
      await pgCode(
        db.insert(projectStatuses).values({
          organisationId: w.acme.organisationId,
          projectId: w.web.projectId,
          key: 'triage',
          name: 'Triage',
          category: 'not_started',
          sortOrder: 99,
          isInitial: true,
        }),
      ),
    ).toBe(UNIQUE);
  });

  it('rejects an unknown category', async () => {
    const w = await world();
    expect(
      await pgCode(
        db.insert(projectStatuses).values({
          organisationId: w.acme.organisationId,
          projectId: w.web.projectId,
          key: 'weird',
          name: 'Weird',
          category: 'sideways',
          sortOrder: 99,
        }),
      ),
    ).toBe(CHECK);
  });

  it('rejects a transition into another project’s status, and into itself', async () => {
    const w = await world();
    const base = { organisationId: w.acme.organisationId, projectId: w.web.projectId };
    expect(
      await pgCode(
        db.insert(statusTransitions).values({
          ...base,
          fromStatusId: w.web.statusIds.open!,
          toStatusId: w.api.statusIds.open!,
        }),
      ),
    ).toBe(FOREIGN_KEY);
    expect(
      await pgCode(
        db.insert(statusTransitions).values({
          ...base,
          fromStatusId: w.web.statusIds.open!,
          toStatusId: w.web.statusIds.open!,
        }),
      ),
    ).toBe(CHECK);
  });
});

describe('labels', () => {
  it('rejects names that differ only by case, and unknown colours', async () => {
    const w = await world();
    expect(
      await pgCode(
        db
          .insert(labels)
          .values({ organisationId: w.acme.organisationId, name: 'BUG', color: 'red' }),
      ),
    ).toBe(UNIQUE);
    expect(
      await pgCode(
        db
          .insert(labels)
          .values({ organisationId: w.acme.organisationId, name: 'new', color: 'hotpink' }),
      ),
    ).toBe(CHECK);
  });
});

describe('nothing in use can be deleted', () => {
  it('refuses to delete a project, a status or a member that tickets depend on', async () => {
    const w = await world();
    await db.insert(tickets).values(ticketRow(w, { assigneeId: w.alice.id }));
    expect(await pgCode(db.delete(projects).where(eq(projects.id, w.web.projectId)))).toBe(
      RESTRICT,
    );
    expect(
      await pgCode(
        db.delete(projectStatuses).where(eq(projectStatuses.id, w.web.statusIds.backlog!)),
      ),
    ).toBe(RESTRICT);
    expect(
      await pgCode(
        db.delete(organisationMemberships).where(eq(organisationMemberships.userId, w.alice.id)),
      ),
    ).toBe(RESTRICT);
  });
});
