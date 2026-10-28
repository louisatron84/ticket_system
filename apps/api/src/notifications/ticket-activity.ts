import { users, type Executor } from '@forge/db';
import { mentionedUserIds } from '@forge/shared';
import { eq } from 'drizzle-orm';
import { autoWatch, notify, watcherIds, type NotificationDraft } from './service';

// What ticket activity tells whom. Called inside the transaction that made the change.

type Ticket = { id: string; key: string };

async function nameOf(tx: Executor, userId: string): Promise<string> {
  const [row] = await tx
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  return row?.name ?? 'Someone';
}

/** People mentioned in `after` who were not already mentioned in `before`. */
function newlyMentioned(before: string[], after: string[]): string[] {
  const old = new Set(before.flatMap(mentionedUserIds));
  return [...new Set(after.flatMap(mentionedUserIds))].filter((id) => !old.has(id));
}

export async function ticketCreated(
  tx: Executor,
  input: {
    organisationId: string;
    actorId: string;
    ticket: Ticket;
    assigneeId: string | null;
    texts: string[];
  },
): Promise<void> {
  const mentioned = newlyMentioned([], input.texts);
  await autoWatch(tx, input.organisationId, input.ticket.id, [
    input.actorId,
    input.assigneeId,
    ...mentioned,
  ]);
  const actor = await nameOf(tx, input.actorId);
  const drafts: NotificationDraft[] = mentioned.map((recipientId) => ({
    recipientId,
    kind: 'mentioned',
    ticketId: input.ticket.id,
    text: `${actor} mentioned you in ${input.ticket.key}`,
  }));
  if (input.assigneeId) {
    drafts.push({
      recipientId: input.assigneeId,
      kind: 'assigned',
      ticketId: input.ticket.id,
      text: `${actor} assigned ${input.ticket.key} to you`,
    });
  }
  await notify(tx, { organisationId: input.organisationId, actorId: input.actorId, drafts });
}

export async function ticketUpdated(
  tx: Executor,
  input: {
    organisationId: string;
    actorId: string;
    ticket: Ticket;
    assignee?: { from: string | null; to: string | null };
    status?: { from: string; to: string };
    texts?: { before: string[]; after: string[] };
  },
): Promise<void> {
  const mentioned = input.texts ? newlyMentioned(input.texts.before, input.texts.after) : [];
  const assignedTo = input.assignee?.to ?? null;
  await autoWatch(tx, input.organisationId, input.ticket.id, [assignedTo, ...mentioned]);

  const actor = await nameOf(tx, input.actorId);
  const drafts: NotificationDraft[] = [];
  if (assignedTo) {
    drafts.push({
      recipientId: assignedTo,
      kind: 'assigned',
      ticketId: input.ticket.id,
      text: `${actor} assigned ${input.ticket.key} to you`,
    });
  }
  for (const recipientId of mentioned) {
    drafts.push({
      recipientId,
      kind: 'mentioned',
      ticketId: input.ticket.id,
      text: `${actor} mentioned you in ${input.ticket.key}`,
    });
  }
  if (input.status) {
    for (const recipientId of await watcherIds(tx, input.ticket.id)) {
      drafts.push({
        recipientId,
        kind: 'moved',
        ticketId: input.ticket.id,
        text: `${actor} moved ${input.ticket.key} from ${input.status.from} to ${input.status.to}`,
      });
    }
  }
  await notify(tx, { organisationId: input.organisationId, actorId: input.actorId, drafts });
}

export async function commentWritten(
  tx: Executor,
  input: {
    organisationId: string;
    actorId: string;
    ticket: Ticket;
    body: string;
    /** The text before an edit; absent for a new comment. */
    previousBody?: string;
  },
): Promise<void> {
  const mentioned = newlyMentioned(input.previousBody === undefined ? [] : [input.previousBody], [
    input.body,
  ]);
  const isNew = input.previousBody === undefined;
  await autoWatch(tx, input.organisationId, input.ticket.id, [
    ...(isNew ? [input.actorId] : []),
    ...mentioned,
  ]);
  const actor = await nameOf(tx, input.actorId);
  const drafts: NotificationDraft[] = mentioned.map((recipientId) => ({
    recipientId,
    kind: 'mentioned',
    ticketId: input.ticket.id,
    text: `${actor} mentioned you in a comment on ${input.ticket.key}`,
  }));
  // Watchers hear about new comments, not edits.
  if (isNew) {
    for (const recipientId of await watcherIds(tx, input.ticket.id)) {
      drafts.push({
        recipientId,
        kind: 'commented',
        ticketId: input.ticket.id,
        text: `${actor} commented on ${input.ticket.key}`,
      });
    }
  }
  await notify(tx, { organisationId: input.organisationId, actorId: input.actorId, drafts });
}
