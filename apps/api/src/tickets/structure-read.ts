import { projectStatuses, ticketLinks, tickets, type Executor } from '@forge/db';
import {
  MAX_TICKET_DEPTH,
  linkLabel,
  type ChildNode,
  type LinkDirection,
  type Progress,
  type StatusCategory,
  type TicketLink,
  type TicketLinkKind,
  type TicketRef,
} from '@forge/shared';
import { and, eq, or, sql } from 'drizzle-orm';

/** The order links are listed in: what holds this ticket up comes first. */
const LABEL_ORDER = ['Blocked by', 'Blocks', 'Relates to', 'Duplicates', 'Duplicated by'];

const refColumns = {
  key: tickets.key,
  title: tickets.title,
  archivedAt: tickets.archivedAt,
  statusKey: projectStatuses.key,
  statusName: projectStatuses.name,
  statusCategory: projectStatuses.category,
};

type RefRow = {
  key: string;
  title: string;
  archivedAt: Date | string | null;
  statusKey: string;
  statusName: string;
  statusCategory: string;
};

export const toRef = (row: RefRow): TicketRef => ({
  key: row.key,
  title: row.title,
  status: {
    key: row.statusKey,
    name: row.statusName,
    category: row.statusCategory as StatusCategory,
  },
  archived: row.archivedAt !== null,
});

/** Every link touching the ticket, worded from its side, grouped by label and then by key. */
export async function loadLinks(
  executor: Executor,
  organisationId: string,
  ticketId: string,
): Promise<TicketLink[]> {
  const rows = await executor
    .select({
      id: ticketLinks.id,
      kind: ticketLinks.kind,
      sourceTicketId: ticketLinks.sourceTicketId,
      ...refColumns,
    })
    .from(ticketLinks)
    .innerJoin(
      tickets,
      or(
        and(eq(ticketLinks.sourceTicketId, ticketId), eq(tickets.id, ticketLinks.targetTicketId)),
        and(eq(ticketLinks.targetTicketId, ticketId), eq(tickets.id, ticketLinks.sourceTicketId)),
      ),
    )
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
    .where(eq(ticketLinks.organisationId, organisationId));

  return rows
    .map((row) => {
      const kind = row.kind as TicketLinkKind;
      const direction: LinkDirection = row.sourceTicketId === ticketId ? 'outward' : 'inward';
      return { id: row.id, kind, direction, label: linkLabel(kind, direction), ticket: toRef(row) };
    })
    .sort(
      (a, b) =>
        LABEL_ORDER.indexOf(a.label) - LABEL_ORDER.indexOf(b.label) ||
        a.ticket.key.localeCompare(b.ticket.key, 'en', { numeric: true }),
    );
}

const idList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/**
 * Progress of each ticket that has descendants, counting every level below it. Scrapped (a
 * cancellation status) and archived descendants are left out of both the counts and the total.
 */
export async function progressOf(
  executor: Executor,
  ticketIds: string[],
): Promise<Map<string, Progress>> {
  const found = new Map<string, Progress>();
  if (ticketIds.length === 0) return found;
  const result = await executor.execute<{
    root: string;
    statusKey: string;
    category: string;
    cancellation: boolean;
    archived: boolean;
  }>(sql`
    with recursive below(root, id, depth) as (
      select t.parent_id, t.id, 1 from tickets t where t.parent_id in (${idList(ticketIds)})
      union all
      select below.root, t.id, below.depth + 1 from tickets t join below on t.parent_id = below.id
      where below.depth < ${MAX_TICKET_DEPTH}
    )
    select below.root as "root", s.key as "statusKey", s.category as "category",
      s.is_cancellation as "cancellation", t.archived_at is not null as "archived"
    from below
    join tickets t on t.id = below.id
    join project_statuses s on s.id = t.status_id`);
  for (const row of result.rows) {
    const progress = found.get(row.root) ?? {
      completed: 0,
      inProgress: 0,
      jammed: 0,
      notStarted: 0,
    };
    found.set(row.root, progress);
    if (row.cancellation || row.archived) continue;
    if (row.category === 'completed') progress.completed += 1;
    else if (row.statusKey === 'blocked') progress.jammed += 1;
    else if (row.category === 'in_progress') progress.inProgress += 1;
    else progress.notStarted += 1;
  }
  // A ticket whose only descendants are scrapped or archived shows no progress at all.
  for (const [root, progress] of found) {
    if (Object.values(progress).every((count) => count === 0)) found.delete(root);
  }
  return found;
}

type RefRowWithTree = RefRow & { id: string; parentId: string | null; depth: number };

/** The ticket's ancestors, from the top-level ticket down to its parent. */
export async function ancestorsOf(executor: Executor, ticketId: string): Promise<TicketRef[]> {
  const result = await executor.execute<RefRowWithTree>(sql`
    with recursive up(id, parent_id, depth) as (
      select id, parent_id, 0 from tickets where id = ${ticketId}
      union all
      select t.id, t.parent_id, up.depth + 1 from tickets t join up on t.id = up.parent_id
      where up.depth < ${MAX_TICKET_DEPTH}
    )
    select t.id, t.key, t.title, t.archived_at as "archivedAt", s.key as "statusKey",
      s.name as "statusName", s.category as "statusCategory", up.depth
    from up join tickets t on t.id = up.id join project_statuses s on s.id = t.status_id
    where up.depth > 0
    order by up.depth desc`);
  return result.rows.map(toRef);
}

const byKey = (a: { key: string }, b: { key: string }) =>
  a.key.localeCompare(b.key, 'en', { numeric: true });

/** Everything under the ticket, nested, each level ordered by key. */
export async function childTreeOf(executor: Executor, ticketId: string): Promise<ChildNode[]> {
  const result = await executor.execute<RefRowWithTree>(sql`
    with recursive down(id, depth) as (
      select id, 0 from tickets where id = ${ticketId}
      union all
      select t.id, down.depth + 1 from tickets t join down on t.parent_id = down.id
      where down.depth < ${MAX_TICKET_DEPTH}
    )
    select t.id, t.parent_id as "parentId", t.key, t.title, t.archived_at as "archivedAt",
      s.key as "statusKey", s.name as "statusName", s.category as "statusCategory", down.depth
    from down join tickets t on t.id = down.id join project_statuses s on s.id = t.status_id
    where down.depth > 0`);
  const nodes = new Map(
    result.rows.map((row) => [row.id, { ...toRef(row), children: [] as ChildNode[] }] as const),
  );
  const top: ChildNode[] = [];
  for (const row of result.rows) {
    const node = nodes.get(row.id)!;
    (row.parentId === ticketId ? top : nodes.get(row.parentId!)?.children)?.push(node);
  }
  const sort = (list: ChildNode[]) => {
    list.sort(byKey);
    for (const node of list) sort(node.children);
  };
  sort(top);
  return top;
}
