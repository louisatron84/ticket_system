import { projectStatuses, projects, tickets, type Executor } from '@forge/db';
import type { Board, StatusCategory, TicketFilters } from '@forge/shared';
import { and, asc, eq } from 'drizzle-orm';
import { AppError } from '../errors';
import { conditionsFor, orderFor, searchTicketIds, type QueryActor } from './query';
import { loadTicketSummaries } from './read';

/** How many tickets one column carries. The column's total says how many there really are. */
export const COLUMN_LIMIT = 50;

/**
 * A project's board: a column for every active status, each with the tickets in it that match the
 * filters. Status filters, the project filter and paging do not apply: the columns are the
 * statuses, the address names the project, and every column pages on its own.
 */
export async function loadBoard(
  executor: Executor,
  actor: QueryActor,
  projectKey: string,
  filters: TicketFilters,
): Promise<Board> {
  const [project] = await executor
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.organisationId, actor.organisationId), eq(projects.key, projectKey)));
  if (!project) throw new AppError('not_found', 'Not found.', 404);

  const statuses = await executor
    .select()
    .from(projectStatuses)
    .where(and(eq(projectStatuses.projectId, project.id), eq(projectStatuses.isActive, true)))
    .orderBy(asc(projectStatuses.sortOrder));

  const shared = [
    ...conditionsFor(filters, actor, { ignoreStatus: true, ignoreProject: true }),
    eq(tickets.projectId, project.id),
  ];
  const order = orderFor(filters.sort, filters.dir);

  const columns = await Promise.all(
    statuses.map(async (status) => {
      const { ids, total } = await searchTicketIds(executor, {
        where: [...shared, eq(tickets.statusId, status.id)],
        order,
        limit: COLUMN_LIMIT,
        offset: 0,
      });
      return {
        status: {
          id: status.id,
          key: status.key,
          name: status.name,
          category: status.category as StatusCategory,
          sortOrder: status.sortOrder,
          initial: status.isInitial,
        },
        total,
        tickets: await loadTicketSummaries(executor, actor.organisationId, ids),
      };
    }),
  );
  return { columns };
}
