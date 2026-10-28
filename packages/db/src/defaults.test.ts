import {
  DEFAULT_PRIORITIES,
  DEFAULT_STATUS_TEMPLATE,
  DEFAULT_TICKET_TYPES,
  SYSTEM_ROLES,
} from '@forge/shared';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createOrganisationWithSystemRoles,
  createPool,
  createProject,
  ensureOrganisationDefaults,
  loadDotEnv,
  organisations,
  priorities,
  projectStatuses,
  resetDatabaseForTests,
  roles,
  runMigrations,
  statusTransitions,
  syncOrganisationDefaults,
  syncSystemRoles,
  ticketTypes,
  users,
  type Db,
} from './index';

let pool: Pool;
let db: Db;

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

const newOrg = (slug = 'acme') => createOrganisationWithSystemRoles(db, { slug, name: slug });

describe('workspace defaults', () => {
  it('a new workspace gets the seven ticket types and five priorities', async () => {
    const { organisationId } = await newOrg();
    const types = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.organisationId, organisationId))
      .orderBy(ticketTypes.sortOrder);
    expect(types.map((t) => t.key)).toEqual(DEFAULT_TICKET_TYPES.map((t) => t.key));
    const ranked = await db
      .select()
      .from(priorities)
      .where(eq(priorities.organisationId, organisationId))
      .orderBy(priorities.rank);
    expect(ranked.map((p) => [p.key, p.rank])).toEqual(
      DEFAULT_PRIORITIES.map((p) => [p.key, p.rank]),
    );
  });

  it('ensureOrganisationDefaults is repeatable and never overwrites what was changed', async () => {
    const { organisationId } = await newOrg();
    await db
      .update(ticketTypes)
      .set({ name: 'Chore', isActive: false })
      .where(and(eq(ticketTypes.organisationId, organisationId), eq(ticketTypes.key, 'task')));
    await db
      .delete(priorities)
      .where(and(eq(priorities.organisationId, organisationId), eq(priorities.key, 'lowest')));

    await ensureOrganisationDefaults(db, organisationId);
    await ensureOrganisationDefaults(db, organisationId);

    const [task] = await db
      .select()
      .from(ticketTypes)
      .where(and(eq(ticketTypes.organisationId, organisationId), eq(ticketTypes.key, 'task')));
    expect(task).toMatchObject({ name: 'Chore', isActive: false });
    const keys = (
      await db.select().from(priorities).where(eq(priorities.organisationId, organisationId))
    ).map((p) => p.key);
    expect(keys.sort()).toEqual(DEFAULT_PRIORITIES.map((p) => p.key).sort());
  });

  it('syncOrganisationDefaults repairs every workspace', async () => {
    const a = await newOrg('acme');
    const b = await newOrg('northwind');
    await pool.query('DELETE FROM priorities');
    await pool.query('DELETE FROM ticket_types');
    await syncOrganisationDefaults(db);
    for (const { organisationId } of [a, b]) {
      expect(
        (await db.select().from(priorities).where(eq(priorities.organisationId, organisationId)))
          .length,
      ).toBe(5);
      expect(
        (await db.select().from(ticketTypes).where(eq(ticketTypes.organisationId, organisationId)))
          .length,
      ).toBe(7);
    }
  });
});

describe('createProject', () => {
  async function project() {
    const { organisationId } = await newOrg();
    const [user] = await db
      .insert(users)
      .values({ email: 'a@acme.test', displayName: 'A' })
      .returning();
    const created = await createProject(db, {
      organisationId,
      key: 'WEB',
      name: 'Web',
      description: 'The website',
      createdBy: user!.id,
    });
    return { organisationId, ...created };
  }

  it('copies the default statuses, with exactly one initial', async () => {
    const { projectId } = await project();
    const statuses = await db
      .select()
      .from(projectStatuses)
      .where(eq(projectStatuses.projectId, projectId))
      .orderBy(projectStatuses.sortOrder);
    expect(statuses.map((s) => [s.key, s.category])).toEqual(
      DEFAULT_STATUS_TEMPLATE.statuses.map((s) => [s.key, s.category]),
    );
    expect(statuses.filter((s) => s.isInitial).map((s) => s.key)).toEqual(['backlog']);
    expect(statuses.every((s) => s.isActive)).toBe(true);
  });

  it('copies the default transitions with the right ids', async () => {
    const { projectId, statusIds } = await project();
    const rows = await db
      .select()
      .from(statusTransitions)
      .where(eq(statusTransitions.projectId, projectId));
    expect(rows).toHaveLength(DEFAULT_STATUS_TEMPLATE.transitions.length);
    const pairs = new Set(rows.map((r) => `${r.fromStatusId}>${r.toStatusId}`));
    for (const [from, to] of DEFAULT_STATUS_TEMPLATE.transitions) {
      expect(pairs.has(`${statusIds[from]}>${statusIds[to]}`)).toBe(true);
    }
  });

  it('returns a status id for every template status', async () => {
    const { statusIds } = await project();
    expect(Object.keys(statusIds).sort()).toEqual(
      DEFAULT_STATUS_TEMPLATE.statuses.map((s) => s.key).sort(),
    );
  });
});

describe('syncSystemRoles', () => {
  it('restores a system role whose stored permissions are out of date', async () => {
    const { organisationId } = await newOrg();
    // Roles created before Stage 2 did not have tickets.comment.
    const stale = SYSTEM_ROLES.developer.permissions.filter((p) => p !== 'tickets.comment');
    await db
      .update(roles)
      .set({ permissions: [...stale] })
      .where(and(eq(roles.organisationId, organisationId), eq(roles.key, 'developer')));

    expect(await syncSystemRoles(db)).toBe(1);

    const [developer] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.organisationId, organisationId), eq(roles.key, 'developer')));
    expect(developer?.permissions).toContain('tickets.comment');
    expect([...(developer?.permissions ?? [])].sort()).toEqual(
      [...SYSTEM_ROLES.developer.permissions].sort(),
    );
  });

  it('changes nothing, and says so, when roles are already right', async () => {
    await newOrg('acme');
    await newOrg('northwind');
    expect(await syncSystemRoles(db)).toBe(0);
  });

  it('leaves custom roles alone', async () => {
    const { organisationId } = await newOrg();
    await db.insert(roles).values({
      organisationId,
      key: 'restricted',
      name: 'Restricted',
      permissions: ['tickets.view'],
      isSystem: false,
    });
    await syncSystemRoles(db);
    const [custom] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.organisationId, organisationId), eq(roles.key, 'restricted')));
    expect(custom?.permissions).toEqual(['tickets.view']);
  });

  it('only touches workspaces that exist', async () => {
    const rows = await db.select().from(organisations);
    expect(rows).toHaveLength(0);
    expect(await syncSystemRoles(db)).toBe(0);
  });
});
