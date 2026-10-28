import { addTicketEvent, ticketCriteria, tickets, type Db, type Executor } from '@forge/db';
import {
  MAX_CRITERIA,
  type Criterion,
  type TicketEvent,
  type UpdateCriterionBody,
} from '@forge/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AppError } from '../errors';
import { clearMentions, loadCriteria, syncMentions } from './content';
import { archivedTicketError, type TicketContext } from './service';

// Acceptance criteria. They are rows of their own, outside the ticket's version, so ticking one
// while someone edits the description never makes either a conflict. Each write locks the ticket
// row, so the criteria of one ticket change one at a time.

const notFound = () => new AppError('not_found', 'Not found.', 404);

async function lockTicket(tx: Executor, organisationId: string, ticketKey: string) {
  const [ticket] = await tx
    .select({ id: tickets.id, archivedAt: tickets.archivedAt })
    .from(tickets)
    .where(and(eq(tickets.organisationId, organisationId), eq(tickets.key, ticketKey)))
    .for('update');
  if (!ticket) throw notFound();
  if (ticket.archivedAt) throw archivedTicketError();
  return ticket.id;
}

async function criterionOf(tx: Executor, ticketId: string, criterionId: string) {
  const [row] = await tx
    .select()
    .from(ticketCriteria)
    .where(and(eq(ticketCriteria.ticketId, ticketId), eq(ticketCriteria.id, criterionId)));
  if (!row) throw notFound();
  return row;
}

function recorder(tx: Executor, context: TicketContext, ticketId: string) {
  return (event: TicketEvent) =>
    addTicketEvent(tx, {
      organisationId: context.organisationId,
      ticketId,
      actorUserId: context.actorUserId,
      event,
    });
}

export async function addCriterion(
  db: Db,
  input: { context: TicketContext; ticketKey: string; text: string },
): Promise<Criterion[]> {
  const { context } = input;
  return db.transaction(async (tx) => {
    const ticketId = await lockTicket(tx, context.organisationId, input.ticketKey);
    const [{ count, last }] = (await tx
      .select({
        count: sql<number>`count(*)::int`,
        last: sql<number>`coalesce(max(${ticketCriteria.position}), -1)::int`,
      })
      .from(ticketCriteria)
      .where(eq(ticketCriteria.ticketId, ticketId))) as [{ count: number; last: number }];
    if (count >= MAX_CRITERIA) {
      const message = `A ticket can have at most ${MAX_CRITERIA} acceptance criteria.`;
      throw new AppError('validation_failed', message, 422, [{ path: 'text', message }]);
    }
    const [created] = await tx
      .insert(ticketCriteria)
      .values({
        organisationId: context.organisationId,
        ticketId,
        position: last + 1,
        text: input.text,
      })
      .returning({ id: ticketCriteria.id });
    await syncMentions(tx, {
      organisationId: context.organisationId,
      sourceTicketId: ticketId,
      kind: 'criterion',
      sourceId: created!.id,
      text: input.text,
    });
    await recorder(tx, context, ticketId)({ type: 'criterion.added', data: { text: input.text } });
    return loadCriteria(tx, ticketId);
  });
}

/** Changes a criterion's wording, ticks it or unticks it. Sending what it already is changes nothing. */
export async function updateCriterion(
  db: Db,
  input: {
    context: TicketContext;
    ticketKey: string;
    criterionId: string;
    body: UpdateCriterionBody;
  },
): Promise<Criterion[]> {
  const { context, body } = input;
  return db.transaction(async (tx) => {
    const ticketId = await lockTicket(tx, context.organisationId, input.ticketKey);
    const current = await criterionOf(tx, ticketId, input.criterionId);
    const record = recorder(tx, context, ticketId);

    const textChanged = body.text !== undefined && body.text !== current.text;
    const doneChanged = body.done !== undefined && body.done !== (current.doneAt !== null);
    if (textChanged) {
      await tx
        .update(ticketCriteria)
        .set({ text: body.text! })
        .where(eq(ticketCriteria.id, current.id));
      await syncMentions(tx, {
        organisationId: context.organisationId,
        sourceTicketId: ticketId,
        kind: 'criterion',
        sourceId: current.id,
        text: body.text!,
      });
      await record({ type: 'criterion.edited', data: { from: current.text, to: body.text! } });
    }
    if (doneChanged) {
      await tx
        .update(ticketCriteria)
        .set(
          body.done
            ? { doneAt: new Date(), doneBy: context.actorUserId }
            : { doneAt: null, doneBy: null },
        )
        .where(eq(ticketCriteria.id, current.id));
      const text = body.text ?? current.text;
      await record(
        body.done
          ? { type: 'criterion.ticked', data: { text } }
          : { type: 'criterion.unticked', data: { text } },
      );
    }
    return loadCriteria(tx, ticketId);
  });
}

/** Puts every criterion in the order given. The list must name each of them exactly once. */
export async function reorderCriteria(
  db: Db,
  input: { context: TicketContext; ticketKey: string; ids: string[] },
): Promise<Criterion[]> {
  const { context } = input;
  return db.transaction(async (tx) => {
    const ticketId = await lockTicket(tx, context.organisationId, input.ticketKey);
    const current = await tx
      .select({ id: ticketCriteria.id })
      .from(ticketCriteria)
      .where(eq(ticketCriteria.ticketId, ticketId))
      .orderBy(asc(ticketCriteria.position), asc(ticketCriteria.id));
    const known = new Set(current.map((row) => row.id));
    if (input.ids.length !== known.size || input.ids.some((id) => !known.has(id))) {
      const message = 'The criteria changed since this page was loaded. Reload and try again.';
      throw new AppError('conflict', message, 409);
    }
    const unchanged = current.every((row, index) => row.id === input.ids[index]);
    if (unchanged) return loadCriteria(tx, ticketId);

    for (const [position, id] of input.ids.entries()) {
      await tx.update(ticketCriteria).set({ position }).where(eq(ticketCriteria.id, id));
    }
    await recorder(tx, context, ticketId)({ type: 'criteria.reordered', data: {} });
    return loadCriteria(tx, ticketId);
  });
}

export async function removeCriterion(
  db: Db,
  input: { context: TicketContext; ticketKey: string; criterionId: string },
): Promise<Criterion[]> {
  const { context } = input;
  return db.transaction(async (tx) => {
    const ticketId = await lockTicket(tx, context.organisationId, input.ticketKey);
    const current = await criterionOf(tx, ticketId, input.criterionId);
    await clearMentions(tx, 'criterion', current.id);
    await tx.delete(ticketCriteria).where(eq(ticketCriteria.id, current.id));
    await recorder(
      tx,
      context,
      ticketId,
    )({
      type: 'criterion.removed',
      data: { text: current.text },
    });
    return loadCriteria(tx, ticketId);
  });
}
