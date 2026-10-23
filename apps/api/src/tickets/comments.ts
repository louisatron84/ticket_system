import {
  addTicketEvent,
  ticketComments,
  ticketEvents,
  tickets,
  users,
  type Executor,
  type Db,
} from '@forge/db';
import { hasPermission, ticketEventSchema, type Comment, type TimelineItem } from '@forge/shared';
import { and, asc, eq, notInArray } from 'drizzle-orm';
import { AppError } from '../errors';
import type { TicketContext } from './service';

const notFound = () => new AppError('not_found', 'Not found.', 404);

/** The ticket's id, or a 404 when this workspace has no ticket with that key. */
async function ticketIdOf(
  executor: Executor,
  organisationId: string,
  ticketKey: string,
): Promise<string> {
  const [ticket] = await executor
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.organisationId, organisationId), eq(tickets.key, ticketKey)));
  if (!ticket) throw notFound();
  return ticket.id;
}

const commentColumns = {
  id: ticketComments.id,
  body: ticketComments.body,
  createdAt: ticketComments.createdAt,
  editedAt: ticketComments.editedAt,
  authorId: users.id,
  authorEmail: users.email,
  authorName: users.displayName,
};
type CommentRow = {
  id: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  authorId: string;
  authorEmail: string;
  authorName: string;
};

const toComment = (row: CommentRow): Comment => ({
  id: row.id,
  author: { id: row.authorId, email: row.authorEmail, displayName: row.authorName },
  body: row.body,
  createdAt: row.createdAt.toISOString(),
  editedAt: row.editedAt ? row.editedAt.toISOString() : null,
});

/** One comment of this ticket, or a 404: a comment id is only ever valid under its own ticket. */
async function loadComment(
  executor: Executor,
  organisationId: string,
  ticketId: string,
  commentId: string,
  lock = false,
): Promise<CommentRow> {
  const query = executor
    .select(commentColumns)
    .from(ticketComments)
    .innerJoin(users, eq(users.id, ticketComments.authorId))
    .where(
      and(
        eq(ticketComments.organisationId, organisationId),
        eq(ticketComments.ticketId, ticketId),
        eq(ticketComments.id, commentId),
      ),
    );
  // Locks the comment row only: the join to the author is read-only here.
  const [row] = lock ? await query.for('update', { of: ticketComments }) : await query;
  if (!row) throw notFound();
  return row;
}

export async function addComment(
  db: Db,
  input: { context: TicketContext; ticketKey: string; body: string },
): Promise<Comment> {
  const { context } = input;
  return db.transaction(async (tx) => {
    const ticketId = await ticketIdOf(tx, context.organisationId, input.ticketKey);
    const [created] = await tx
      .insert(ticketComments)
      .values({
        organisationId: context.organisationId,
        ticketId,
        authorId: context.actorUserId,
        body: input.body,
      })
      .returning({ id: ticketComments.id });
    await addTicketEvent(tx, {
      organisationId: context.organisationId,
      ticketId,
      actorUserId: context.actorUserId,
      event: { type: 'comment.added', data: { commentId: created!.id } },
    });
    return toComment(await loadComment(tx, context.organisationId, ticketId, created!.id));
  });
}

export async function editComment(
  db: Db,
  input: { context: TicketContext; ticketKey: string; commentId: string; body: string },
): Promise<Comment> {
  const { context } = input;
  return db.transaction(async (tx) => {
    const ticketId = await ticketIdOf(tx, context.organisationId, input.ticketKey);
    const current = await loadComment(tx, context.organisationId, ticketId, input.commentId, true);

    // Only the author edits their own words, whatever else their role allows.
    if (current.authorId !== context.actorUserId) {
      throw new AppError('forbidden', 'You can only edit your own comments.', 403);
    }
    // Saving the same text is not an edit: nothing to mark, nothing to record.
    if (current.body === input.body) return toComment(current);

    await tx
      .update(ticketComments)
      .set({ body: input.body, editedAt: new Date() })
      .where(eq(ticketComments.id, current.id));
    await addTicketEvent(tx, {
      organisationId: context.organisationId,
      ticketId,
      actorUserId: context.actorUserId,
      event: { type: 'comment.edited', data: { commentId: current.id } },
    });
    return toComment(await loadComment(tx, context.organisationId, ticketId, current.id));
  });
}

export async function deleteComment(
  db: Db,
  input: { context: TicketContext; ticketKey: string; commentId: string },
): Promise<void> {
  const { context } = input;
  await db.transaction(async (tx) => {
    const ticketId = await ticketIdOf(tx, context.organisationId, input.ticketKey);
    const current = await loadComment(tx, context.organisationId, ticketId, input.commentId, true);

    const mayDelete =
      current.authorId === context.actorUserId ||
      hasPermission(context.permissions, 'tickets.edit');
    if (!mayDelete) {
      throw new AppError('forbidden', 'You can only delete your own comments.', 403);
    }

    await tx.delete(ticketComments).where(eq(ticketComments.id, current.id));
    await addTicketEvent(tx, {
      organisationId: context.organisationId,
      ticketId,
      actorUserId: context.actorUserId,
      event: { type: 'comment.deleted', data: { commentId: current.id } },
    });
  });
}

// Comments appear as comments. Their "added" and "edited" events would only repeat them, so the
// history keeps just the one thing a comment cannot show for itself: that it was deleted.
const SHOWN_AS_COMMENTS = ['comment.added', 'comment.edited'];

/** Comments and system events of one ticket in one list, oldest first. */
export async function loadTimeline(
  executor: Executor,
  organisationId: string,
  ticketKey: string,
): Promise<TimelineItem[]> {
  const ticketId = await ticketIdOf(executor, organisationId, ticketKey);

  const [commentRows, eventRows] = await Promise.all([
    executor
      .select(commentColumns)
      .from(ticketComments)
      .innerJoin(users, eq(users.id, ticketComments.authorId))
      .where(
        and(
          eq(ticketComments.organisationId, organisationId),
          eq(ticketComments.ticketId, ticketId),
        ),
      )
      .orderBy(asc(ticketComments.createdAt), asc(ticketComments.id)),
    executor
      .select({
        id: ticketEvents.id,
        type: ticketEvents.type,
        data: ticketEvents.data,
        createdAt: ticketEvents.createdAt,
        actorId: users.id,
        actorName: users.displayName,
      })
      .from(ticketEvents)
      .leftJoin(users, eq(users.id, ticketEvents.actorUserId))
      .where(
        and(
          eq(ticketEvents.organisationId, organisationId),
          eq(ticketEvents.ticketId, ticketId),
          notInArray(ticketEvents.type, SHOWN_AS_COMMENTS),
        ),
      )
      .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id)),
  ]);

  const items: (TimelineItem & { sortId: string })[] = [
    ...commentRows.map((row) => ({
      kind: 'comment' as const,
      createdAt: row.createdAt.toISOString(),
      comment: toComment(row),
      sortId: row.id,
    })),
    ...eventRows.map((row) => ({
      kind: 'event' as const,
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actor: row.actorId ? { id: row.actorId, displayName: row.actorName! } : null,
      // The history is only ever written by this code, so a row that no longer fits its schema is
      // a defect worth failing loudly for, not something to hide from the person reading.
      event: ticketEventSchema.parse({ type: row.type, data: row.data }),
      sortId: row.id,
    })),
  ];

  // Ids are time-ordered, so they settle ties between rows written in the same instant.
  items.sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.sortId.localeCompare(b.sortId),
  );
  return items.map(({ sortId: _sortId, ...item }) => item as TimelineItem);
}
