import { cycleScopeChanges, type Executor } from '@forge/db';

/**
 * Logs a ticket leaving one cycle and joining another (either may be null), so the burndown can be
 * worked out later. Call it in the transaction that changes `tickets.cycle_id`.
 */
export async function recordCycleMove(
  executor: Executor,
  input: {
    organisationId: string;
    ticketIds: string[];
    from: string | null;
    to: string | null;
    at?: Date;
  },
): Promise<void> {
  const { organisationId, ticketIds, from, to } = input;
  if (from === to || ticketIds.length === 0) return;
  const at = input.at ?? new Date();
  const rows = [
    ...(from ? ticketIds.map((ticketId) => ({ cycleId: from, ticketId, change: 'removed' })) : []),
    ...(to ? ticketIds.map((ticketId) => ({ cycleId: to, ticketId, change: 'added' })) : []),
  ];
  await executor
    .insert(cycleScopeChanges)
    .values(rows.map((row) => ({ ...row, organisationId, at })));
}
