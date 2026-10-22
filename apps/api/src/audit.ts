import { auditEvents, type Executor } from '@forge/db';

export type AuditInput = {
  organisationId?: string;
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  requestId: string;
  source: 'user' | 'dev' | 'system';
  outcome: 'success' | 'denied' | 'failed';
};

/**
 * Appends an audit event. Pass the open transaction so the event commits or rolls back together
 * with the change it describes. Never put tokens, cookies or other secrets in before/after.
 */
export async function recordAudit(executor: Executor, event: AuditInput): Promise<void> {
  await executor.insert(auditEvents).values({
    organisationId: event.organisationId ?? null,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId ?? null,
    before: event.before ?? null,
    after: event.after ?? null,
    requestId: event.requestId,
    source: event.source,
    outcome: event.outcome,
  });
}
