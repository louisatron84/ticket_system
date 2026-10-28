import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createOrganisationWithSystemRoles,
  createPool,
  createProject,
  ensureOrganisationDefaults,
  loadDotEnv,
  organisationMemberships,
  priorities,
  projectStatuses,
  projects,
  resetDatabaseForTests,
  runMigrations,
  ticketLinks,
  tickets,
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

/** A workspace with one project, one member and two tickets, made straight in the tables. */
async function workspace(slug: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `${slug}@acme.test`, displayName: slug })
    .returning();
  const { organisationId, roleIds } = await createOrganisationWithSystemRoles(db, {
    slug,
    name: slug,
  });
  await db
    .insert(organisationMemberships)
    .values({ organisationId, userId: user!.id, roleId: Object.values(roleIds)[0]! });
  await ensureOrganisationDefaults(db, organisationId);
  const { projectId } = await createProject(db, {
    organisationId,
    key: 'WEB',
    name: 'Web',
    createdBy: user!.id,
  });
  const [status] = await db
    .select()
    .from(projectStatuses)
    .where(eq(projectStatuses.projectId, projectId));
  const [type] = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.organisationId, organisationId));
  const [priority] = await db
    .select()
    .from(priorities)
    .where(eq(priorities.organisationId, organisationId));
  const made = await db
    .insert(tickets)
    .values(
      [1, 2].map((number) => ({
        organisationId,
        projectId,
        number,
        key: `WEB-${number}`,
        title: `Ticket ${number}`,
        typeId: type!.id,
        statusId: status!.id,
        priorityId: priority!.id,
        reporterId: user!.id,
      })),
    )
    .returning();
  return { organisationId, projectId, userId: user!.id, ticketIds: made.map((t) => t.id) };
}

describe('ticket structure tables', () => {
  it('marks only the cancelled status as a cancellation', async () => {
    const { projectId } = await workspace('acme');
    const rows = await db
      .select()
      .from(projectStatuses)
      .where(eq(projectStatuses.projectId, projectId));
    expect(Object.fromEntries(rows.map((row) => [row.key, row.isCancellation]))).toEqual({
      backlog: false,
      open: false,
      in_progress: false,
      in_review: false,
      blocked: false,
      done: false,
      cancelled: true,
    });
  });

  it('turns the blocker rule on for a new project and marks new tickets as made by a person', async () => {
    const { projectId, ticketIds } = await workspace('acme');
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project!.blockersStopCompletion).toBe(true);
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketIds[0]!));
    expect(ticket!.origin).toBe('person');
    expect(ticket!.parentId).toBeNull();
    expect(ticket!.statusBeforeJamId).toBeNull();
  });

  it('refuses a self link', async () => {
    const { organisationId, userId, ticketIds } = await workspace('acme');
    await expect(
      db.insert(ticketLinks).values({
        organisationId,
        sourceTicketId: ticketIds[0]!,
        targetTicketId: ticketIds[0]!,
        kind: 'blocks',
        createdBy: userId,
      }),
    ).rejects.toThrow();
  });

  it('refuses the same link twice', async () => {
    const { organisationId, userId, ticketIds } = await workspace('acme');
    const link = {
      organisationId,
      sourceTicketId: ticketIds[0]!,
      targetTicketId: ticketIds[1]!,
      kind: 'blocks',
      createdBy: userId,
    };
    await db.insert(ticketLinks).values(link);
    await expect(db.insert(ticketLinks).values(link)).rejects.toThrow();
  });

  it('refuses a kind of link it does not know', async () => {
    const { organisationId, userId, ticketIds } = await workspace('acme');
    await expect(
      db.insert(ticketLinks).values({
        organisationId,
        sourceTicketId: ticketIds[0]!,
        targetTicketId: ticketIds[1]!,
        kind: 'clones',
        createdBy: userId,
      }),
    ).rejects.toThrow();
  });

  it('refuses a parent in another workspace', async () => {
    const first = await workspace('acme');
    const second = await workspace('northwind');
    await expect(
      db
        .update(tickets)
        .set({ parentId: second.ticketIds[0]! })
        .where(eq(tickets.id, first.ticketIds[0]!)),
    ).rejects.toThrow();
  });

  it('refuses a link to a ticket in another workspace', async () => {
    const first = await workspace('acme');
    const second = await workspace('northwind');
    await expect(
      db.insert(ticketLinks).values({
        organisationId: first.organisationId,
        sourceTicketId: first.ticketIds[0]!,
        targetTicketId: second.ticketIds[0]!,
        kind: 'relates_to',
        createdBy: first.userId,
      }),
    ).rejects.toThrow();
  });
});
