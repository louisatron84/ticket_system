import type { TicketSummary } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import { groupMyWork, myWorkQuery } from './my-work';

const ticket = (
  key: string,
  dueDate: string | null,
  category: 'not_started' | 'in_progress' = 'not_started',
) => ({ key, dueDate, status: { category } }) as unknown as TicketSummary;

describe('groupMyWork', () => {
  it('puts overdue first, then due this week, then by whether work started', () => {
    const groups = groupMyWork(
      [
        ticket('A', '2026-10-20'),
        ticket('B', '2026-10-30'),
        ticket('C', null, 'in_progress'),
        ticket('D', '2026-12-01'),
        ticket('E', '2026-10-28', 'in_progress'),
      ],
      '2026-10-28',
    );
    expect(groups.map((g) => [g.title, g.tickets.map((t) => t.key)])).toEqual([
      ['Overdue', ['A']],
      ['Due this week', ['B', 'E']],
      ['In progress', ['C']],
      ['Not started', ['D']],
    ]);
  });

  it('leaves out empty groups', () => {
    expect(groupMyWork([], '2026-10-28')).toEqual([]);
  });
});

describe('myWorkQuery', () => {
  it('asks for open tickets of the tab, soonest due first', () => {
    expect(myWorkQuery('assigned').toString()).toBe(
      'sort=due&dir=asc&pageSize=100&statusCategory=not_started&statusCategory=in_progress&assignee=me',
    );
    expect(myWorkQuery('created').get('triage')).toBe('true');
    expect(myWorkQuery('watching').get('watching')).toBe('true');
  });
});
