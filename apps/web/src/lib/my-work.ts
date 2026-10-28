import type { TicketSummary } from '@forge/shared';

export const MY_WORK_TABS = ['assigned', 'created', 'watching'] as const;
export type MyWorkTab = (typeof MY_WORK_TABS)[number];

export const MY_WORK_TAB_LABELS: Record<MyWorkTab, string> = {
  assigned: 'Assigned to me',
  created: 'Created by me',
  watching: 'Watching',
};

/** The list filters behind each tab. Created by me includes tickets still waiting in triage. */
export function myWorkQuery(tab: MyWorkTab): URLSearchParams {
  const params = new URLSearchParams({ sort: 'due', dir: 'asc', pageSize: '100' });
  params.append('statusCategory', 'not_started');
  params.append('statusCategory', 'in_progress');
  if (tab === 'assigned') params.set('assignee', 'me');
  if (tab === 'created') {
    params.set('reporter', 'me');
    params.set('triage', 'true');
  }
  if (tab === 'watching') params.set('watching', 'true');
  return params;
}

export type MyWorkGroup = { title: string; tickets: TicketSummary[] };

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * Open tickets, most pressing first: overdue, then due within a week, then the rest by whether
 * work has started. Empty groups are left out.
 */
export function groupMyWork(tickets: TicketSummary[], today: string): MyWorkGroup[] {
  const now = dayNumber(today);
  const groups: Record<string, TicketSummary[]> = {
    overdue: [],
    soon: [],
    started: [],
    notStarted: [],
  };
  for (const ticket of tickets) {
    const due = ticket.dueDate ? dayNumber(ticket.dueDate) - now : null;
    if (due !== null && due < 0) groups.overdue!.push(ticket);
    else if (due !== null && due <= 7) groups.soon!.push(ticket);
    else if (ticket.status.category === 'in_progress') groups.started!.push(ticket);
    else groups.notStarted!.push(ticket);
  }
  return [
    { title: 'Overdue', tickets: groups.overdue! },
    { title: 'Due this week', tickets: groups.soon! },
    { title: 'In progress', tickets: groups.started! },
    { title: 'Not started', tickets: groups.notStarted! },
  ].filter((group) => group.tickets.length > 0);
}
