import { addTicketEvent, ticketComments, type Executor } from '@forge/db';
import { commentWritten } from '../notifications/ticket-activity';
import { syncMentions } from './content';

/**
 * Writes a new comment inside the caller's transaction: the row, its history event, its mentions
 * and the notifications. The caller has already checked the ticket may take it (not archived, its
 * project not archived). Returns the new comment's id.
 */
export async function writeComment(
  tx: Executor,
  input: {
    organisationId: string;
    actorUserId: string;
    ticket: { id: string; key: string };
    body: string;
    createdAt?: Date;
  },
): Promise<string> {
  const { organisationId, actorUserId, ticket, body } = input;
  const [created] = await tx
    .insert(ticketComments)
    .values({
      organisationId,
      ticketId: ticket.id,
      authorId: actorUserId,
      body,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning({ id: ticketComments.id });
  await addTicketEvent(tx, {
    organisationId,
    ticketId: ticket.id,
    actorUserId,
    event: { type: 'comment.added', data: { commentId: created!.id } },
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
  await syncMentions(tx, {
    organisationId,
    sourceTicketId: ticket.id,
    kind: 'comment',
    sourceId: created!.id,
    text: body,
  });
  await commentWritten(tx, { organisationId, actorId: actorUserId, ticket, body });
  return created!.id;
}
