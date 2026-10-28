import { labels, priorities, users, type Executor } from '@forge/db';
import { TRIAGE_ACTION_LABELS, type TriageAction } from '@forge/shared';
import { inArray } from 'drizzle-orm';

/** A proposal in words, for the ticket page and the history: "Accept, assign to Dana, Blaze". */
export async function summarise(
  executor: Executor,
  action: TriageAction,
  details: unknown,
): Promise<string> {
  const d = (details ?? {}) as {
    assigneeId?: string | null;
    priorityId?: string;
    labelIds?: string[];
    originalKey?: string;
    reason?: string;
  };
  const parts = [TRIAGE_ACTION_LABELS[action]];
  if (action === 'duplicate' && d.originalKey) parts[0] = `Duplicate of ${d.originalKey}`;
  if (action === 'decline' && d.reason) parts.push(`because "${d.reason}"`);
  if (d.assigneeId) {
    const [person] = await executor
      .select({ name: users.displayName })
      .from(users)
      .where(inArray(users.id, [d.assigneeId]));
    if (person) parts.push(`assign to ${person.name}`);
  }
  if (d.priorityId) {
    const [priority] = await executor
      .select({ name: priorities.name })
      .from(priorities)
      .where(inArray(priorities.id, [d.priorityId]));
    if (priority) parts.push(`priority ${priority.name}`);
  }
  if (d.labelIds && d.labelIds.length > 0) {
    const names = await executor
      .select({ name: labels.name })
      .from(labels)
      .where(inArray(labels.id, d.labelIds));
    if (names.length > 0) parts.push(`labels ${names.map((n) => n.name).join(', ')}`);
  }
  return parts.join(', ');
}
