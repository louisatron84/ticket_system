import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  createPool,
  labels,
  loadDotEnv,
  organisationMemberships,
  organisations,
  projectStatuses,
  projects,
  reseedDevelopmentData,
  resetDatabaseForTests,
  runMigrations,
  ticketComments,
  ticketEvents,
  ticketLabels,
  ticketLinks,
  ticketTypes,
  tickets,
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
  await reseedDevelopmentData(db);
});

afterAll(async () => {
  await pool.end();
});

const today = () => new Date().toISOString().slice(0, 10);

async function ticketsOf(projectKey: string) {
  return db
    .select({
      key: tickets.key,
      number: tickets.number,
      dueDate: tickets.dueDate,
      assigneeId: tickets.assigneeId,
      completedAt: tickets.completedAt,
      statusKey: projectStatuses.key,
      category: projectStatuses.category,
    })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
    .where(eq(projects.key, projectKey))
    .orderBy(tickets.number);
}

describe('demo projects and tickets', () => {
  it('creates WEB and API in Acme and OPS in Northwind', async () => {
    const rows = await db
      .select({ key: projects.key, workspace: organisations.slug })
      .from(projects)
      .innerJoin(organisations, eq(organisations.id, projects.organisationId))
      .orderBy(projects.key);
    expect(rows).toEqual([
      { key: 'API', workspace: 'acme' },
      { key: 'OPS', workspace: 'northwind' },
      { key: 'WEB', workspace: 'acme' },
    ]);
  });

  it('numbers WEB tickets 1 to 12 with no gaps and leaves the counter at 13', async () => {
    const web = await ticketsOf('WEB');
    expect(web.map((t) => t.number)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(web.map((t) => t.key)).toEqual(Array.from({ length: 12 }, (_, i) => `WEB-${i + 1}`));
    const [project] = await db.select().from(projects).where(eq(projects.key, 'WEB'));
    expect(project?.nextTicketNumber).toBe(13);
  });

  it('gives API eight tickets and OPS four, each project counting correctly', async () => {
    expect((await ticketsOf('API')).length).toBe(8);
    expect((await ticketsOf('OPS')).length).toBe(4);
    const counters = await db
      .select({ key: projects.key, next: projects.nextTicketNumber })
      .from(projects)
      .orderBy(projects.key);
    expect(counters).toEqual([
      { key: 'API', next: 9 },
      { key: 'OPS', next: 5 },
      { key: 'WEB', next: 13 },
    ]);
  });

  it('puts at least one WEB ticket in every status of its workflow', async () => {
    const web = await ticketsOf('WEB');
    const used = new Set(web.map((t) => t.statusKey));
    for (const status of [
      'backlog',
      'open',
      'in_progress',
      'in_review',
      'blocked',
      'done',
      'cancelled',
    ]) {
      expect(used.has(status), status).toBe(true);
    }
  });

  it('sets completed-at exactly on tickets whose status is completed', async () => {
    for (const key of ['WEB', 'API', 'OPS']) {
      for (const ticket of await ticketsOf(key)) {
        expect(ticket.completedAt !== null, ticket.key).toBe(ticket.category === 'completed');
      }
    }
  });

  it('includes overdue and unassigned tickets to test filters against', async () => {
    const all = [...(await ticketsOf('WEB')), ...(await ticketsOf('API'))];
    const overdue = all.filter(
      (t) => t.dueDate !== null && t.dueDate < today() && t.category !== 'completed',
    );
    expect(overdue.length).toBeGreaterThanOrEqual(3);
    expect(all.filter((t) => t.assigneeId === null).length).toBeGreaterThanOrEqual(3);
    // A completed ticket that was past due is not "overdue".
    expect(
      all.some((t) => t.dueDate !== null && t.dueDate < today() && t.category === 'completed'),
    ).toBe(true);
  });

  it('keeps every reference inside its own workspace', async () => {
    const acmeLabelNames = (
      await db
        .select({ name: labels.name })
        .from(labels)
        .innerJoin(organisations, eq(organisations.id, labels.organisationId))
        .where(eq(organisations.slug, 'acme'))
    ).map((l) => l.name);
    expect(acmeLabelNames.sort()).toEqual([
      'backend',
      'bug',
      'docs',
      'frontend',
      'performance',
      'security',
    ]);

    const nora = (await db.select().from(users).where(eq(users.email, 'owner@northwind.test')))[0]!;
    const noraAcme = await db
      .select()
      .from(organisationMemberships)
      .innerJoin(organisations, eq(organisations.id, organisationMemberships.organisationId))
      .where(and(eq(organisationMemberships.userId, nora.id), eq(organisations.slug, 'acme')));
    expect(noraAcme).toHaveLength(0);
  });

  it('labels tickets, using only labels of the ticket’s workspace', async () => {
    const rows = await db
      .select({ ticketOrg: tickets.organisationId, labelOrg: labels.organisationId })
      .from(ticketLabels)
      .innerJoin(tickets, eq(tickets.id, ticketLabels.ticketId))
      .innerJoin(labels, eq(labels.id, ticketLabels.labelId));
    expect(rows.length).toBeGreaterThan(15);
    for (const row of rows) expect(row.labelOrg).toBe(row.ticketOrg);
  });

  it('gives every ticket a creation event, and some richer history', async () => {
    const all = await db.select({ id: tickets.id }).from(tickets);
    const created = await db
      .select({ ticketId: ticketEvents.ticketId })
      .from(ticketEvents)
      .where(eq(ticketEvents.type, 'ticket.created'));
    expect(new Set(created.map((e) => e.ticketId)).size).toBe(all.length);

    const types = new Set(
      (await db.select({ type: ticketEvents.type }).from(ticketEvents)).map((e) => e.type),
    );
    for (const type of ['ticket.status_changed', 'ticket.updated', 'comment.added']) {
      expect(types.has(type), type).toBe(true);
    }
  });

  it('adds five comments across three tickets, each with a matching event', async () => {
    const comments = await db.select().from(ticketComments);
    expect(comments).toHaveLength(5);
    expect(new Set(comments.map((c) => c.ticketId)).size).toBe(3);
    const events = await db
      .select()
      .from(ticketEvents)
      .where(
        and(
          eq(ticketEvents.type, 'comment.added'),
          inArray(
            sql`${ticketEvents.data}->>'commentId'`,
            comments.map((c) => c.id),
          ),
        ),
      );
    expect(events).toHaveLength(5);
  });

  it('gives WEB an epic with children and a sub-task, and one open blocker', async () => {
    const all = await db.select().from(tickets);
    const keyOf = new Map(all.map((t) => [t.id, t.key]));
    const parents = Object.fromEntries(
      all.filter((t) => t.parentId).map((t) => [t.key, keyOf.get(t.parentId!)]),
    );
    expect(parents).toEqual({
      'WEB-8': 'WEB-5',
      'WEB-11': 'WEB-5',
      'WEB-12': 'WEB-5',
      'WEB-10': 'WEB-8',
    });
    const [epic] = await db
      .select({ key: ticketTypes.key })
      .from(tickets)
      .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.typeId))
      .where(eq(tickets.key, 'WEB-5'));
    expect(epic!.key).toBe('epic');
    const links = await db.select().from(ticketLinks);
    expect(
      links.map((l) => [keyOf.get(l.sourceTicketId), l.kind, keyOf.get(l.targetTicketId)]),
    ).toEqual([['API-3', 'blocks', 'WEB-7']]);
  });

  it('is repeatable: reseeding gives the same counts', async () => {
    await reseedDevelopmentData(db);
    expect((await db.select().from(tickets)).length).toBe(24);
    expect((await ticketsOf('WEB')).length).toBe(12);
  });
});
