import type { TimelineItem } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import { eventAction, groupTimeline } from './timeline';

const START = Date.parse('2030-06-15T09:00:00.000Z');
const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString();

const person = (n: number) => ({
  id: `01a1656b-1a49-7146-94ac-1c72df43dd0${n}`,
  displayName: `Person ${n}`,
});

let counter = 0;
const id = () => `01a1656b-1a49-7146-94ac-${String(++counter).padStart(12, '0')}`;

const status = (
  minutes: number,
  actor: ReturnType<typeof person> | null = person(1),
): TimelineItem => ({
  kind: 'event',
  id: id(),
  createdAt: at(minutes),
  actor,
  event: {
    type: 'ticket.status_changed',
    data: { from: { id: 'a', name: 'Open' }, to: { id: 'b', name: 'In Progress' } },
  },
});

const comment = (minutes: number, author = person(1)): TimelineItem => ({
  kind: 'comment',
  createdAt: at(minutes),
  comment: {
    id: id(),
    author: { ...author, email: `${author.displayName}@example.test` },
    body: 'A comment',
    createdAt: at(minutes),
    editedAt: null,
  },
});

const shape = (items: TimelineItem[]) =>
  groupTimeline(items).map((entry) => (entry.kind === 'comment' ? 'comment' : entry.items.length));

describe('groupTimeline', () => {
  it('returns nothing for nothing', () => {
    expect(groupTimeline([])).toEqual([]);
  });

  it('keeps a single event as a group of one', () => {
    const [entry] = groupTimeline([status(0)]);
    expect(entry).toMatchObject({ kind: 'events', actor: { displayName: 'Person 1' } });
    expect(entry?.kind === 'events' && entry.items).toHaveLength(1);
  });

  it('merges events by the same person within five minutes', () => {
    expect(shape([status(0), status(2), status(4)])).toEqual([3]);
  });

  it('measures from the previous event, so a steady stream stays together', () => {
    expect(shape([status(0), status(4), status(8), status(12)])).toEqual([4]);
  });

  it('starts a new group after a gap of more than five minutes', () => {
    expect(shape([status(0), status(5), status(10.5)])).toEqual([2, 1]);
    expect(shape([status(0), status(6)])).toEqual([1, 1]);
  });

  it('does not merge events by different people', () => {
    expect(shape([status(0, person(1)), status(1, person(2)), status(2, person(1))])).toEqual([
      1, 1, 1,
    ]);
  });

  it('merges system events with each other, but not with a person’s', () => {
    expect(shape([status(0, null), status(1, null), status(2, person(1))])).toEqual([2, 1]);
  });

  it('never merges comments, and a comment ends the group before it', () => {
    expect(shape([status(0), comment(1), status(2)])).toEqual([1, 'comment', 1]);
    expect(shape([comment(0), comment(1), comment(2)])).toEqual(['comment', 'comment', 'comment']);
  });

  it('keeps the order it was given, oldest first', () => {
    const items = [status(0), comment(1), status(10), comment(11)];
    const entries = groupTimeline(items);
    expect(
      entries.map((entry) => (entry.kind === 'comment' ? entry.item.createdAt : entry.at)),
    ).toEqual([at(0), at(1), at(10), at(11)]);
  });

  it('gives each group a stable key and the time of its first event', () => {
    const items = [status(0), status(2)];
    const [entry] = groupTimeline(items);
    expect(entry).toMatchObject({ kind: 'events', at: at(0) });
    expect(entry?.kind === 'events' && entry.key).toBe(
      items[0]!.kind === 'event' ? items[0]!.id : '',
    );
  });

  it('does not change what it was given', () => {
    const items = [status(0), status(1)];
    const copy = JSON.stringify(items);
    groupTimeline(items);
    expect(JSON.stringify(items)).toBe(copy);
  });
});

describe('eventAction', () => {
  it('words what happened without naming who did it', () => {
    const item = status(0);
    if (item.kind !== 'event') throw new Error('expected an event');
    expect(eventAction(item.event)).toBe('moved this from Open to In Progress');
  });

  it('works for every kind of event', () => {
    expect(eventAction({ type: 'ticket.created', data: { title: 'x' } })).toBe(
      'created this ticket',
    );
    expect(eventAction({ type: 'comment.deleted', data: { commentId: 'c' } })).toBe(
      'deleted a comment',
    );
    expect(eventAction({ type: 'labels.changed', data: { added: ['bug'], removed: [] } })).toBe(
      'added the label bug',
    );
  });
});
