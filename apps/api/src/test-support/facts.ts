import {
  components,
  developmentFixtures,
  labels,
  organisations,
  priorities,
  projectStatuses,
  projects,
  ticketTypes,
  tickets,
  type Db,
} from '@forge/db';
import { eq } from 'drizzle-orm';

/**
 * The ids the screens never show, looked up by the names the seed gives them, so tests can build
 * requests (and hostile ones) without guessing.
 */
export async function loadFacts(db: Db) {
  const orgs = await db.select().from(organisations);
  const orgId = (slug: string) => orgs.find((o) => o.slug === slug)!.id;

  const fixtures = await db.select().from(developmentFixtures);
  const userId = (identityKey: string) => fixtures.find((f) => f.key === identityKey)!.userId;

  const projectRows = await db.select().from(projects);
  const statusRows = await db.select().from(projectStatuses);
  const statusId = (projectKey: string, statusKey: string) => {
    const project = projectRows.find((p) => p.key === projectKey)!;
    return statusRows.find((s) => s.projectId === project.id && s.key === statusKey)!.id;
  };

  const typeRows = await db.select().from(ticketTypes);
  const typeId = (slug: string, key: string) =>
    typeRows.find((t) => t.organisationId === orgId(slug) && t.key === key)!.id;

  const priorityRows = await db.select().from(priorities);
  const priorityId = (slug: string, key: string) =>
    priorityRows.find((p) => p.organisationId === orgId(slug) && p.key === key)!.id;

  const labelRows = await db.select().from(labels);
  const labelId = (slug: string, name: string) =>
    labelRows.find((l) => l.organisationId === orgId(slug) && l.name === name)!.id;

  const componentRows = await db.select().from(components);
  const componentId = (projectKey: string, name: string) => {
    const project = projectRows.find((p) => p.key === projectKey)!;
    return componentRows.find((c) => c.projectId === project.id && c.name === name)!.id;
  };

  const ticketRows = await db.select().from(tickets);
  const ticket = (key: string) => ticketRows.find((t) => t.key === key)!;

  return {
    acmeId: orgId('acme'),
    northwindId: orgId('northwind'),
    orgId,
    userId,
    statusId,
    typeId,
    priorityId,
    labelId,
    componentId,
    ticket,
    projectId: (key: string) => projectRows.find((p) => p.key === key)!.id,
  };
}

export type Facts = Awaited<ReturnType<typeof loadFacts>>;

/** The current row for a ticket key, straight from the database. */
export async function ticketRow(db: Db, key: string) {
  const [row] = await db.select().from(tickets).where(eq(tickets.key, key));
  return row;
}
