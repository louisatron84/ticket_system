import { projectStatuses, projects, tickets, type Db } from '@forge/db';
import { and, eq, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { wakeSnoozed } from '../triage/service';
import { notify } from './service';

const HOUR_MS = 3_600_000;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Due-date reminders for assignees: once when a ticket is due tomorrow, once when it becomes
 * overdue (per due date, so moving the date reminds again). Finished, archived and triage tickets
 * are left alone. Safe to run any number of times: the dedupe key stops repeats.
 */
export async function remindDueDates(
  db: Db,
  now = new Date(),
  onError?: (message: string, error: unknown) => void,
): Promise<void> {
  const today = isoDay(now);
  const tomorrow = isoDay(new Date(now.getTime() + 24 * HOUR_MS));
  const open = and(
    isNull(tickets.archivedAt),
    isNull(projects.archivedAt),
    isNull(tickets.triageState),
    isNotNull(tickets.assigneeId),
    ne(projectStatuses.category, 'completed'),
  );
  const rows = await db
    .select({
      id: tickets.id,
      key: tickets.key,
      organisationId: tickets.organisationId,
      assigneeId: tickets.assigneeId,
      dueDate: tickets.dueDate,
    })
    .from(tickets)
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .where(
      and(
        open,
        isNotNull(tickets.dueDate),
        lt(tickets.dueDate, isoDay(new Date(now.getTime() + 48 * HOUR_MS))),
      ),
    );

  for (const row of rows) {
    const overdue = row.dueDate! < today;
    const dueSoon = row.dueDate === tomorrow;
    if (!overdue && !dueSoon) continue;
    await db
      .transaction((tx) =>
        notify(tx, {
          organisationId: row.organisationId,
          actorId: null,
          drafts: [
            {
              recipientId: row.assigneeId!,
              kind: overdue ? 'overdue' : 'due_soon',
              ticketId: row.id,
              text: overdue ? `${row.key} is overdue` : `${row.key} is due tomorrow`,
              dedupeKey: `${overdue ? 'overdue' : 'due_soon'}:${row.dueDate}`,
            },
          ],
        }),
      )
      // One ticket that fails (a member removed mid-run, say) never stops the others.
      .catch((error: unknown) => onError?.(`due reminder for ${row.key} failed`, error));
  }
}

/** Runs the reminders and wakes snoozed triage tickets now and every hour, until stopped. */
export function startJobs(db: Db, log: (message: string, error: unknown) => void): () => void {
  const run = async () => {
    // Each job on its own, so one failing never stops the other.
    await remindDueDates(db, new Date(), log).catch((error) => log('due reminders failed', error));
    await wakeSnoozed(db).catch((error) => log('waking snoozed triage failed', error));
  };
  void run();
  const timer = setInterval(() => void run(), HOUR_MS);
  timer.unref();
  return () => clearInterval(timer);
}
