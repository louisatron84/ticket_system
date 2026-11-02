import {
  cycles,
  labels,
  milestones,
  organisationMemberships,
  priorities,
  projectStatuses,
  projects,
  ticketTypes,
  users,
  type Executor,
} from '@forge/db';
import {
  applyTicketQuery,
  hasPermission,
  parseTicketQuery,
  type QueryContext,
  type TicketFilters,
} from '@forge/shared';
import { and, asc, eq } from 'drizzle-orm';
import { AppError } from '../errors';
import { together } from '../together';

/** Statuses and the like named the same way in several projects are listed once. */
const distinct = <T extends { key: string; name: string }>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const id = `${row.key}\u0000${row.name}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

/**
 * What names in a query can mean in this workspace. People are listed only for someone who may see
 * the member list; anyone can still say `me`.
 */
export async function queryContextFor(
  executor: Executor,
  viewer: { organisationId: string; permissions: string[] },
): Promise<QueryContext> {
  const org = viewer.organisationId;
  const [
    statusRows,
    typeRows,
    priorityRows,
    people,
    milestoneRows,
    cycleRows,
    projectRows,
    labelRows,
  ] = await together(executor, [
    () =>
      executor
        .select({ key: projectStatuses.key, name: projectStatuses.name })
        .from(projectStatuses)
        .where(eq(projectStatuses.organisationId, org))
        .orderBy(asc(projectStatuses.sortOrder)),
    () =>
      executor
        .select({ key: ticketTypes.key, name: ticketTypes.name })
        .from(ticketTypes)
        .where(and(eq(ticketTypes.organisationId, org), eq(ticketTypes.isActive, true)))
        .orderBy(asc(ticketTypes.sortOrder)),
    () =>
      executor
        .select({ key: priorities.key, name: priorities.name })
        .from(priorities)
        .where(and(eq(priorities.organisationId, org), eq(priorities.isActive, true)))
        .orderBy(asc(priorities.rank)),
    () =>
      hasPermission(viewer.permissions, 'members.view')
        ? executor
            .select({ id: users.id, name: users.displayName, email: users.email })
            .from(organisationMemberships)
            .innerJoin(users, eq(users.id, organisationMemberships.userId))
            .where(eq(organisationMemberships.organisationId, org))
            .orderBy(asc(users.displayName))
        : Promise.resolve([]),
    () =>
      executor
        .select({ id: milestones.id, name: milestones.name })
        .from(milestones)
        .where(eq(milestones.organisationId, org))
        .orderBy(asc(milestones.name)),
    () =>
      executor
        .select({ id: cycles.id, name: cycles.name })
        .from(cycles)
        .where(eq(cycles.organisationId, org))
        .orderBy(asc(cycles.startsOn)),
    () =>
      executor
        .select({ key: projects.key })
        .from(projects)
        .where(eq(projects.organisationId, org))
        .orderBy(asc(projects.key)),
    () =>
      executor
        .select({ name: labels.name })
        .from(labels)
        .where(eq(labels.organisationId, org))
        .orderBy(asc(labels.name)),
  ]);
  return {
    statuses: distinct(statusRows),
    types: typeRows,
    priorities: priorityRows,
    people,
    milestones: milestoneRows,
    cycles: cycleRows,
    projects: projectRows.map((row) => row.key),
    labels: labelRows.map((row) => row.name),
  };
}

/**
 * Applies a `query=` text on top of the other filters: the fields it names replace theirs.
 * An invalid query is a 422 naming each problem.
 */
export async function withQueryText(
  executor: Executor,
  viewer: { organisationId: string; permissions: string[] },
  filters: TicketFilters,
  query: unknown,
): Promise<TicketFilters> {
  const text = (query as { query?: unknown } | null)?.query;
  if (text === undefined) return filters;
  if (typeof text !== 'string') {
    throw new AppError('validation_failed', 'Give query once.', 422, [
      { path: 'query', message: 'Give a single query.' },
    ]);
  }
  const parsed = parseTicketQuery(text, await queryContextFor(executor, viewer));
  if (!parsed.ok) {
    throw new AppError(
      'validation_failed',
      'The query has problems.',
      422,
      parsed.issues.map((issue) => ({ path: 'query', message: issue.message })),
    );
  }
  return applyTicketQuery(filters, parsed);
}
