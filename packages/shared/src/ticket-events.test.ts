import { describe, expect, it } from 'vitest';
import { describeTicketEvent, ticketEventSchema, type TicketEvent } from './ticket-events';

const describeAs = (event: TicketEvent, actor = 'Dana') => describeTicketEvent(event, actor);

describe('describeTicketEvent', () => {
  it('describes creation', () => {
    expect(describeAs({ type: 'ticket.created', data: { title: 'Fix login' } })).toBe(
      'Dana created this ticket',
    );
  });

  it('describes a status move with the names that were current at the time', () => {
    expect(
      describeAs({
        type: 'ticket.status_changed',
        data: { from: { id: 'a', name: 'In Progress' }, to: { id: 'b', name: 'In Review' } },
      }),
    ).toBe('Dana moved this from In Progress to In Review');
  });

  it('describes a priority change', () => {
    expect(
      describeAs({
        type: 'ticket.updated',
        data: { changes: [{ field: 'priority', from: 'High', to: 'Critical' }] },
      }),
    ).toBe('Dana changed the priority from High to Critical');
  });

  it('describes assigning, unassigning and reassigning', () => {
    const assign = (from: string | null, to: string | null) =>
      describeAs({ type: 'ticket.updated', data: { changes: [{ field: 'assignee', from, to }] } });
    expect(assign(null, 'Riley')).toBe('Dana assigned this to Riley');
    expect(assign('Riley', null)).toBe('Dana unassigned Riley');
    expect(assign('Riley', 'Adam')).toBe('Dana reassigned this from Riley to Adam');
  });

  it('describes due dates, titles and descriptions', () => {
    const change = (
      field: 'dueDate' | 'title' | 'description',
      from: string | null,
      to: string | null,
    ) => describeAs({ type: 'ticket.updated', data: { changes: [{ field, from, to }] } });
    expect(change('dueDate', null, '2026-11-01')).toBe('Dana set the due date to 2026-11-01');
    expect(change('dueDate', '2026-11-01', null)).toBe('Dana removed the due date');
    expect(change('dueDate', '2026-11-01', '2026-11-05')).toBe(
      'Dana changed the due date from 2026-11-01 to 2026-11-05',
    );
    expect(change('title', 'Old', 'New')).toBe('Dana changed the title from "Old" to "New"');
    expect(change('description', null, null)).toBe('Dana edited the description');
  });

  it('joins several changes into one sentence', () => {
    expect(
      describeAs({
        type: 'ticket.updated',
        data: {
          changes: [
            { field: 'priority', from: 'High', to: 'Critical' },
            { field: 'assignee', from: null, to: 'Riley' },
            { field: 'dueDate', from: null, to: '2026-11-01' },
          ],
        },
      }),
    ).toBe(
      'Dana changed the priority from High to Critical, assigned this to Riley and set the due date to 2026-11-01',
    );
  });

  it('describes label changes', () => {
    const labels = (added: string[], removed: string[]) =>
      describeAs({ type: 'labels.changed', data: { added, removed } });
    expect(labels(['bug'], [])).toBe('Dana added the label bug');
    expect(labels(['bug', 'ui'], [])).toBe('Dana added the labels bug and ui');
    expect(labels([], ['docs'])).toBe('Dana removed the label docs');
    expect(labels(['bug'], ['docs'])).toBe('Dana added the label bug and removed the label docs');
  });

  it('describes comment events', () => {
    expect(describeAs({ type: 'comment.added', data: { commentId: 'c1' } })).toBe('Dana commented');
    expect(describeAs({ type: 'comment.edited', data: { commentId: 'c1' } })).toBe(
      'Dana edited a comment',
    );
    expect(describeAs({ type: 'comment.deleted', data: { commentId: 'c1' } })).toBe(
      'Dana deleted a comment',
    );
  });

  it('describes archiving, unarchiving and duplicating', () => {
    expect(describeAs({ type: 'ticket.archived', data: {} })).toBe('Dana archived this ticket');
    expect(describeAs({ type: 'ticket.unarchived', data: {} })).toBe('Dana unarchived this ticket');
    expect(describeAs({ type: 'ticket.duplicated', data: { fromKey: 'WEB-3' } })).toBe(
      'Dana duplicated this from WEB-3',
    );
  });

  it('returns hostile names verbatim: escaping is the renderer’s job', () => {
    expect(
      describeAs(
        {
          type: 'ticket.updated',
          data: {
            changes: [{ field: 'title', from: '<b>x</b>', to: '<script>alert(1)</script>' }],
          },
        },
        '<img src=x onerror=alert(1)>',
      ),
    ).toContain('<script>alert(1)</script>');
  });
});

describe('ticketEventSchema', () => {
  it('accepts a status change and refuses an unknown type', () => {
    expect(
      ticketEventSchema.safeParse({
        type: 'ticket.status_changed',
        data: { from: { id: 'a', name: 'Open' }, to: { id: 'b', name: 'Done' } },
      }).success,
    ).toBe(true);
    expect(ticketEventSchema.safeParse({ type: 'ticket.exploded', data: {} }).success).toBe(false);
  });

  it('accepts the archive and duplicate events, and a duplicate needs its source key', () => {
    expect(ticketEventSchema.safeParse({ type: 'ticket.archived', data: {} }).success).toBe(true);
    expect(ticketEventSchema.safeParse({ type: 'ticket.unarchived', data: {} }).success).toBe(true);
    expect(
      ticketEventSchema.safeParse({ type: 'ticket.duplicated', data: { fromKey: 'WEB-3' } })
        .success,
    ).toBe(true);
    expect(ticketEventSchema.safeParse({ type: 'ticket.duplicated', data: {} }).success).toBe(
      false,
    );
  });
});
