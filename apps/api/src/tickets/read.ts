import {
  components,
  labels,
  priorities,
  projectStatuses,
  projects,
  statusTransitions,
  ticketComments,
  ticketLabels,
  ticketTypes,
  tickets,
  users,
  type Executor,
} from '@forge/db';
import type { Label, Progress, StatusCategory, TicketDetail, TicketSummary } from '@forge/shared';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { openBlockersOf } from './blockers';
import {
  criteriaCountsFor,
  loadAttachments,
  loadCriteria,
  mentionedInOf,
  referencesOf,
} from './content';
import { ancestorsOf, childTreeOf, loadLinks, progressOf } from './structure-read';

const assigneeUser = alias(users, 'assignee_user');
const reporterUser = alias(users, 'reporter_user');
const parentTicket = alias(tickets, 'parent_ticket');

const columns = {
  id: tickets.id,
  key: tickets.key,
  title: tickets.title,
  description: tickets.description,
  goal: tickets.goal,
  projectId: projects.id,
  projectKey: projects.key,
  projectName: projects.name,
  typeId: ticketTypes.id,
  typeKey: ticketTypes.key,
  typeName: ticketTypes.name,
  statusId: projectStatuses.id,
  statusKey: projectStatuses.key,
  statusName: projectStatuses.name,
  statusCategory: projectStatuses.category,
  priorityId: priorities.id,
  priorityKey: priorities.key,
  priorityName: priorities.name,
  priorityRank: priorities.rank,
  assigneeId: assigneeUser.id,
  assigneeEmail: assigneeUser.email,
  assigneeName: assigneeUser.displayName,
  reporterId: reporterUser.id,
  reporterEmail: reporterUser.email,
  reporterName: reporterUser.displayName,
  componentId: components.id,
  componentProjectId: components.projectId,
  componentName: components.name,
  dueDate: tickets.dueDate,
  estimateMinutes: tickets.estimateMinutes,
  version: tickets.version,
  completedAt: tickets.completedAt,
  archivedAt: tickets.archivedAt,
  parentId: tickets.parentId,
  parentKey: parentTicket.key,
  origin: tickets.origin,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
};

/** Every ticket row with its related names, restricted by `where`. */
function selectRows(executor: Executor, where: SQL | undefined) {
  return executor
    .select(columns)
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.typeId))
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
    .innerJoin(priorities, eq(priorities.id, tickets.priorityId))
    .innerJoin(reporterUser, eq(reporterUser.id, tickets.reporterId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, tickets.assigneeId))
    .leftJoin(components, eq(components.id, tickets.componentId))
    .leftJoin(parentTicket, eq(parentTicket.id, tickets.parentId))
    .where(where);
}
type Row = Awaited<ReturnType<typeof selectRows>>[number];

async function labelsFor(
  executor: Executor,
  organisationId: string,
  ticketIds: string[],
): Promise<Map<string, Label[]>> {
  const byTicket = new Map<string, Label[]>();
  if (ticketIds.length === 0) return byTicket;
  const rows = await executor
    .select({
      ticketId: ticketLabels.ticketId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(ticketLabels)
    .innerJoin(labels, eq(labels.id, ticketLabels.labelId))
    .where(
      and(
        eq(ticketLabels.organisationId, organisationId),
        inArray(ticketLabels.ticketId, ticketIds),
      ),
    )
    .orderBy(asc(sql`lower(${labels.name})`));
  for (const { ticketId, ...label } of rows) {
    byTicket.set(ticketId, [...(byTicket.get(ticketId) ?? []), label as Label]);
  }
  return byTicket;
}

/** How many comments each of these tickets has. A ticket with none is absent from the map. */
async function commentCountsFor(
  executor: Executor,
  organisationId: string,
  ticketIds: string[],
): Promise<Map<string, number>> {
  if (ticketIds.length === 0) return new Map();
  const rows = await executor
    .select({ ticketId: ticketComments.ticketId, total: sql<number>`count(*)::int` })
    .from(ticketComments)
    .where(
      and(
        eq(ticketComments.organisationId, organisationId),
        inArray(ticketComments.ticketId, ticketIds),
      ),
    )
    .groupBy(ticketComments.ticketId);
  return new Map(rows.map((row) => [row.ticketId, row.total]));
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** What the structure read adds to a summary: progress below it and what blocks it. */
type Structure = {
  progress: Progress | null;
  openBlockerKeys: string[];
  criteria: { done: number; total: number };
};
const NO_CRITERIA = { done: 0, total: 0 };

function toSummary(
  row: Row,
  ticketLabelsList: Label[],
  commentCount: number,
  structure: Structure,
): TicketSummary {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    project: { id: row.projectId, key: row.projectKey, name: row.projectName },
    type: { id: row.typeId, key: row.typeKey, name: row.typeName },
    status: {
      id: row.statusId,
      key: row.statusKey,
      name: row.statusName,
      category: row.statusCategory as StatusCategory,
    },
    priority: {
      id: row.priorityId,
      key: row.priorityKey,
      name: row.priorityName,
      rank: row.priorityRank,
    },
    assignee: row.assigneeId
      ? { id: row.assigneeId, email: row.assigneeEmail!, displayName: row.assigneeName! }
      : null,
    labels: ticketLabelsList,
    dueDate: row.dueDate,
    version: row.version,
    commentCount,
    parentKey: row.parentKey,
    progress: structure.progress,
    // A finished ticket is not blocked by anything any more.
    openBlockerKeys: row.statusCategory === 'completed' ? [] : structure.openBlockerKeys,
    criteria: structure.criteria,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Summaries for exactly these tickets of this workspace, in the order the ids are given. */
export async function loadTicketSummaries(
  executor: Executor,
  organisationId: string,
  ids: string[],
): Promise<TicketSummary[]> {
  if (ids.length === 0) return [];
  const [rows, labelMap, commentCounts, progress, blockers, criteria] = await Promise.all([
    selectRows(executor, and(eq(tickets.organisationId, organisationId), inArray(tickets.id, ids))),
    labelsFor(executor, organisationId, ids),
    commentCountsFor(executor, organisationId, ids),
    progressOf(executor, ids),
    openBlockersOf(executor, organisationId, ids),
    criteriaCountsFor(executor, organisationId, ids),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row
      ? [
          toSummary(row, labelMap.get(id) ?? [], commentCounts.get(id) ?? 0, {
            progress: progress.get(id) ?? null,
            openBlockerKeys: blockers.get(id) ?? [],
            criteria: criteria.get(id) ?? NO_CRITERIA,
          }),
        ]
      : [];
  });
}

/** One ticket in full, or null if the key does not exist in this workspace. */
export async function loadTicketDetail(
  executor: Executor,
  organisationId: string,
  ticketKey: string,
): Promise<TicketDetail | null> {
  const [row] = await selectRows(
    executor,
    and(eq(tickets.organisationId, organisationId), eq(tickets.key, ticketKey)),
  );
  if (!row) return null;

  const [
    labelMap,
    commentCounts,
    progress,
    blockers,
    ancestors,
    children,
    links,
    next,
    criteriaItems,
    attachments,
    mentionedIn,
  ] = await Promise.all([
    labelsFor(executor, organisationId, [row.id]),
    commentCountsFor(executor, organisationId, [row.id]),
    progressOf(executor, [row.id]),
    openBlockersOf(executor, organisationId, [row.id]),
    ancestorsOf(executor, row.id),
    childTreeOf(executor, row.id),
    loadLinks(executor, organisationId, row.id),
    executor
      .select({
        id: projectStatuses.id,
        key: projectStatuses.key,
        name: projectStatuses.name,
        category: projectStatuses.category,
      })
      .from(statusTransitions)
      .innerJoin(projectStatuses, eq(projectStatuses.id, statusTransitions.toStatusId))
      .where(
        and(
          eq(statusTransitions.projectId, row.projectId),
          eq(statusTransitions.fromStatusId, row.statusId),
          eq(projectStatuses.isActive, true),
        ),
      )
      .orderBy(asc(projectStatuses.sortOrder)),
    loadCriteria(executor, row.id),
    loadAttachments(executor, row.id),
    mentionedInOf(executor, row.id),
  ]);
  const references = await referencesOf(executor, organisationId, row, criteriaItems);
  const done = criteriaItems.filter((item) => item.done).length;

  return {
    ...toSummary(row, labelMap.get(row.id) ?? [], commentCounts.get(row.id) ?? 0, {
      progress: progress.get(row.id) ?? null,
      openBlockerKeys: blockers.get(row.id) ?? [],
      criteria: { done, total: criteriaItems.length },
    }),
    description: row.description,
    goal: row.goal,
    criteriaItems,
    attachments,
    mentionedIn,
    references,
    reporter: { id: row.reporterId, email: row.reporterEmail, displayName: row.reporterName },
    component: row.componentId
      ? { id: row.componentId, projectId: row.componentProjectId!, name: row.componentName! }
      : null,
    estimateMinutes: row.estimateMinutes,
    version: row.version,
    completedAt: iso(row.completedAt),
    archivedAt: iso(row.archivedAt),
    allowedTransitions: next.map((status) => ({
      ...status,
      category: status.category as StatusCategory,
    })),
    ancestors,
    children,
    links,
    origin: row.origin as 'person' | 'scan',
  };
}
