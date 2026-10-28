import { projectStatuses, projects, ticketLinks, tickets, type Executor } from '@forge/db';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

const blocker = alias(tickets, 'blocker');
const blockerStatus = alias(projectStatuses, 'blocker_status');

/**
 * Open blockers of each ticket: tickets with a `blocks` link to it that are not completed
 * (archived or not, since archiving is not fixing). Keys come back in key order.
 */
export async function openBlockersOf(
  executor: Executor,
  organisationId: string,
  ticketIds: string[],
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (ticketIds.length === 0) return found;
  const rows = await executor
    .select({ ticketId: ticketLinks.targetTicketId, key: blocker.key })
    .from(ticketLinks)
    .innerJoin(blocker, eq(blocker.id, ticketLinks.sourceTicketId))
    .innerJoin(blockerStatus, eq(blockerStatus.id, blocker.statusId))
    .where(
      and(
        eq(ticketLinks.organisationId, organisationId),
        eq(ticketLinks.kind, 'blocks'),
        inArray(ticketLinks.targetTicketId, ticketIds),
        ne(blockerStatus.category, 'completed'),
      ),
    )
    .orderBy(asc(blocker.projectId), asc(blocker.number));
  for (const row of rows) found.set(row.ticketId, [...(found.get(row.ticketId) ?? []), row.key]);
  for (const keys of found.values())
    keys.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return found;
}

/** "A", "A and B", "A, B and C". */
const listOf = (keys: string[]) =>
  keys.length <= 1 ? (keys[0] ?? '') : `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}`;

/**
 * Why this ticket cannot move to `target`, or null if it can. The one place the blocker rule lives:
 * a move into a completed status that is not a cancellation is refused while the ticket has open
 * blockers and its own project has the rule on. The security gate will ask the same question.
 */
export async function completionRefusal(
  executor: Executor,
  input: {
    organisationId: string;
    ticket: { id: string; key: string; projectId: string };
    target: { name: string; category: string; isCancellation: boolean };
  },
): Promise<string | null> {
  const { ticket, target } = input;
  if (target.category !== 'completed' || target.isCancellation) return null;

  const [project] = await executor
    .select({ on: projects.blockersStopCompletion })
    .from(projects)
    .where(eq(projects.id, ticket.projectId));
  if (!project?.on) return null;

  const keys = (await openBlockersOf(executor, input.organisationId, [ticket.id])).get(ticket.id);
  if (!keys || keys.length === 0) return null;
  const verb = keys.length === 1 ? 'is' : 'are';
  return `${ticket.key} can't be ${target.name.toLowerCase()} while ${listOf(keys)} ${verb} open.`;
}
