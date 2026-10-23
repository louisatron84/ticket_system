import { describeTicketEvent, type TicketEvent, type TimelineItem } from '@forge/shared';

type EventItem = Extract<TimelineItem, { kind: 'event' }>;
type CommentItem = Extract<TimelineItem, { kind: 'comment' }>;

export type EventGroup = {
  kind: 'events';
  /** The first event's id, which is stable and unique. */
  key: string;
  actor: EventItem['actor'];
  /** When the first event happened. */
  at: string;
  items: EventItem[];
};

export type TimelineEntry = { kind: 'comment'; item: CommentItem } | EventGroup;

const GROUP_WINDOW_MS = 5 * 60_000;

const sameActor = (a: EventItem['actor'], b: EventItem['actor']) => a?.id === b?.id;

/**
 * Folds runs of history lines into groups, so a burst of changes by one person reads as one
 * entry instead of a wall of lines. Events join a group while they come from the same person (or
 * all from the system) and each is within five minutes of the one before it. A comment is never
 * merged and ends the group in front of it. Order is kept, oldest first.
 */
export function groupTimeline(items: TimelineItem[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let open: EventGroup | null = null;
  let previousTime = 0;

  for (const item of items) {
    if (item.kind === 'comment') {
      entries.push({ kind: 'comment', item });
      open = null;
      continue;
    }

    const time = Date.parse(item.createdAt);
    if (open && sameActor(open.actor, item.actor) && time - previousTime <= GROUP_WINDOW_MS) {
      open.items.push(item);
    } else {
      open = { kind: 'events', key: item.id, actor: item.actor, at: item.createdAt, items: [item] };
      entries.push(open);
    }
    previousTime = time;
  }
  return entries;
}

/** What happened, without who did it ("moved this from Open to Done"), for use under a name. */
export function eventAction(event: TicketEvent): string {
  return describeTicketEvent(event, '').trim();
}
