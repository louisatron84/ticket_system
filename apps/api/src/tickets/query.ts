import {
  labels,
  priorities,
  projectStatuses,
  projects,
  ticketLabels,
  ticketTypes,
  tickets,
  type Executor,
} from '@forge/db';
import { parseTicketFilters, type TicketFilters, type TicketList } from '@forge/shared';
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../errors';
import { loadTicketSummaries } from './read';

// Nothing here puts request text into SQL. Text is only ever bound as a parameter, and the one
// thing chosen by name (the sort) is looked up in a fixed list.

/** Makes LIKE treat `%`, `_` and `\` as the characters they are, not as wildcards. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

/** Pattern for titles that contain the text, ignoring case (titles are compared in lower case). */
export const titleContainsPattern = (text: string) => `%${escapeLike(text.toLowerCase())}%`;

/** Pattern for keys that start with the text: "web-1" finds WEB-1 and WEB-10. */
export const keyPrefixPattern = (text: string) => `${escapeLike(text.toUpperCase())}%`;

/**
 * The ORDER BY for a sort and direction. Always ends with the ticket id, in the same direction,
 * so rows that tie never swap places between pages.
 */
export function orderFor(sort: TicketFilters['sort'], dir: TicketFilters['dir']): SQL[] {
  const direction = dir === 'asc' ? asc : desc;
  switch (sort) {
    case 'updated':
      return [direction(tickets.updatedAt), direction(tickets.id)];
    case 'created':
      return [direction(tickets.createdAt), direction(tickets.id)];
    case 'priority':
      return [direction(priorities.rank), direction(tickets.id)];
    case 'due':
      // Tickets without a due date go last whichever way the rest are ordered.
      return [
        dir === 'asc'
          ? sql`${tickets.dueDate} asc nulls last`
          : sql`${tickets.dueDate} desc nulls last`,
        direction(tickets.id),
      ];
    case 'key':
      // By project, then by ticket number as a number: WEB-2 comes before WEB-10.
      return [direction(projects.key), direction(tickets.number), direction(tickets.id)];
    default:
      throw new Error(`Unknown sort: ${String(sort)}`);
  }
}

/** Reads the filters from a query string, or refuses with a 422 that names each problem. */
export function filtersFromQuery(query: unknown): TicketFilters {
  const parsed = parseTicketFilters((query ?? {}) as Record<string, string | string[] | undefined>);
  if (parsed.ok) return parsed.filters;
  throw new AppError(
    'validation_failed',
    'Some of the filters are not valid.',
    422,
    parsed.issues.map((issue) => {
      const split = issue.indexOf(': ');
      return split === -1
        ? { path: 'filters', message: issue }
        : { path: issue.slice(0, split), message: issue.slice(split + 2) };
    }),
  );
}

/** Whose workspace this is and who is asking, so "me" can mean someone. */
export type QueryActor = { organisationId: string; userId: string };

// "Today" is the UTC calendar date, not whatever timezone the database server happens to be in.
const today = sql`(timezone('utc', now()))::date`;

/**
 * The conditions that narrow tickets to what the filters ask for. Always includes the workspace.
 * The query must join projects, project_statuses, ticket_types and priorities to the tickets.
 */
export function conditionsFor(
  filters: TicketFilters,
  actor: QueryActor,
  options: { ignoreStatus?: boolean; ignoreProject?: boolean } = {},
): SQL[] {
  const conditions: SQL[] = [eq(tickets.organisationId, actor.organisationId)];
  const add = (condition: SQL | undefined) => {
    if (condition) conditions.push(condition);
  };

  if (!filters.archived) add(isNull(tickets.archivedAt));

  if (filters.q) {
    add(
      or(
        sql`${tickets.key} like ${keyPrefixPattern(filters.q)} escape '\\'`,
        sql`lower(${tickets.title}) like ${titleContainsPattern(filters.q)} escape '\\'`,
      ),
    );
  }

  if (!options.ignoreProject && filters.project.length > 0) {
    add(inArray(projects.key, filters.project));
  }
  if (!options.ignoreStatus) {
    if (filters.statusKey.length > 0) add(inArray(projectStatuses.key, filters.statusKey));
    if (filters.statusCategory.length > 0) {
      add(inArray(projectStatuses.category, filters.statusCategory));
    }
  }
  if (filters.type.length > 0) add(inArray(ticketTypes.key, filters.type));
  if (filters.priority.length > 0) add(inArray(priorities.key, filters.priority));

  if (filters.assignee.length > 0) {
    add(
      or(
        ...filters.assignee.map((who) =>
          who === 'none'
            ? isNull(tickets.assigneeId)
            : eq(tickets.assigneeId, who === 'me' ? actor.userId : who),
        ),
      ),
    );
  }
  if (filters.reporter.length > 0) {
    add(
      inArray(
        tickets.reporterId,
        filters.reporter.map((who) => (who === 'me' ? actor.userId : who)),
      ),
    );
  }

  // Every label asked for must be on the ticket.
  for (const name of filters.label) {
    add(sql`exists (
      select 1 from ${ticketLabels}
      inner join ${labels} on ${labels.id} = ${ticketLabels.labelId}
      where ${ticketLabels.ticketId} = ${tickets.id}
        and ${ticketLabels.organisationId} = ${actor.organisationId}
        and lower(${labels.name}) = lower(${name})
    )`);
  }

  switch (filters.due) {
    case 'overdue':
      add(sql`${tickets.dueDate} < ${today} and ${projectStatuses.category} <> 'completed'`);
      break;
    case 'today':
      add(sql`${tickets.dueDate} = ${today}`);
      break;
    case 'week':
      add(sql`${tickets.dueDate} between ${today} and ${today} + 7`);
      break;
    case 'none':
      add(isNull(tickets.dueDate));
      break;
    default:
      break;
  }

  // Structure. Each names a ticket by key; a key that does not exist here matches nothing.
  const ticketIdOf = (key: string) =>
    sql`(select k.id from tickets k where k.organisation_id = ${actor.organisationId} and k.key = ${key})`;
  if (filters.parent) add(sql`${tickets.parentId} = ${ticketIdOf(filters.parent)}`);
  if (filters.epic) {
    // Depth is at most three, so anything under a ticket is its child or its child's child.
    add(sql`(${tickets.parentId} = ${ticketIdOf(filters.epic)} or exists (
      select 1 from tickets m where m.id = ${tickets.parentId} and m.parent_id = ${ticketIdOf(filters.epic)}
    ))`);
  }
  if (filters.linked) {
    add(sql`exists (
      select 1 from ticket_links l
      where (l.source_ticket_id = ${tickets.id} and l.target_ticket_id = ${ticketIdOf(filters.linked)})
         or (l.target_ticket_id = ${tickets.id} and l.source_ticket_id = ${ticketIdOf(filters.linked)})
    )`);
  }
  if (filters.blocked) {
    // Blocked means not finished and held up by a ticket that is not finished either.
    const blocked = sql`(${projectStatuses.category} <> 'completed' and exists (
      select 1 from ticket_links l
      join tickets b on b.id = l.source_ticket_id
      join project_statuses bs on bs.id = b.status_id
      where l.kind = 'blocks' and l.target_ticket_id = ${tickets.id} and bs.category <> 'completed'
    ))`;
    add(filters.blocked === 'yes' ? blocked : sql`not ${blocked}`);
  }
  if (filters.top) add(isNull(tickets.parentId));

  return conditions;
}

/** One page of ticket ids, in order, and how many tickets match in all. */
export async function searchTicketIds(
  executor: Executor,
  input: { where: SQL[]; order: SQL[]; limit: number; offset: number },
): Promise<{ ids: string[]; total: number }> {
  const condition = and(...input.where);
  const [rows, counted] = await Promise.all([
    executor
      .select({ id: tickets.id })
      .from(tickets)
      .innerJoin(projects, eq(projects.id, tickets.projectId))
      .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
      .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.typeId))
      .innerJoin(priorities, eq(priorities.id, tickets.priorityId))
      .where(condition)
      .orderBy(...input.order)
      .limit(input.limit)
      .offset(input.offset),
    executor
      .select({ total: sql<number>`count(*)::int` })
      .from(tickets)
      .innerJoin(projects, eq(projects.id, tickets.projectId))
      .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
      .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.typeId))
      .innerJoin(priorities, eq(priorities.id, tickets.priorityId))
      .where(condition),
  ]);
  return { ids: rows.map((row) => row.id), total: counted[0]?.total ?? 0 };
}

/** A page of tickets matching the filters, as the list shows them. */
export async function listTickets(
  executor: Executor,
  actor: QueryActor,
  filters: TicketFilters,
): Promise<TicketList> {
  if (filters.tree) return listTicketTree(executor, actor, filters);
  const { ids, total } = await searchTicketIds(executor, {
    where: conditionsFor(filters, actor),
    order: orderFor(filters.sort, filters.dir),
    limit: filters.pageSize,
    offset: (filters.page - 1) * filters.pageSize,
  });
  return {
    items: await loadTicketSummaries(executor, actor.organisationId, ids),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

/** How many matches tree mode arranges at most; the total still counts every match. */
const TREE_MATCH_LIMIT = 2000;

/**
 * Tree mode: a page is up to `pageSize` top-level rows, each with every matching ticket of its
 * tree nested under it. Ancestors that do not match are included as context rows so a child always
 * sits under its real parent, even one in another project. Siblings keep the filter's sort order.
 */
async function listTicketTree(
  executor: Executor,
  actor: QueryActor,
  filters: TicketFilters,
): Promise<TicketList> {
  const { ids: matched, total } = await searchTicketIds(executor, {
    where: conditionsFor(filters, actor),
    order: orderFor(filters.sort, filters.dir),
    limit: TREE_MATCH_LIMIT,
    offset: 0,
  });

  // Every ancestor of a match, at most two steps up.
  const parentOf = new Map<string, string | null>();
  let frontier = matched;
  while (frontier.length > 0) {
    const rows = await executor
      .select({ id: tickets.id, parentId: tickets.parentId })
      .from(tickets)
      .where(and(eq(tickets.organisationId, actor.organisationId), inArray(tickets.id, frontier)));
    for (const row of rows) parentOf.set(row.id, row.parentId);
    frontier = rows.flatMap((row) =>
      row.parentId && !parentOf.has(row.parentId) ? [row.parentId] : [],
    );
  }

  // A node ranks where its earliest matching descendant (or itself) ranks.
  const rank = new Map<string, number>();
  matched.forEach((id, index) => {
    for (let node: string | null | undefined = id; node; node = parentOf.get(node)) {
      if (!rank.has(node) || rank.get(node)! > index) rank.set(node, index);
    }
  });
  const rootOf = (id: string) => {
    let node = id;
    while (parentOf.get(node)) node = parentOf.get(node)!;
    return node;
  };
  const roots = [...new Set(matched.map(rootOf))].sort((a, b) => rank.get(a)! - rank.get(b)!);
  const pageRoots = new Set(
    roots.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize),
  );

  const children = new Map<string, string[]>();
  for (const node of rank.keys()) {
    const parent = parentOf.get(node);
    if (parent && rank.has(parent)) children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const order: { id: string; depth: number }[] = [];
  const visit = (id: string, depth: number) => {
    order.push({ id, depth });
    const below = (children.get(id) ?? []).sort((a, b) => rank.get(a)! - rank.get(b)!);
    for (const child of below) visit(child, depth + 1);
  };
  for (const root of roots) if (pageRoots.has(root)) visit(root, 1);

  const isMatch = new Set(matched);
  const summaries = new Map(
    (
      await loadTicketSummaries(
        executor,
        actor.organisationId,
        order.map((row) => row.id),
      )
    ).map((summary) => [summary.id, summary] as const),
  );
  const rows = order.flatMap(({ id, depth }) => {
    const ticket = summaries.get(id);
    return ticket ? [{ ticket, depth, context: !isMatch.has(id) }] : [];
  });
  return {
    items: rows.filter((row) => !row.context).map((row) => row.ticket),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    rows,
    rootTotal: roots.length,
  };
}
