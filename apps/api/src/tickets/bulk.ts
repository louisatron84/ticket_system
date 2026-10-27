import { projectStatuses, type Db } from '@forge/db';
import {
  hasPermission,
  parseTicketKey,
  ticketSummarySchema,
  type BulkTicketBody,
  type BulkTicketResult,
  type UpdateTicketBody,
} from '@forge/shared';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../errors';
import { loadTicketDetail } from './read';
import { setArchived, updateTicket, type TicketContext } from './service';

type Result = BulkTicketResult['results'][number];
type Failure = Extract<Result, { ok: false }>;

/** As many labels as one ticket may carry, the same as a ticket body allows. */
const MAX_LABELS = 20;

const failure = (key: string, code: Failure['error']['code'], message: string): Failure => ({
  key,
  ok: false,
  error: { code, message },
});

/**
 * Applies one change to many tickets as they are now: each ticket is read, then edited in its own
 * transaction against the version just read, so one ticket's refusal never undoes another's edit.
 * Every ticket gets its own result, in the order asked; only a malformed request or a missing
 * permission fails the whole call.
 */
export async function bulkUpdate(
  db: Db,
  input: { context: TicketContext; body: BulkTicketBody },
): Promise<BulkTicketResult> {
  const { context, body } = input;
  if (
    body.changes.assigneeId !== undefined &&
    !hasPermission(context.permissions, 'tickets.assign')
  ) {
    throw new AppError('forbidden', "You don't have permission to assign tickets.", 403);
  }

  const results: Result[] = [];
  for (const key of body.keys) results.push(await changeOne(db, context, key, body.changes));
  return { results };
}

/**
 * What a ticket's refusal says. A validation failure carries the real reason in its first issue
 * ("That move isn't allowed from Quenched."), where its own text is generic. Any other refusal
 * (a lost version race, an archived ticket) is already worded for the person.
 */
export function failureOf(error: AppError): Failure['error'] {
  const issue = error.code === 'validation_failed' ? error.details?.[0] : undefined;
  return { code: error.code, message: issue?.message ?? error.message };
}

async function changeOne(
  db: Db,
  context: TicketContext,
  key: string,
  changes: BulkTicketBody['changes'],
): Promise<Result> {
  const parsed = parseTicketKey(key);
  const current = parsed
    ? await loadTicketDetail(db, context.organisationId, `${parsed.projectKey}-${parsed.number}`)
    : null;
  if (!current) return failure(key, 'not_found', 'Not found.');

  try {
    const update: Omit<UpdateTicketBody, 'version'> = {};
    if (changes.statusKey !== undefined) {
      const [status] = await db
        .select({ id: projectStatuses.id })
        .from(projectStatuses)
        .where(
          and(
            eq(projectStatuses.organisationId, context.organisationId),
            eq(projectStatuses.projectId, current.project.id),
            eq(projectStatuses.key, changes.statusKey),
            eq(projectStatuses.isActive, true),
          ),
        );
      if (!status) {
        return failure(
          key,
          'validation_failed',
          `The ${current.project.key} project has no status "${changes.statusKey}".`,
        );
      }
      update.statusId = status.id;
    }
    if (changes.priorityId !== undefined) update.priorityId = changes.priorityId;
    if (changes.assigneeId !== undefined) update.assigneeId = changes.assigneeId;
    if (changes.dueDate !== undefined) update.dueDate = changes.dueDate;
    if (changes.addLabelIds !== undefined || changes.removeLabelIds !== undefined) {
      const removed = new Set(changes.removeLabelIds);
      update.labelIds = [
        ...new Set([...current.labels.map((label) => label.id), ...(changes.addLabelIds ?? [])]),
      ].filter((id) => !removed.has(id));
      // The request body caps what is sent, not what the ticket ends up with.
      if (update.labelIds.length > MAX_LABELS) {
        return failure(key, 'validation_failed', `A ticket can have at most ${MAX_LABELS} labels.`);
      }
    }

    // Unarchiving comes first, so the other edits can apply to the ticket; archiving comes last.
    let ticket = current;
    if (changes.archived === false) {
      ticket = await setArchived(db, { context, ticketKey: current.key, archived: false });
    }
    if (Object.keys(update).length > 0) {
      ticket = await updateTicket(db, {
        context,
        ticketKey: current.key,
        body: { version: ticket.version, ...update },
      });
    }
    if (changes.archived === true) {
      ticket = await setArchived(db, { context, ticketKey: current.key, archived: true });
    }
    return { key, ok: true, ticket: ticketSummarySchema.parse(ticket) };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { key, ok: false, error: failureOf(error) };
  }
}
