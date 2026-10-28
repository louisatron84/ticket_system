import { triageProposals, users, type Executor } from '@forge/db';
import { type TriageAction, type TriageInfo, type TriageState } from '@forge/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { summarise } from './words';

/** What the ticket page shows about a ticket in triage; null when it is not in triage. */
export async function triageInfoOf(
  executor: Executor,
  ticket: { id: string; triageState: string | null; triageSnoozedUntil: Date | null },
): Promise<TriageInfo | null> {
  if (!ticket.triageState) return null;
  const [proposal] = await executor
    .select({
      id: triageProposals.id,
      action: triageProposals.action,
      details: triageProposals.details,
      createdAt: triageProposals.createdAt,
      proposerId: users.id,
      proposerName: users.displayName,
    })
    .from(triageProposals)
    .innerJoin(users, eq(users.id, triageProposals.proposedBy))
    .where(and(eq(triageProposals.ticketId, ticket.id), isNull(triageProposals.decidedAt)));
  return {
    state: ticket.triageState as TriageState,
    snoozedUntil: ticket.triageSnoozedUntil ? ticket.triageSnoozedUntil.toISOString() : null,
    proposal: proposal
      ? {
          id: proposal.id,
          action: proposal.action as TriageAction,
          summary: await summarise(executor, proposal.action as TriageAction, proposal.details),
          details: proposal.details as Record<string, unknown>,
          proposedBy: { id: proposal.proposerId, displayName: proposal.proposerName },
          createdAt: proposal.createdAt.toISOString(),
        }
      : null,
  };
}
