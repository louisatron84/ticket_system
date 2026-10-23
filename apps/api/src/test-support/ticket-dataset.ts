import { createProject, createTicketRow, tickets, type Db } from '@forge/db';
import { eq } from 'drizzle-orm';
import type { Facts } from './facts';

/** A calendar date in UTC, `offset` days from today, the way the API reckons "today". */
export const utcDay = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type Row = {
  title: string;
  type: string;
  priority: string;
  status: string;
  assignee?: string;
  reporter: string;
  labels?: string[];
  due?: number;
  archived?: boolean;
};

// Twelve tickets with known statuses, people, labels and due dates, so every filter has an exact
// answer. The number in the project's key is the position here, starting at 1.
const ROWS: Row[] = [
  {
    title: 'Fix login redirect',
    type: 'bug',
    priority: 'high',
    status: 'open',
    assignee: 'developer',
    reporter: 'owner',
    labels: ['bug', 'frontend'],
    due: -3,
  },
  {
    title: 'Add dark mode',
    type: 'feature',
    priority: 'normal',
    status: 'backlog',
    reporter: 'owner',
    labels: ['frontend'],
    due: 3,
  },
  {
    title: '100% coverage_goal',
    type: 'task',
    priority: 'low',
    status: 'in_progress',
    assignee: 'reviewer',
    reporter: 'developer',
    due: 0,
  },
  {
    title: 'Refactor auth',
    type: 'improvement',
    priority: 'critical',
    status: 'done',
    assignee: 'developer',
    reporter: 'reviewer',
    labels: ['bug'],
    due: -10,
  },
  {
    title: 'Backslash \\ path',
    type: 'task',
    priority: 'normal',
    status: 'open',
    assignee: 'reviewer',
    reporter: 'owner',
  },
  {
    title: 'Write the docs',
    type: 'documentation',
    priority: 'lowest',
    status: 'blocked',
    assignee: 'developer',
    reporter: 'developer',
    labels: ['frontend'],
    due: 30,
  },
  {
    title: 'Archived leftovers',
    type: 'task',
    priority: 'normal',
    status: 'backlog',
    reporter: 'owner',
    archived: true,
  },
  {
    title: 'Customer call',
    type: 'support',
    priority: 'high',
    status: 'in_review',
    assignee: 'developer',
    reporter: 'reviewer',
    labels: ['bug', 'frontend'],
    due: 7,
  },
  {
    title: 'Cancelled idea',
    type: 'feature',
    priority: 'low',
    status: 'cancelled',
    reporter: 'owner',
    due: -1,
  },
  { title: 'Plan quarter', type: 'epic', priority: 'normal', status: 'open', reporter: 'admin' },
  { title: 'Tenth thing', type: 'task', priority: 'normal', status: 'backlog', reporter: 'owner' },
  {
    title: 'Twelfth thing',
    type: 'task',
    priority: 'low',
    status: 'backlog',
    assignee: 'admin',
    reporter: 'owner',
    due: 1,
  },
];

/** `updatedAt` of ticket number n, in minutes after the base time: a shuffle of 1..12. */
export const updatedMinute = (n: number) => (n * 7) % 13;
export const BASE_TIME = new Date('2030-01-01T00:00:00Z');

/**
 * Adds project LST to the Acme workspace with the twelve tickets above. Ticket 7 is archived.
 * Creation order is also `createdAt` order; `updatedAt` follows a different, fixed order.
 */
export async function addListDataset(db: Db, f: Facts) {
  const { projectId, statusIds } = await createProject(db, {
    organisationId: f.acmeId,
    key: 'LST',
    name: 'List tests',
    createdBy: f.userId('owner'),
  });

  const idByNumber = new Map<number, string>();
  for (const [index, row] of ROWS.entries()) {
    const n = index + 1;
    const created = await db.transaction((tx) =>
      createTicketRow(tx, {
        organisationId: f.acmeId,
        projectId,
        reporterId: f.userId(row.reporter),
        title: row.title,
        typeId: f.typeId('acme', row.type),
        priorityId: f.priorityId('acme', row.priority),
        statusId: statusIds[row.status]!,
        assigneeId: row.assignee ? f.userId(row.assignee) : null,
        dueDate: row.due === undefined ? null : utcDay(row.due),
        labelIds: (row.labels ?? []).map((name) => f.labelId('acme', name)),
        createdAt: new Date(BASE_TIME.getTime() + n * 60_000),
      }),
    );
    if (created.key !== `LST-${n}`) throw new Error(`Expected LST-${n}, got ${created.key}`);
    idByNumber.set(n, created.id);
    await db
      .update(tickets)
      .set({
        updatedAt: new Date(BASE_TIME.getTime() + updatedMinute(n) * 60_000),
        ...(row.archived ? { archivedAt: new Date() } : {}),
      })
      .where(eq(tickets.id, created.id));
  }
  return { projectId, statusIds, idByNumber };
}
