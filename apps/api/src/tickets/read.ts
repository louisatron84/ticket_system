import {
  components,
  cycles,
  labels,
  milestones,
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
import type {
  Label,
  Progress,
  StatusCategory,
  TicketDetail,
  TicketFieldText,
  TicketSummary,
  TransitionRule,
} from '@forge/shared';
import { transitionRuleSentence } from '@forge/shared';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { watchersOf } from '../notifications/service';
import { triageInfoOf } from '../triage/read';
import { completionRefusalText, openBlockersOf } from './blockers';
import {
  criteriaCountsFor,
  loadAttachments,
  loadCriteria,
  mentionedInOf,
  referencesOf,
} from './content';
import { fieldTextsFor, textsOf, ticketFieldsOf } from './field-read';
import { ancestorsOf, childTreeOf, loadLinks, progressOf } from './structure-read';
import { together } from '../together';

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
  startDate: tickets.startDate,
  estimateMinutes: tickets.estimateMinutes,
  estimatePoints: tickets.estimatePoints,
  estimation: projects.estimation,
  blockersStopCompletion: projects.blockersStopCompletion,
  milestoneId: milestones.id,
  milestoneName: milestones.name,
  milestoneClosedAt: milestones.closedAt,
  cycleId: cycles.id,
  cycleName: cycles.name,
  cycleState: cycles.state,
  version: tickets.version,
  completedAt: tickets.completedAt,
  archivedAt: tickets.archivedAt,
  parentId: tickets.parentId,
  parentKey: parentTicket.key,
  origin: tickets.origin,
  triageState: tickets.triageState,
  triageSnoozedUntil: tickets.triageSnoozedUntil,
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
    .leftJoin(milestones, eq(milestones.id, tickets.milestoneId))
    .leftJoin(cycles, eq(cycles.id, tickets.cycleId))
    .leftJoin(parentTicket, eq(parentTicket.id, tickets.parentId))
    .where(where);
}
type Row = Awaited<ReturnType<typeof selectRows>>[number];

/**
 * Why a move the workflow allows would be refused right now, or null. The same checks and words
 * as the move itself, except a needed comment, which comes with the move.
 */
function moveRefusal(
  row: Row,
  target: { name: string; category: string; isCancellation: boolean; rules: unknown },
  blockers: string[],
): string | null {
  if (
    target.category === 'completed' &&
    !target.isCancellation &&
    row.blockersStopCompletion &&
    blockers.length > 0
  ) {
    return completionRefusalText(row.key, target.name, blockers);
  }
  const hasEstimate =
    (row.estimation === 'points' ? row.estimatePoints : row.estimateMinutes) !== null;
  for (const rule of target.rules as TransitionRule[]) {
    if (
      (rule === 'needs_assignee' && row.assigneeId === null) ||
      (rule === 'needs_estimate' && !hasEstimate) ||
      (rule === 'no_open_blockers' && blockers.length > 0)
    ) {
      return transitionRuleSentence(rule, target.name, blockers);
    }
  }
  return null;
}

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
  fieldValues: TicketFieldText[] = [],
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
    fieldValues,
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
  const [rows, labelMap, commentCounts, progress, blockers, criteria] = await together(executor, [
    () =>
      selectRows(
        executor,
        and(eq(tickets.organisationId, organisationId), inArray(tickets.id, ids)),
      ),
    () => labelsFor(executor, organisationId, ids),
    () => commentCountsFor(executor, organisationId, ids),
    () => progressOf(executor, ids),
    () => openBlockersOf(executor, organisationId, ids),
    () => criteriaCountsFor(executor, organisationId, ids),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  const fieldTexts = await fieldTextsFor(executor, organisationId, rows);
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row
      ? [
          toSummary(
            row,
            labelMap.get(id) ?? [],
            commentCounts.get(id) ?? 0,
            {
              progress: progress.get(id) ?? null,
              openBlockerKeys: blockers.get(id) ?? [],
              criteria: criteria.get(id) ?? NO_CRITERIA,
            },
            fieldTexts.get(id) ?? [],
          ),
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
  ] = await together(executor, [
    () => labelsFor(executor, organisationId, [row.id]),
    () => commentCountsFor(executor, organisationId, [row.id]),
    () => progressOf(executor, [row.id]),
    () => openBlockersOf(executor, organisationId, [row.id]),
    () => ancestorsOf(executor, row.id),
    () => childTreeOf(executor, row.id),
    () => loadLinks(executor, organisationId, row.id),
    () =>
      executor
        .select({
          id: projectStatuses.id,
          key: projectStatuses.key,
          name: projectStatuses.name,
          category: projectStatuses.category,
          isCancellation: projectStatuses.isCancellation,
          rules: statusTransitions.rules,
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
    () => loadCriteria(executor, row.id),
    () => loadAttachments(executor, row.id),
    () => mentionedInOf(executor, row.id),
  ]);
  const [watchers, triage, fields] = await together(executor, [
    () => watchersOf(executor, row.id),
    () => triageInfoOf(executor, row),
    () => ticketFieldsOf(executor, organisationId, row),
  ]);
  const references = await referencesOf(executor, organisationId, row, criteriaItems);
  const done = criteriaItems.filter((item) => item.done).length;

  return {
    ...toSummary(
      row,
      labelMap.get(row.id) ?? [],
      commentCounts.get(row.id) ?? 0,
      {
        progress: progress.get(row.id) ?? null,
        openBlockerKeys: blockers.get(row.id) ?? [],
        criteria: { done, total: criteriaItems.length },
      },
      textsOf(fields),
    ),
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
    startDate: row.startDate,
    estimateMinutes: row.estimateMinutes,
    estimatePoints: row.estimatePoints,
    estimation: row.estimation as TicketDetail['estimation'],
    milestone: row.milestoneId
      ? { id: row.milestoneId, name: row.milestoneName!, closed: row.milestoneClosedAt !== null }
      : null,
    cycle: row.cycleId
      ? {
          id: row.cycleId,
          name: row.cycleName!,
          state: row.cycleState as NonNullable<TicketDetail['cycle']>['state'],
        }
      : null,
    version: row.version,
    completedAt: iso(row.completedAt),
    archivedAt: iso(row.archivedAt),
    allowedTransitions: next.map(({ isCancellation, ...status }) => ({
      ...status,
      category: status.category as StatusCategory,
      rules: status.rules as TransitionRule[],
      refusal: moveRefusal(row, { ...status, isCancellation }, blockers.get(row.id) ?? []),
    })),
    ancestors,
    children,
    links,
    origin: row.origin as 'person' | 'scan',
    watchers,
    triage,
    fields,
  };
}
