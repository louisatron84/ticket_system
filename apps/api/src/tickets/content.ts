import {
  projectStatuses,
  ticketAttachments,
  ticketComments,
  ticketCriteria,
  ticketMentions,
  tickets,
  users,
  type Executor,
} from '@forge/db';
import { referencedKeys, type Attachment, type Criterion, type TicketRef } from '@forge/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { toRef } from './structure-read';

// What a ticket says beyond its fields: acceptance criteria, attachments, and which tickets its
// text refers to.

const doneByUser = alias(users, 'done_by_user');

export async function criteriaCountsFor(
  executor: Executor,
  organisationId: string,
  ticketIds: string[],
): Promise<Map<string, { done: number; total: number }>> {
  if (ticketIds.length === 0) return new Map();
  const rows = await executor
    .select({
      ticketId: ticketCriteria.ticketId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(${ticketCriteria.doneAt})::int`,
    })
    .from(ticketCriteria)
    .where(
      and(
        eq(ticketCriteria.organisationId, organisationId),
        inArray(ticketCriteria.ticketId, ticketIds),
      ),
    )
    .groupBy(ticketCriteria.ticketId);
  return new Map(rows.map((row) => [row.ticketId, { done: row.done, total: row.total }]));
}

export async function loadCriteria(executor: Executor, ticketId: string): Promise<Criterion[]> {
  const rows = await executor
    .select({
      id: ticketCriteria.id,
      text: ticketCriteria.text,
      doneAt: ticketCriteria.doneAt,
      doneById: doneByUser.id,
      doneByEmail: doneByUser.email,
      doneByName: doneByUser.displayName,
    })
    .from(ticketCriteria)
    .leftJoin(doneByUser, eq(doneByUser.id, ticketCriteria.doneBy))
    .where(eq(ticketCriteria.ticketId, ticketId))
    .orderBy(asc(ticketCriteria.position), asc(ticketCriteria.id));
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    done: row.doneAt !== null,
    doneBy: row.doneById
      ? { id: row.doneById, email: row.doneByEmail!, displayName: row.doneByName! }
      : null,
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
  }));
}

export async function loadAttachments(executor: Executor, ticketId: string): Promise<Attachment[]> {
  const rows = await executor
    .select({
      id: ticketAttachments.id,
      fileName: ticketAttachments.fileName,
      contentType: ticketAttachments.contentType,
      sizeBytes: ticketAttachments.sizeBytes,
      createdAt: ticketAttachments.createdAt,
      uploaderId: users.id,
      uploaderEmail: users.email,
      uploaderName: users.displayName,
    })
    .from(ticketAttachments)
    .innerJoin(users, eq(users.id, ticketAttachments.uploaderId))
    .where(eq(ticketAttachments.ticketId, ticketId))
    .orderBy(asc(ticketAttachments.createdAt), asc(ticketAttachments.id));
  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploader: { id: row.uploaderId, email: row.uploaderEmail, displayName: row.uploaderName },
    createdAt: row.createdAt.toISOString(),
  }));
}

const refColumns = {
  key: tickets.key,
  title: tickets.title,
  archivedAt: tickets.archivedAt,
  statusKey: projectStatuses.key,
  statusName: projectStatuses.name,
  statusCategory: projectStatuses.category,
};

/** These keys' tickets in this workspace, ordered by key; keys that are not tickets here are absent. */
async function refsByKey(
  executor: Executor,
  organisationId: string,
  keys: string[],
): Promise<TicketRef[]> {
  if (keys.length === 0) return [];
  const rows = await executor
    .select(refColumns)
    .from(tickets)
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
    .where(and(eq(tickets.organisationId, organisationId), inArray(tickets.key, keys)))
    .orderBy(asc(tickets.key));
  return rows.map(toRef);
}

/** Tickets whose text refers to this one, each once. */
export async function mentionedInOf(executor: Executor, ticketId: string): Promise<TicketRef[]> {
  const rows = await executor
    .selectDistinct(refColumns)
    .from(ticketMentions)
    .innerJoin(tickets, eq(tickets.id, ticketMentions.sourceTicketId))
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
    .where(eq(ticketMentions.targetTicketId, ticketId))
    .orderBy(asc(tickets.key));
  return rows.map(toRef);
}

/** The tickets referred to anywhere in this ticket's text, comments included. */
export async function referencesOf(
  executor: Executor,
  organisationId: string,
  ticket: { id: string; description: string; goal: string },
  criteria: Criterion[],
): Promise<TicketRef[]> {
  const comments = await executor
    .select({ body: ticketComments.body })
    .from(ticketComments)
    .where(eq(ticketComments.ticketId, ticket.id));
  const keys = new Set<string>();
  for (const text of [
    ticket.description,
    ticket.goal,
    ...criteria.map((c) => c.text),
    ...comments.map((c) => c.body),
  ]) {
    for (const key of referencedKeys(text)) keys.add(key);
  }
  return refsByKey(executor, organisationId, [...keys]);
}

export type MentionSource = 'description' | 'goal' | 'criterion' | 'comment';

/**
 * Records which tickets one piece of text refers to, replacing what it referred to before. Keys
 * are looked up in this workspace only, so another workspace's ticket can never be linked to.
 */
export async function syncMentions(
  tx: Executor,
  input: {
    organisationId: string;
    sourceTicketId: string;
    kind: MentionSource;
    /** The ticket for a description or goal; the criterion or comment otherwise. */
    sourceId: string;
    text: string;
  },
): Promise<void> {
  await tx
    .delete(ticketMentions)
    .where(
      and(eq(ticketMentions.sourceKind, input.kind), eq(ticketMentions.sourceId, input.sourceId)),
    );
  const keys = referencedKeys(input.text);
  if (keys.length === 0) return;
  const targets = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.organisationId, input.organisationId), inArray(tickets.key, keys)));
  const rows = targets
    .filter((target) => target.id !== input.sourceTicketId)
    .map((target) => ({
      organisationId: input.organisationId,
      sourceTicketId: input.sourceTicketId,
      sourceKind: input.kind,
      sourceId: input.sourceId,
      targetTicketId: target.id,
    }));
  if (rows.length > 0) await tx.insert(ticketMentions).values(rows).onConflictDoNothing();
}

/** Re-records the references of a ticket's own text: its description, goal and every criterion. */
export async function syncTicketMentions(tx: Executor, organisationId: string, ticketId: string) {
  const [ticket] = await tx
    .select({ description: tickets.description, goal: tickets.goal })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  if (!ticket) return;
  const base = { organisationId, sourceTicketId: ticketId };
  await syncMentions(tx, {
    ...base,
    kind: 'description',
    sourceId: ticketId,
    text: ticket.description,
  });
  await syncMentions(tx, { ...base, kind: 'goal', sourceId: ticketId, text: ticket.goal });
  const criteria = await tx
    .select({ id: ticketCriteria.id, text: ticketCriteria.text })
    .from(ticketCriteria)
    .where(eq(ticketCriteria.ticketId, ticketId));
  for (const criterion of criteria) {
    await syncMentions(tx, {
      ...base,
      kind: 'criterion',
      sourceId: criterion.id,
      text: criterion.text,
    });
  }
}

/** Forgets what a removed piece of text referred to. */
export async function clearMentions(tx: Executor, kind: MentionSource, sourceId: string) {
  await tx
    .delete(ticketMentions)
    .where(and(eq(ticketMentions.sourceKind, kind), eq(ticketMentions.sourceId, sourceId)));
}
