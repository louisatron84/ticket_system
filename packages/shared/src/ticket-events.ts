import { z } from 'zod';
import { commentSchema } from './tickets';

const nameRef = z.object({ id: z.string(), name: z.string() });

export const TICKET_CHANGE_FIELDS = [
  'title',
  'description',
  'goal',
  'type',
  'priority',
  'assignee',
  'component',
  'dueDate',
  'estimate',
] as const;

const changeSchema = z.object({
  field: z.enum(TICKET_CHANGE_FIELDS),
  // Display values captured when the change happened, so history reads correctly even after
  // something is renamed or removed. A description change records no text, only that it changed.
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type TicketChange = z.infer<typeof changeSchema>;

export const ticketEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ticket.created'), data: z.object({ title: z.string() }) }),
  z.object({
    type: z.literal('ticket.updated'),
    data: z.object({ changes: z.array(changeSchema).min(1) }),
  }),
  z.object({
    type: z.literal('ticket.status_changed'),
    data: z.object({ from: nameRef, to: nameRef }),
  }),
  z.object({ type: z.literal('comment.added'), data: z.object({ commentId: z.string() }) }),
  z.object({ type: z.literal('comment.edited'), data: z.object({ commentId: z.string() }) }),
  z.object({ type: z.literal('comment.deleted'), data: z.object({ commentId: z.string() }) }),
  z.object({
    type: z.literal('labels.changed'),
    data: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }),
  }),
  z.object({ type: z.literal('ticket.archived'), data: z.object({}) }),
  z.object({ type: z.literal('ticket.unarchived'), data: z.object({}) }),
  // Written on the copy; `fromKey` is the key of the ticket it was copied from.
  z.object({ type: z.literal('ticket.duplicated'), data: z.object({ fromKey: z.string() }) }),
  // Written on the child; the parent gets `ticket.child_added` / `ticket.child_removed`.
  z.object({
    type: z.literal('ticket.parent_set'),
    data: z.object({ parentKey: z.string().nullable(), previousKey: z.string().nullable() }),
  }),
  z.object({ type: z.literal('ticket.child_added'), data: z.object({ childKey: z.string() }) }),
  z.object({ type: z.literal('ticket.child_removed'), data: z.object({ childKey: z.string() }) }),
  // Written on both tickets, each with the label as seen from that ticket ("Blocked by").
  z.object({
    type: z.literal('link.added'),
    data: z.object({ label: z.string(), otherKey: z.string() }),
  }),
  z.object({
    type: z.literal('link.removed'),
    data: z.object({ label: z.string(), otherKey: z.string() }),
  }),
  z.object({
    type: z.literal('ticket.marked_duplicate'),
    data: z.object({ originalKey: z.string() }),
  }),
  // Acceptance criteria. The text is captured so the history reads right after later edits.
  z.object({ type: z.literal('criterion.added'), data: z.object({ text: z.string() }) }),
  z.object({
    type: z.literal('criterion.edited'),
    data: z.object({ from: z.string(), to: z.string() }),
  }),
  z.object({ type: z.literal('criterion.ticked'), data: z.object({ text: z.string() }) }),
  z.object({ type: z.literal('criterion.unticked'), data: z.object({ text: z.string() }) }),
  z.object({ type: z.literal('criterion.removed'), data: z.object({ text: z.string() }) }),
  z.object({ type: z.literal('criteria.reordered'), data: z.object({}) }),
  z.object({ type: z.literal('attachment.added'), data: z.object({ fileName: z.string() }) }),
  z.object({ type: z.literal('attachment.removed'), data: z.object({ fileName: z.string() }) }),
]);
export type TicketEvent = z.infer<typeof ticketEventSchema>;

const FIELD_LABEL: Record<'type' | 'priority' | 'component' | 'estimate', string> = {
  type: 'type',
  priority: 'priority',
  component: 'component',
  estimate: 'estimate',
};

function describeChange({ field, from, to }: TicketChange): string {
  switch (field) {
    case 'title':
      return `changed the title from "${from}" to "${to}"`;
    case 'description':
      return 'edited the description';
    case 'goal':
      return 'edited the goal';
    case 'assignee':
      if (!from && to) return `assigned this to ${to}`;
      if (from && !to) return `unassigned ${from}`;
      return `reassigned this from ${from} to ${to}`;
    case 'dueDate':
      if (!from && to) return `set the due date to ${to}`;
      if (from && !to) return 'removed the due date';
      return `changed the due date from ${from} to ${to}`;
    default: {
      const label = FIELD_LABEL[field];
      if (!from) return `set the ${label} to ${to}`;
      if (!to) return `removed the ${label}`;
      return `changed the ${label} from ${from} to ${to}`;
    }
  }
}

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function describeLabels(added: string[], removed: string[]): string {
  const part = (verb: string, names: string[]) =>
    `${verb} the label${names.length === 1 ? '' : 's'} ${joinNames(names)}`;
  const parts = [];
  if (added.length > 0) parts.push(part('added', added));
  if (removed.length > 0) parts.push(part('removed', removed));
  return parts.join(' and ');
}

const joinNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * One plain-text line for the history. Names are returned exactly as stored; whatever renders the
 * line is responsible for escaping it.
 */
export function describeTicketEvent(event: TicketEvent, actorName: string): string {
  switch (event.type) {
    case 'ticket.created':
      return `${actorName} created this ticket`;
    case 'ticket.status_changed':
      return `${actorName} moved this from ${event.data.from.name} to ${event.data.to.name}`;
    case 'ticket.updated':
      return `${actorName} ${joinParts(event.data.changes.map(describeChange))}`;
    case 'labels.changed':
      return `${actorName} ${describeLabels(event.data.added, event.data.removed)}`;
    case 'comment.added':
      return `${actorName} commented`;
    case 'comment.edited':
      return `${actorName} edited a comment`;
    case 'comment.deleted':
      return `${actorName} deleted a comment`;
    case 'ticket.archived':
      return `${actorName} archived this ticket`;
    case 'ticket.unarchived':
      return `${actorName} unarchived this ticket`;
    case 'ticket.duplicated':
      return `${actorName} duplicated this from ${event.data.fromKey}`;
    case 'ticket.parent_set':
      return event.data.parentKey
        ? `${actorName} set the parent to ${event.data.parentKey}`
        : `${actorName} removed the parent ${event.data.previousKey ?? ''}`.trimEnd();
    case 'ticket.child_added':
      return `${actorName} added ${event.data.childKey} as a child`;
    case 'ticket.child_removed':
      return `${actorName} removed ${event.data.childKey} from its children`;
    case 'link.added':
      return `${actorName} added a link: ${event.data.label.toLowerCase()} ${event.data.otherKey}`;
    case 'link.removed':
      return `${actorName} removed a link: ${event.data.label.toLowerCase()} ${event.data.otherKey}`;
    case 'ticket.marked_duplicate':
      return `${actorName} marked this as a duplicate of ${event.data.originalKey}`;
    case 'criterion.added':
      return `${actorName} added the criterion "${event.data.text}"`;
    case 'criterion.edited':
      return `${actorName} changed the criterion "${event.data.from}" to "${event.data.to}"`;
    case 'criterion.ticked':
      return `${actorName} ticked "${event.data.text}"`;
    case 'criterion.unticked':
      return `${actorName} unticked "${event.data.text}"`;
    case 'criterion.removed':
      return `${actorName} removed the criterion "${event.data.text}"`;
    case 'criteria.reordered':
      return `${actorName} reordered the acceptance criteria`;
    case 'attachment.added':
      return `${actorName} attached ${event.data.fileName}`;
    case 'attachment.removed':
      return `${actorName} removed the attachment ${event.data.fileName}`;
  }
}

// ---------------------------------------------------------------------------
// The ticket's timeline: comments and system events in one ordered list
// ---------------------------------------------------------------------------

export const timelineItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('event'),
    id: z.uuid(),
    createdAt: z.string(),
    actor: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
    event: ticketEventSchema,
  }),
  z.object({ kind: z.literal('comment'), createdAt: z.string(), comment: commentSchema }),
]);
export type TimelineItem = z.infer<typeof timelineItemSchema>;
