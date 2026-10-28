import { formatTicketKey, type TicketEvent } from '@forge/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from './organisations';
import {
  projectStatuses,
  projects,
  ticketCriteria,
  ticketEvents,
  ticketLabels,
  tickets,
} from './schema';

/** Appends a line to a ticket's history. Rows are only ever added, never changed. */
export async function addTicketEvent(
  executor: Executor,
  input: {
    organisationId: string;
    ticketId: string;
    actorUserId?: string | null;
    source?: 'user' | 'system';
    event: TicketEvent;
    createdAt?: Date;
  },
): Promise<void> {
  await executor.insert(ticketEvents).values({
    organisationId: input.organisationId,
    ticketId: input.ticketId,
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? 'user',
    type: input.event.type,
    data: input.event.data,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
}

export type NewTicketRow = {
  organisationId: string;
  projectId: string;
  reporterId: string;
  title: string;
  description?: string;
  goal?: string;
  /** Acceptance criteria, in order, all open. */
  criteria?: string[];
  typeId: string;
  priorityId: string;
  /** Defaults to the project's initial status. */
  statusId?: string;
  assigneeId?: string | null;
  componentId?: string | null;
  dueDate?: string | null;
  estimateMinutes?: number | null;
  labelIds?: string[];
  /** For back-dating demo data. */
  createdAt?: Date;
};

/**
 * Inserts a ticket: claims the next number from the project's counter, builds the key, applies
 * labels and writes the `ticket.created` event. Run it inside a transaction. The counter update
 * takes a row lock on the project, so two tickets created at once always get different numbers.
 *
 * It does not check that the ids belong together; the composite foreign keys do that, and the API
 * explains the problem to the person before it gets that far.
 */
export async function createTicketRow(
  executor: Executor,
  input: NewTicketRow,
): Promise<{ id: string; key: string; number: number }> {
  const [project] = await executor
    .update(projects)
    .set({ nextTicketNumber: sql`${projects.nextTicketNumber} + 1` })
    .where(and(eq(projects.id, input.projectId), eq(projects.organisationId, input.organisationId)))
    .returning({ key: projects.key, claimed: sql<number>`${projects.nextTicketNumber} - 1` });
  if (!project) throw new Error('Cannot create a ticket: project not found in this workspace');

  const [status] = input.statusId
    ? await executor
        .select({ id: projectStatuses.id, category: projectStatuses.category })
        .from(projectStatuses)
        .where(eq(projectStatuses.id, input.statusId))
    : await executor
        .select({ id: projectStatuses.id, category: projectStatuses.category })
        .from(projectStatuses)
        .where(
          and(eq(projectStatuses.projectId, input.projectId), eq(projectStatuses.isInitial, true)),
        );
  if (!status) throw new Error('Cannot create a ticket: no such status');

  const createdAt = input.createdAt ?? new Date();
  const [ticket] = await executor
    .insert(tickets)
    .values({
      organisationId: input.organisationId,
      projectId: input.projectId,
      number: project.claimed,
      key: formatTicketKey(project.key, project.claimed),
      title: input.title,
      description: input.description ?? '',
      goal: input.goal ?? '',
      typeId: input.typeId,
      statusId: status.id,
      priorityId: input.priorityId,
      assigneeId: input.assigneeId ?? null,
      reporterId: input.reporterId,
      componentId: input.componentId ?? null,
      dueDate: input.dueDate ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      completedAt: status.category === 'completed' ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
    })
    .returning({ id: tickets.id, key: tickets.key, number: tickets.number });
  if (!ticket) throw new Error('Ticket insert returned no row');

  const labelIds = [...new Set(input.labelIds ?? [])];
  if (labelIds.length > 0) {
    await executor.insert(ticketLabels).values(
      labelIds.map((labelId) => ({
        organisationId: input.organisationId,
        ticketId: ticket.id,
        labelId,
      })),
    );
  }

  const criteria = input.criteria ?? [];
  if (criteria.length > 0) {
    await executor.insert(ticketCriteria).values(
      criteria.map((text, position) => ({
        organisationId: input.organisationId,
        ticketId: ticket.id,
        position,
        text,
      })),
    );
  }

  await addTicketEvent(executor, {
    organisationId: input.organisationId,
    ticketId: ticket.id,
    actorUserId: input.reporterId,
    event: { type: 'ticket.created', data: { title: input.title } },
    createdAt,
  });

  return ticket;
}
