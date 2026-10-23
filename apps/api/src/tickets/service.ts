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
  ticketLabels,
  ticketTypes,
  tickets,
  type Db,
  type Executor,
} from '@forge/db';
import {
  formatEstimate,
  hasPermission,
  normalizeProjectKey,
  type CreateTicketBody,
  type TicketChange,
  type TicketDetail,
  type UpdateTicketBody,
} from '@forge/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { isForeignKeyViolation } from '../db-errors';
import { AppError } from '../errors';
import { loadTicketDetail } from './read';

/** Who is acting and in which workspace. The organisation id always comes from `orgAccess`. */
export type TicketContext = {
  organisationId: string;
  actorUserId: string;
  permissions: readonly string[];
};

type Issue = { path: string; message: string };

const notFound = () => new AppError('not_found', 'Not found.', 404);

function invalid(issues: Issue[]): AppError {
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
async function findReferenceIssues(
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
      if (issues.length > 0) throw invalid(issues);

      const created = await createTicketRow(tx, {
        organisationId: context.organisationId,
        projectId: project.id,
        reporterId: context.actorUserId,
        title: body.title,
        description: body.description ?? '',
        typeId: body.typeId,
        priorityId: body.priorityId,
        assigneeId: body.assigneeId ?? null,
        componentId: body.componentId ?? null,
        dueDate: body.dueDate ?? null,
        estimateMinutes: body.estimateMinutes ?? null,
        labelIds: body.labelIds ?? [],
      });

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

      let completedAt: Date | null | undefined;
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
              message: `That move isn't allowed from ${current.status.name}.`,
            });
          }
          completedAt = target.category === 'completed' ? new Date() : null;
        }
      }
      if (issues.length > 0) throw invalid(issues);

      const now = new Date();
      await tx
        .update(tickets)
        .set({
          ...patch,
          ...(statusChanged ? { statusId: body.statusId!, completedAt: completedAt ?? null } : {}),
          version: sql`${tickets.version} + 1`,
          updatedAt: now,
        })
        .where(eq(tickets.id, row.id));

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
