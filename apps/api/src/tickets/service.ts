import {
  addTicketEvent,
  components,
  createTicketRow,
  labels,
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
  hasPermission,
  normalizeProjectKey,
  type CreateTicketBody,
  type TicketChange,
  type TicketDetail,
  type UpdateTicketBody,
} from '@forge/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { isForeignKeyViolation } from '../db-errors';
import { AppError } from '../errors';
import { completionRefusal } from './blockers';
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
    labelIds?: string[];
  },
): Promise<Issue[]> {
  const issues: Issue[] = [];

  if (fields.typeId !== undefined) {
    const [row] = await tx
      .select({ id: ticketTypes.id })
      .from(ticketTypes)
      .where(
        and(
          eq(ticketTypes.id, fields.typeId),
          eq(ticketTypes.organisationId, organisationId),
          eq(ticketTypes.isActive, true),
        ),
      );
    if (!row) issues.push({ path: 'typeId', message: 'Unknown ticket type.' });
  }

  if (fields.priorityId !== undefined) {
    const [row] = await tx
      .select({ id: priorities.id })
      .from(priorities)
      .where(
        and(
          eq(priorities.id, fields.priorityId),
          eq(priorities.organisationId, organisationId),
          eq(priorities.isActive, true),
        ),
      );
    if (!row) issues.push({ path: 'priorityId', message: 'Unknown priority.' });
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
      .select({ id: components.id })
      .from(components)
      .where(
        and(
          eq(components.id, fields.componentId),
          eq(components.organisationId, organisationId),
          eq(components.projectId, projectId),
        ),
      );
    if (!row) issues.push({ path: 'componentId', message: 'Unknown component for this project.' });
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
      if (body.statusId !== undefined) {
        // Any active status of this project may be chosen; the workflow governs moves, not creation.
        const [status] = await tx
          .select({ id: projectStatuses.id })
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
      }
      if (issues.length > 0) throw invalid(issues);

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
        assigneeId: body.assigneeId ?? null,
        componentId: body.componentId ?? null,
        dueDate: body.dueDate ?? null,
        estimateMinutes: body.estimateMinutes ?? null,
        labelIds: body.labelIds ?? [],
      });
      await syncTicketMentions(tx, context.organisationId, created.id);
      await ticketCreated(tx, {
        organisationId: context.organisationId,
        actorId: context.actorUserId,
        ticket: created,
        assigneeId: body.assigneeId ?? null,
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
      if (body.estimateMinutes !== undefined && body.estimateMinutes !== row.estimateMinutes) {
        patch.estimateMinutes = body.estimateMinutes;
      }
      const statusChanged = body.statusId !== undefined && body.statusId !== row.statusId;
      const currentLabelIds = current.labels.map((label) => label.id);
      const labelsChanged =
        body.labelIds !== undefined && !sameSet([...new Set(body.labelIds)], currentLabelIds);

      if (Object.keys(patch).length === 0 && !statusChanged && !labelsChanged) return current;

      if ('assigneeId' in patch && !hasPermission(context.permissions, 'tickets.assign')) {
        throw new AppError('forbidden', "You don't have permission to assign tickets.", 403);
      }

      const issues = await findReferenceIssues(tx, context.organisationId, row.projectId, {
        ...(patch.typeId !== undefined ? { typeId: patch.typeId } : {}),
        ...(patch.priorityId !== undefined ? { priorityId: patch.priorityId } : {}),
        ...('assigneeId' in patch ? { assigneeId: patch.assigneeId ?? null } : {}),
        ...('componentId' in patch ? { componentId: patch.componentId ?? null } : {}),
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
            .select({ id: statusTransitions.id })
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
          }
          completedAt = target.category === 'completed' ? new Date() : null;
          // Jammed remembers where the ticket was, so it can be put back there later.
          if (target.key === 'blocked') statusBeforeJamId = row.statusId;
        }
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
      if ('estimateMinutes' in patch) {
        changes.push({
          field: 'estimate',
          from: formatEstimate(current.estimateMinutes),
          to: formatEstimate(next.estimateMinutes),
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
      estimateMinutes: source.estimateMinutes,
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
