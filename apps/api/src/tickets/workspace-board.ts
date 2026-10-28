import { projectStatuses, projects, statusTransitions, tickets, type Executor } from '@forge/db';
import type { StatusCategory, TicketFilters, Workflow, WorkspaceBoard } from '@forge/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { COLUMN_LIMIT } from './board';
import { conditionsFor, orderFor, searchTicketIds, type QueryActor } from './query';
import { loadTicketSummaries } from './read';

type StatusRow = typeof projectStatuses.$inferSelect;

/**
 * The workflow of every project of the workspace (or of the named projects), ordered by project
 * key: its active statuses in order, and every allowed move. Also hands back the rows it read, for
 * the board, which builds its columns from the same statuses.
 */
async function readWorkflows(executor: Executor, actor: QueryActor, projectKeys: string[] = []) {
  const projectRows = await executor
    .select({ id: projects.id, key: projects.key, archivedAt: projects.archivedAt })
    .from(projects)
    .where(
      and(
        eq(projects.organisationId, actor.organisationId),
        projectKeys.length > 0 ? inArray(projects.key, projectKeys) : undefined,
      ),
    )
    .orderBy(asc(projects.key));
  if (projectRows.length === 0) {
    return { projectRows, statusRows: [] as StatusRow[], workflows: [] as Workflow[] };
  }

  const projectIds = projectRows.map((project) => project.id);
  const [statusRows, transitionRows] = await Promise.all([
    executor
      .select()
      .from(projectStatuses)
      .where(
        and(inArray(projectStatuses.projectId, projectIds), eq(projectStatuses.isActive, true)),
      )
      .orderBy(asc(projectStatuses.sortOrder)),
    executor
      .select({
        projectId: statusTransitions.projectId,
        fromStatusId: statusTransitions.fromStatusId,
        toStatusId: statusTransitions.toStatusId,
      })
      .from(statusTransitions)
      .where(inArray(statusTransitions.projectId, projectIds)),
  ]);

  const workflows: Workflow[] = projectRows.map((project) => ({
    projectId: project.id,
    projectKey: project.key,
    archived: project.archivedAt !== null,
    statuses: statusRows
      .filter((status) => status.projectId === project.id)
      .map((status) => ({
        id: status.id,
        key: status.key,
        name: status.name,
        category: status.category as StatusCategory,
      })),
    transitions: transitionRows
      .filter((transition) => transition.projectId === project.id)
      .map(({ fromStatusId, toStatusId }) => ({ fromStatusId, toStatusId })),
  }));
  return { projectRows, statusRows, workflows };
}

/** Every project's statuses and moves, so a move can be checked before it is sent. */
export async function loadWorkflows(
  executor: Executor,
  actor: QueryActor,
  projectKeys?: string[],
): Promise<Workflow[]> {
  return (await readWorkflows(executor, actor, projectKeys)).workflows;
}

/**
 * Every project's tickets on one board: a column per status key, so tickets of several projects
 * share a column. A column takes its name and category from the first project (by key) that has the
 * key, and its place from the smallest position any project gives it. Each project's workflow comes
 * with the board so a move can be checked against the ticket's own project. Status filters and
 * paging do not apply; the project filter does.
 */
export async function loadWorkspaceBoard(
  executor: Executor,
  actor: QueryActor,
  filters: TicketFilters,
): Promise<WorkspaceBoard> {
  const { projectRows, statusRows, workflows } = await readWorkflows(
    executor,
    actor,
    filters.project,
  );
  if (projectRows.length === 0) return { columns: [], workflows: [] };

  // Group by key. Projects are visited in key order, so the first status seen names the column.
  const projectOrder = new Map(projectRows.map((project, index) => [project.id, index]));
  const byKey = new Map<string, { first: StatusRow; sortOrder: number; ids: string[] }>();
  for (const status of [...statusRows].sort(
    (a, b) => projectOrder.get(a.projectId)! - projectOrder.get(b.projectId)!,
  )) {
    const group = byKey.get(status.key);
    if (group) {
      group.ids.push(status.id);
      group.sortOrder = Math.min(group.sortOrder, status.sortOrder);
    } else {
      byKey.set(status.key, { first: status, sortOrder: status.sortOrder, ids: [status.id] });
    }
  }
  const groups = [...byKey.entries()].sort(
    ([keyA, a], [keyB, b]) => a.sortOrder - b.sortOrder || keyA.localeCompare(keyB),
  );

  const shared = conditionsFor({ ...filters, triage: false }, actor, { ignoreStatus: true });
  const order = orderFor(filters.sort, filters.dir);
  const columns = await Promise.all(
    groups.map(async ([key, group]) => {
      const { ids, total } = await searchTicketIds(executor, {
        where: [...shared, inArray(tickets.statusId, group.ids)],
        order,
        limit: COLUMN_LIMIT,
        offset: 0,
      });
      return {
        status: {
          key,
          name: group.first.name,
          category: group.first.category as StatusCategory,
          sortOrder: group.sortOrder,
        },
        total,
        tickets: await loadTicketSummaries(executor, actor.organisationId, ids),
      };
    }),
  );
  return { columns, workflows };
}
