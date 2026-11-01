import {
  addTicketEvent,
  components,
  createTicketRow,
  cycles,
  labels,
  milestones,
  organisationMemberships,
  priorities,
  projectStatuses,
  projects,
  statusTransitions,
  ticketCriteria,
  ticketLabels,
  ticketTypes,
  tickets,
  type Db,
  type Executor,
} from '@forge/db';
import {
  allowedMovesSentence,
  formatEstimate,
  formatPoints,
  hasPermission,
  normalizeProjectKey,
  TRANSITION_RULES,
  transitionRuleSentence,
  type CreateTicketBody,
  type TicketChange,
  type TicketDetail,
  type TransitionRule,
  type UpdateTicketBody,
} from '@forge/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { isForeignKeyViolation } from '../db-errors';
import { AppError } from '../errors';
import { completionRefusal, openBlockersOf } from './blockers';
import { writeComment } from './comment-write';
import { componentDefaultAssignee } from './component-assignee';
import { recordCycleMove } from './cycle-scope';
import { ticketCreated, ticketUpdated } from '../notifications/ticket-activity';
import { intakeNewTicket } from '../triage/service';
import { syncTicketMentions } from './content';
import { loadTicketDetail } from './read';

/** Who is acting and in which workspace. The organisation id always comes from `orgAccess`. */
export type TicketContext = {
  organisationId: string;
  actorUserId: string;
  permissions: readonly string[];
};

export type Issue = { path: string; message: string };

const notFound = () => new AppError('not_found', 'Not found.', 404);

/** Archived tickets are read-only: every change to one, or to its comments, answers with this. */
/** A ticket waiting in triage is decided there, by a proposal and a second person's approval. */
export const inTriageError = (key: string) =>
  new AppError(
    'conflict',
    `${key} is waiting in triage. Decide it there: one person proposes, another approves.`,
    409,
  );

export const archivedTicketError = () =>
  new AppError('conflict', 'This ticket is archived. Unarchive it to change it.', 409);

export const archivedProjectError = () =>
  new AppError('conflict', 'This project is archived. Unarchive it to change its tickets.', 409);

/** An archived project is frozen: none of its tickets, or anything on them, may change. */
export async function refuseIfProjectArchived(executor: Executor, ticketId: string) {
  const [row] = await executor
    .select({ archivedAt: projects.archivedAt })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .where(eq(tickets.id, ticketId));
  if (row?.archivedAt) throw archivedProjectError();
}

/** Whether the milestone exists and is still open. */
async function openMilestone(executor: Executor, milestoneId: string | null): Promise<boolean> {
  if (!milestoneId) return false;
  const [row] = await executor
    .select({ closedAt: milestones.closedAt })
    .from(milestones)
    .where(eq(milestones.id, milestoneId));
  return row !== undefined && row.closedAt === null;
}

/** A start date after the due date, as the ticket would have them. */
function dateOrderIssue(startDate: string | null, dueDate: string | null): Issue[] {
  return startDate !== null && dueDate !== null && startDate > dueDate
    ? [
        {
          path: 'startDate',
          message: `The start date must be on or before the due date (${dueDate}).`,
        },
      ]
    : [];
}

export function invalid(issues: Issue[]): AppError {
  return new AppError(
    'validation_failed',
    'Some of the values refer to things that are not available here.',
    422,
    issues,
  );
}

/**
 * Checks every id the client sent against this workspace (and project, where it matters), so the
 * person gets a clear message. The composite foreign keys would refuse the same ids anyway; this
 * is the friendly layer on top of that guarantee.
 */
export async function findReferenceIssues(
  tx: Executor,
  organisationId: string,
  projectId: string,
  fields: {
    typeId?: string;
    priorityId?: string;
    assigneeId?: string | null;
    componentId?: string | null;
    milestoneId?: string | null;
    cycleId?: string | null;
    labelIds?: string[];
  },
): Promise<Issue[]> {
  const issues: Issue[] = [];

  // Inactive types, priorities and components are refused here, so they cannot be chosen anew.
  // Callers pass only what changes, so a ticket that already has one keeps it.
  if (fields.typeId !== undefined) {
    const [row] = await tx
      .select({ name: ticketTypes.name, isActive: ticketTypes.isActive })
      .from(ticketTypes)
      .where(
        and(eq(ticketTypes.id, fields.typeId), eq(ticketTypes.organisationId, organisationId)),
      );
    if (!row) issues.push({ path: 'typeId', message: 'Unknown ticket type.' });
    else if (!row.isActive) {
      issues.push({
        path: 'typeId',
        message: `The ticket type ${row.name} is no longer in use. Choose another type.`,
      });
    }
  }

  if (fields.priorityId !== undefined) {
    const [row] = await tx
      .select({ name: priorities.name, isActive: priorities.isActive })
      .from(priorities)
      .where(
        and(eq(priorities.id, fields.priorityId), eq(priorities.organisationId, organisationId)),
      );
    if (!row) issues.push({ path: 'priorityId', message: 'Unknown priority.' });
    else if (!row.isActive) {
      issues.push({
        path: 'priorityId',
        message: `The priority ${row.name} is no longer in use. Choose another priority.`,
      });
    }
  }

  if (fields.assigneeId) {
    const [row] = await tx
      .select({ userId: organisationMemberships.userId })
      .from(organisationMemberships)
      .where(
        and(
          eq(organisationMemberships.organisationId, organisationId),
          eq(organisationMemberships.userId, fields.assigneeId),
        ),
      );
    if (!row) {
      issues.push({
        path: 'assigneeId',
        message: 'That person is not a member of this workspace.',
      });
    }
  }

  if (fields.componentId) {
    const [row] = await tx
      .select({ name: components.name, isActive: components.isActive })
      .from(components)
      .where(
        and(
          eq(components.id, fields.componentId),
          eq(components.organisationId, organisationId),
          eq(components.projectId, projectId),
        ),
      );
    if (!row) issues.push({ path: 'componentId', message: 'Unknown component for this project.' });
    else if (!row.isActive) {
      issues.push({
        path: 'componentId',
        message: `The component ${row.name} is no longer in use. Choose another component.`,
      });
    }
  }

  // A closed milestone keeps the tickets it has, but takes no new ones.
  if (fields.milestoneId) {
    const [row] = await tx
      .select({ name: milestones.name, closedAt: milestones.closedAt })
      .from(milestones)
      .where(
        and(
          eq(milestones.id, fields.milestoneId),
          eq(milestones.organisationId, organisationId),
          eq(milestones.projectId, projectId),
        ),
      );
    if (!row) issues.push({ path: 'milestoneId', message: 'Unknown milestone for this project.' });
    else if (row.closedAt) {
      issues.push({
        path: 'milestoneId',
        message: `The milestone ${row.name} is closed. Reopen it or choose another.`,
      });
    }
  }

  // Only a planned or active cycle of a project with cycles on takes tickets.
  if (fields.cycleId) {
    const [row] = await tx
      .select({ name: cycles.name, state: cycles.state, enabled: projects.cyclesEnabled })
      .from(cycles)
      .innerJoin(projects, eq(projects.id, cycles.projectId))
      .where(
        and(
          eq(cycles.id, fields.cycleId),
          eq(cycles.organisationId, organisationId),
          eq(cycles.projectId, projectId),
        ),
      );
    if (!row || !row.enabled) {
      issues.push({ path: 'cycleId', message: 'Unknown cycle for this project.' });
    } else if (row.state === 'completed') {
      issues.push({
        path: 'cycleId',
        message: `${row.name} is completed. Choose a planned or active cycle.`,
      });
    }
  }

  if (fields.labelIds && fields.labelIds.length > 0) {
    const unique = [...new Set(fields.labelIds)];
    const found = await tx
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.organisationId, organisationId), inArray(labels.id, unique)));
    if (found.length !== unique.length) {
      issues.push({ path: 'labelIds', message: 'Unknown label.' });
    }
  }

  return issues;
}

export async function createTicket(
  db: Db,
  input: { context: TicketContext; projectKey: string; body: CreateTicketBody },
): Promise<TicketDetail> {
  const { context, body } = input;
  const projectKey = normalizeProjectKey(input.projectKey);
  if (!projectKey) throw notFound();

  if (body.assigneeId && !hasPermission(context.permissions, 'tickets.assign')) {
    throw new AppError('forbidden', "You don't have permission to assign tickets.", 403);
  }

  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(projects)
        .where(
          and(eq(projects.organisationId, context.organisationId), eq(projects.key, projectKey)),
        );
      if (!project) throw notFound();
      if (project.archivedAt) {
        throw new AppError(
          'conflict',
          'This project is archived and cannot take new tickets.',
          409,
        );
      }

      const issues = await findReferenceIssues(tx, context.organisationId, project.id, body);
      issues.push(...dateOrderIssue(body.startDate ?? null, body.dueDate ?? null));
      if (body.statusId !== undefined) {
        // Editors may create in any active status (the workflow governs moves, not creation).
        // Anyone else starts where the workflow starts: choosing a later status, Quenched
        // included, would be a move they are not allowed to make.
        const [status] = await tx
          .select({ id: projectStatuses.id, isInitial: projectStatuses.isInitial })
          .from(projectStatuses)
          .where(
            and(
              eq(projectStatuses.id, body.statusId),
              eq(projectStatuses.organisationId, context.organisationId),
              eq(projectStatuses.projectId, project.id),
              eq(projectStatuses.isActive, true),
            ),
          );
        if (!status) issues.push({ path: 'statusId', message: 'Unknown status.' });
        else if (!status.isInitial && !hasPermission(context.permissions, 'tickets.edit')) {
          throw new AppError(
            'forbidden',
            "You can only create tickets in the project's first status.",
            403,
          );
        }
      }
      if (issues.length > 0) throw invalid(issues);

      // No assignee chosen: the component's default assignee takes it, whoever creates it (the
      // project's managers chose that person, not the creator).
      const assigneeId =
        body.assigneeId ??
        (body.componentId
          ? await componentDefaultAssignee(tx, context.organisationId, body.componentId)
          : null);

      const created = await createTicketRow(tx, {
        organisationId: context.organisationId,
        projectId: project.id,
        reporterId: context.actorUserId,
        title: body.title,
        description: body.description ?? '',
        goal: body.goal ?? '',
        criteria: body.criteria ?? [],
        typeId: body.typeId,
        priorityId: body.priorityId,
        statusId: body.statusId,
        assigneeId,
        componentId: body.componentId ?? null,
        dueDate: body.dueDate ?? null,
        startDate: body.startDate ?? null,
        estimateMinutes: body.estimateMinutes ?? null,
        estimatePoints: body.estimatePoints ?? null,
        milestoneId: body.milestoneId ?? null,
        cycleId: body.cycleId ?? null,
        labelIds: body.labelIds ?? [],
      });
      await syncTicketMentions(tx, context.organisationId, created.id);
      await recordCycleMove(tx, {
        organisationId: context.organisationId,
        ticketIds: [created.id],
        from: null,
        to: body.cycleId ?? null,
      });
      await ticketCreated(tx, {
        organisationId: context.organisationId,
        actorId: context.actorUserId,
        ticket: created,
        assigneeId,
        texts: [body.description ?? '', body.goal ?? '', ...(body.criteria ?? [])],
      });
      await intakeNewTicket(tx, { context, ticketId: created.id });

      const detail = await loadTicketDetail(tx, context.organisationId, created.key);
      if (!detail) throw new Error('A ticket that was just created could not be read back');
      return detail;
    });
  } catch (error) {
    // A reference that was valid a moment ago (a member removed in between) and was refused by
    // the database instead of by the check above.
    if (isForeignKeyViolation(error)) {
      throw invalid([{ path: 'body', message: 'One of the referenced items no longer exists.' }]);
    }
    throw error;
  }
}

/**
 * What a move along a transition still needs, one sentence per rule it breaks: "Moving to
 * Tempering needs an assignee." The assignee and estimate are as the edit leaves them, so one
 * request may assign and move at once. Triage acceptance and retiring a status skip this.
 */
export async function ruleRefusals(
  executor: Executor,
  input: {
    organisationId: string;
    ticketId: string;
    target: { name: string };
    rules: readonly TransitionRule[];
    assigneeId: string | null;
    /** Whether the ticket has an estimate in its project's system. */
    hasEstimate: boolean;
    comment: string | undefined;
  },
): Promise<string[]> {
  const messages: string[] = [];
  for (const rule of TRANSITION_RULES) {
    if (!input.rules.includes(rule)) continue;
    if (rule === 'needs_assignee' && input.assigneeId !== null) continue;
    if (rule === 'needs_estimate' && input.hasEstimate) continue;
    if (rule === 'needs_comment' && input.comment !== undefined) continue;
    if (rule === 'no_open_blockers') {
      const keys =
        (await openBlockersOf(executor, input.organisationId, [input.ticketId])).get(
          input.ticketId,
        ) ?? [];
      if (keys.length === 0) continue;
      messages.push(transitionRuleSentence(rule, input.target.name, keys));
      continue;
    }
    messages.push(transitionRuleSentence(rule, input.target.name));
  }
  return messages;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

export async function updateTicket(
  db: Db,
  input: { context: TicketContext; ticketKey: string; body: UpdateTicketBody },
): Promise<TicketDetail> {
  const { context, body, ticketKey } = input;

  try {
    return await db.transaction(async (tx) => {
      // Lock the row first. Everything below sees the ticket exactly as it is now, and a second
      // simultaneous edit waits here, then fails the version check.
      const [row] = await tx
        .select()
        .from(tickets)
        .where(and(eq(tickets.organisationId, context.organisationId), eq(tickets.key, ticketKey)))
        .for('update');
      if (!row) throw notFound();
      if (row.archivedAt) throw archivedTicketError();
      await refuseIfProjectArchived(tx, row.id);
      if (row.triageState && body.statusId !== undefined && body.statusId !== row.statusId) {
        throw inTriageError(row.key);
      }

      if (body.version !== row.version) {
        throw new AppError(
          'conflict',
          'This ticket was changed by someone else. Reload it to see the latest version.',
          409,
          [{ path: 'version', message: `The ticket is now at version ${row.version}.` }],
        );
      }

      const current = await loadTicketDetail(tx, context.organisationId, ticketKey);
      if (!current) throw notFound();

      // Work out what actually changes. Sending a value the ticket already has is not a change.
      const patch: Partial<typeof tickets.$inferInsert> = {};
      if (body.title !== undefined && body.title !== row.title) patch.title = body.title;
      if (body.description !== undefined && body.description !== row.description) {
        patch.description = body.description;
      }
      if (body.goal !== undefined && body.goal !== row.goal) patch.goal = body.goal;
      if (body.typeId !== undefined && body.typeId !== row.typeId) patch.typeId = body.typeId;
      if (body.priorityId !== undefined && body.priorityId !== row.priorityId) {
        patch.priorityId = body.priorityId;
      }
      if (body.assigneeId !== undefined && body.assigneeId !== row.assigneeId) {
        patch.assigneeId = body.assigneeId;
      }
      if (body.componentId !== undefined && body.componentId !== row.componentId) {
        patch.componentId = body.componentId;
      }
      if (body.dueDate !== undefined && body.dueDate !== row.dueDate) patch.dueDate = body.dueDate;
      if (body.startDate !== undefined && body.startDate !== row.startDate) {
        patch.startDate = body.startDate;
      }
      if (body.estimateMinutes !== undefined && body.estimateMinutes !== row.estimateMinutes) {
        patch.estimateMinutes = body.estimateMinutes;
      }
      if (body.estimatePoints !== undefined && body.estimatePoints !== row.estimatePoints) {
        patch.estimatePoints = body.estimatePoints;
      }
      if (body.milestoneId !== undefined && body.milestoneId !== row.milestoneId) {
        patch.milestoneId = body.milestoneId;
      }
      if (body.cycleId !== undefined && body.cycleId !== row.cycleId) {
        patch.cycleId = body.cycleId;
      }
      const statusChanged = body.statusId !== undefined && body.statusId !== row.statusId;
      const currentLabelIds = current.labels.map((label) => label.id);
      const labelsChanged =
        body.labelIds !== undefined && !sameSet([...new Set(body.labelIds)], currentLabelIds);

      // A comment only ever rides along with a move; it is never dropped silently.
      if (body.comment !== undefined && !statusChanged) {
        throw invalid([
          {
            path: 'comment',
            message: `${row.key} is already in ${current.status.name}, so there is no move for the comment to go with.`,
          },
        ]);
      }

      if (Object.keys(patch).length === 0 && !statusChanged && !labelsChanged) return current;

      if ('assigneeId' in patch && !hasPermission(context.permissions, 'tickets.assign')) {
        throw new AppError('forbidden', "You don't have permission to assign tickets.", 403);
      }
      if (body.comment !== undefined && !hasPermission(context.permissions, 'tickets.comment')) {
        throw new AppError('forbidden', "You don't have permission to comment on tickets.", 403);
      }

      const issues = await findReferenceIssues(tx, context.organisationId, row.projectId, {
        ...(patch.typeId !== undefined ? { typeId: patch.typeId } : {}),
        ...(patch.priorityId !== undefined ? { priorityId: patch.priorityId } : {}),
        ...('assigneeId' in patch ? { assigneeId: patch.assigneeId ?? null } : {}),
        ...('componentId' in patch ? { componentId: patch.componentId ?? null } : {}),
        ...('milestoneId' in patch ? { milestoneId: patch.milestoneId ?? null } : {}),
        ...('cycleId' in patch ? { cycleId: patch.cycleId ?? null } : {}),
        ...(labelsChanged ? { labelIds: body.labelIds ?? [] } : {}),
      });

      // An epic is always top level, so a ticket with a parent cannot become one.
      if (patch.typeId !== undefined && row.parentId) {
        const [type] = await tx
          .select({ key: ticketTypes.key })
          .from(ticketTypes)
          .where(eq(ticketTypes.id, patch.typeId));
        if (type?.key === 'epic') {
          issues.push({
            path: 'typeId',
            message: 'An epic is always top level; remove its parent first.',
          });
        }
      }

      let completedAt: Date | null | undefined;
      let statusBeforeJamId: string | null = null;
      if (statusChanged) {
        const [target] = await tx
          .select()
          .from(projectStatuses)
          .where(
            and(
              eq(projectStatuses.id, body.statusId!),
              eq(projectStatuses.organisationId, context.organisationId),
              eq(projectStatuses.projectId, row.projectId),
            ),
          );
        if (!target || !target.isActive) {
          issues.push({ path: 'statusId', message: 'Unknown status.' });
        } else {
          const [allowed] = await tx
            .select({ id: statusTransitions.id, rules: statusTransitions.rules })
            .from(statusTransitions)
            .where(
              and(
                eq(statusTransitions.projectId, row.projectId),
                eq(statusTransitions.fromStatusId, row.statusId),
                eq(statusTransitions.toStatusId, target.id),
              ),
            );
          if (!allowed) {
            issues.push({
              path: 'statusId',
              // Says where it can go, so the refusal teaches the workflow.
              message: `That move isn't allowed from ${current.status.name}. ${allowedMovesSentence(
                current.status.name,
                current.allowedTransitions.map((status) => status.name),
              )}`,
            });
          } else {
            const refusal = await completionRefusal(tx, {
              organisationId: context.organisationId,
              ticket: { id: row.id, key: row.key, projectId: row.projectId },
              target,
            });
            if (refusal) issues.push({ path: 'statusId', message: refusal });
            // The transition's own rules, judged on the ticket as this edit leaves it.
            for (const message of await ruleRefusals(tx, {
              organisationId: context.organisationId,
              ticketId: row.id,
              target,
              rules: allowed.rules as TransitionRule[],
              assigneeId: 'assigneeId' in patch ? (patch.assigneeId ?? null) : row.assigneeId,
              hasEstimate:
                current.estimation === 'points'
                  ? ('estimatePoints' in patch
                      ? (patch.estimatePoints ?? null)
                      : row.estimatePoints) !== null
                  : ('estimateMinutes' in patch
                      ? (patch.estimateMinutes ?? null)
                      : row.estimateMinutes) !== null,
              comment: body.comment,
            })) {
              issues.push({ path: 'statusId', message });
            }
          }
          completedAt = target.category === 'completed' ? new Date() : null;
          // Jammed remembers where the ticket was, so it can be put back there later.
          if (target.key === 'blocked') statusBeforeJamId = row.statusId;
        }
      }
      if ('startDate' in patch || 'dueDate' in patch) {
        issues.push(
          ...dateOrderIssue(
            'startDate' in patch ? (patch.startDate ?? null) : row.startDate,
            'dueDate' in patch ? (patch.dueDate ?? null) : row.dueDate,
          ),
        );
      }
      if (issues.length > 0) throw invalid(issues);

      const now = new Date();
      await tx
        .update(tickets)
        .set({
          ...patch,
          ...(statusChanged
            ? { statusId: body.statusId!, completedAt: completedAt ?? null, statusBeforeJamId }
            : {}),
          version: sql`${tickets.version} + 1`,
          updatedAt: now,
        })
        .where(eq(tickets.id, row.id));
      if (patch.description !== undefined || patch.goal !== undefined) {
        await syncTicketMentions(tx, context.organisationId, row.id);
      }

      if (labelsChanged) {
        const wanted = [...new Set(body.labelIds ?? [])];
        const removed = currentLabelIds.filter((id) => !wanted.includes(id));
        const added = wanted.filter((id) => !currentLabelIds.includes(id));
        if (removed.length > 0) {
          await tx
            .delete(ticketLabels)
            .where(and(eq(ticketLabels.ticketId, row.id), inArray(ticketLabels.labelId, removed)));
        }
        if (added.length > 0) {
          await tx.insert(ticketLabels).values(
            added.map((labelId) => ({
              organisationId: context.organisationId,
              ticketId: row.id,
              labelId,
            })),
          );
        }
      }

      const next = await loadTicketDetail(tx, context.organisationId, ticketKey);
      if (!next) throw new Error('A ticket that was just updated could not be read back');

      // The history, written from what really changed (names as they are right now).
      const changes: TicketChange[] = [];
      if (patch.title !== undefined) {
        changes.push({ field: 'title', from: current.title, to: next.title });
      }
      if (patch.description !== undefined) {
        changes.push({ field: 'description', from: null, to: null });
      }
      if (patch.goal !== undefined) {
        changes.push({ field: 'goal', from: null, to: null });
      }
      if (patch.typeId !== undefined) {
        changes.push({ field: 'type', from: current.type.name, to: next.type.name });
      }
      if (patch.priorityId !== undefined) {
        changes.push({ field: 'priority', from: current.priority.name, to: next.priority.name });
      }
      if ('assigneeId' in patch) {
        changes.push({
          field: 'assignee',
          from: current.assignee?.displayName ?? null,
          to: next.assignee?.displayName ?? null,
        });
      }
      if ('componentId' in patch) {
        changes.push({
          field: 'component',
          from: current.component?.name ?? null,
          to: next.component?.name ?? null,
        });
      }
      if ('dueDate' in patch) {
        changes.push({ field: 'dueDate', from: current.dueDate, to: next.dueDate });
      }
      if ('startDate' in patch) {
        changes.push({ field: 'startDate', from: current.startDate, to: next.startDate });
      }
      if ('estimateMinutes' in patch) {
        changes.push({
          field: 'estimate',
          from: formatEstimate(current.estimateMinutes),
          to: formatEstimate(next.estimateMinutes),
        });
      }
      if ('cycleId' in patch) {
        changes.push({
          field: 'cycle',
          from: current.cycle?.name ?? null,
          to: next.cycle?.name ?? null,
        });
        await recordCycleMove(tx, {
          organisationId: context.organisationId,
          ticketIds: [row.id],
          from: row.cycleId,
          to: patch.cycleId ?? null,
        });
      }
      if ('milestoneId' in patch) {
        changes.push({
          field: 'milestone',
          from: current.milestone?.name ?? null,
          to: next.milestone?.name ?? null,
        });
      }
      if ('estimatePoints' in patch) {
        changes.push({
          field: 'estimate',
          from: formatPoints(current.estimatePoints),
          to: formatPoints(next.estimatePoints),
        });
      }

      let tick = 0;
      const stamp = () => new Date(now.getTime() + tick++);
      const record = (event: Parameters<typeof addTicketEvent>[1]['event']) =>
        addTicketEvent(tx, {
          organisationId: context.organisationId,
          ticketId: row.id,
          actorUserId: context.actorUserId,
          event,
          createdAt: stamp(),
        });

      if (changes.length > 0) await record({ type: 'ticket.updated', data: { changes } });
      await ticketUpdated(tx, {
        organisationId: context.organisationId,
        actorId: context.actorUserId,
        ticket: { id: row.id, key: row.key },
        ...('assigneeId' in patch
          ? { assignee: { from: row.assigneeId, to: patch.assigneeId ?? null } }
          : {}),
        ...(statusChanged ? { status: { from: current.status.name, to: next.status.name } } : {}),
        ...(patch.description !== undefined || patch.goal !== undefined
          ? {
              texts: {
                before: [row.description, row.goal],
                after: [next.description, next.goal],
              },
            }
          : {}),
      });
      if (statusChanged) {
        await record({
          type: 'ticket.status_changed',
          data: {
            from: { id: current.status.id, name: current.status.name },
            to: { id: next.status.id, name: next.status.name },
          },
        });
        // The comment the move carried, written just after the move in the history.
        if (body.comment !== undefined) {
          await writeComment(tx, {
            organisationId: context.organisationId,
            actorUserId: context.actorUserId,
            ticket: { id: row.id, key: row.key },
            body: body.comment,
            createdAt: stamp(),
          });
        }
      }
      if (labelsChanged) {
        const before = new Set(current.labels.map((label) => label.name));
        const after = new Set(next.labels.map((label) => label.name));
        await record({
          type: 'labels.changed',
          data: {
            added: [...after].filter((name) => !before.has(name)),
            removed: [...before].filter((name) => !after.has(name)),
          },
        });
      }

      // Read again after a comment, so the answer counts it.
      if (body.comment !== undefined) {
        return (await loadTicketDetail(tx, context.organisationId, ticketKey)) ?? next;
      }
      return next;
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw invalid([{ path: 'body', message: 'One of the referenced items no longer exists.' }]);
    }
    throw error;
  }
}

/**
 * Archives or unarchives a ticket. Asking for the state it is already in changes nothing: no new
 * version, no history line.
 */
export async function setArchived(
  db: Db,
  input: { context: TicketContext; ticketKey: string; archived: boolean },
): Promise<TicketDetail> {
  const { context, ticketKey, archived } = input;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.organisationId, context.organisationId), eq(tickets.key, ticketKey)))
      .for('update');
    if (!row) throw notFound();
    await refuseIfProjectArchived(tx, row.id);
    if (row.triageState && archived) throw inTriageError(row.key);

    const now = new Date();
    if (archived !== (row.archivedAt !== null)) {
      await tx
        .update(tickets)
        .set({
          archivedAt: archived ? now : null,
          version: sql`${tickets.version} + 1`,
          updatedAt: now,
        })
        .where(eq(tickets.id, row.id));
      await addTicketEvent(tx, {
        organisationId: context.organisationId,
        ticketId: row.id,
        actorUserId: context.actorUserId,
        event: { type: archived ? 'ticket.archived' : 'ticket.unarchived', data: {} },
        createdAt: now,
      });
    }

    const detail = await loadTicketDetail(tx, context.organisationId, ticketKey);
    if (!detail) throw new Error('A ticket that was just updated could not be read back');
    return detail;
  });
}

const TITLE_LIMIT = 200;

/** "Copy of <title>" within the title limit, never ending in half of a surrogate pair. */
function copyTitle(title: string): string {
  const cut = `Copy of ${title}`.slice(0, TITLE_LIMIT);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Makes a new ticket in the same project from an existing one: the same fields and labels, the
 * project's initial status, the actor as reporter. Comments and history stay behind. The assignee
 * is copied only when the actor may assign.
 */
export async function duplicateTicket(
  db: Db,
  input: { context: TicketContext; ticketKey: string },
): Promise<TicketDetail> {
  const { context, ticketKey } = input;

  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.organisationId, context.organisationId), eq(tickets.key, ticketKey)));
    if (!source) throw notFound();

    const [project] = await tx
      .select({ archivedAt: projects.archivedAt })
      .from(projects)
      .where(
        and(eq(projects.organisationId, context.organisationId), eq(projects.id, source.projectId)),
      );
    if (project?.archivedAt) {
      throw new AppError('conflict', 'This project is archived and cannot take new tickets.', 409);
    }

    const sourceLabels = await tx
      .select({ labelId: ticketLabels.labelId })
      .from(ticketLabels)
      .where(
        and(
          eq(ticketLabels.organisationId, context.organisationId),
          eq(ticketLabels.ticketId, source.id),
        ),
      );

    const sourceCriteria = await tx
      .select({ text: ticketCriteria.text })
      .from(ticketCriteria)
      .where(eq(ticketCriteria.ticketId, source.id))
      .orderBy(asc(ticketCriteria.position), asc(ticketCriteria.id));

    const now = new Date();
    const created = await createTicketRow(tx, {
      organisationId: context.organisationId,
      projectId: source.projectId,
      reporterId: context.actorUserId,
      title: copyTitle(source.title),
      description: source.description,
      goal: source.goal,
      // The copy starts with the same criteria, none of them ticked.
      criteria: sourceCriteria.map((criterion) => criterion.text),
      typeId: source.typeId,
      priorityId: source.priorityId,
      assigneeId: hasPermission(context.permissions, 'tickets.assign') ? source.assigneeId : null,
      componentId: source.componentId,
      dueDate: source.dueDate,
      startDate: source.startDate,
      estimateMinutes: source.estimateMinutes,
      estimatePoints: source.estimatePoints,
      // A closed milestone takes no new tickets, copies included.
      milestoneId: (await openMilestone(tx, source.milestoneId)) ? source.milestoneId : null,
      labelIds: sourceLabels.map((label) => label.labelId),
      createdAt: now,
    });
    // A millisecond after "created", so the history reads in that order.
    await addTicketEvent(tx, {
      organisationId: context.organisationId,
      ticketId: created.id,
      actorUserId: context.actorUserId,
      event: { type: 'ticket.duplicated', data: { fromKey: source.key } },
      createdAt: new Date(now.getTime() + 1),
    });
    await syncTicketMentions(tx, context.organisationId, created.id);
    // A copy is a new ticket like any other: it is watched, and a reporter's copy waits in triage.
    await ticketCreated(tx, {
      organisationId: context.organisationId,
      actorId: context.actorUserId,
      ticket: created,
      assigneeId: hasPermission(context.permissions, 'tickets.assign') ? source.assigneeId : null,
      texts: [source.description, source.goal, ...sourceCriteria.map((c) => c.text)],
    });
    await intakeNewTicket(tx, { context, ticketId: created.id });

    const detail = await loadTicketDetail(tx, context.organisationId, created.key);
    if (!detail) throw new Error('A ticket that was just created could not be read back');
    return detail;
  });
}
