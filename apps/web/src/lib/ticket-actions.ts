// What can be done to a ticket from more than one screen: the ticket page, the list and the board
// all copy, duplicate and archive the same way and word the result the same way. The pure helpers
// come first; the few calls that touch the browser or the network are at the end.

import type { BulkTicketBody, BulkTicketResult, TicketConfig, TicketDetail } from '@forge/shared';
import { apiFetch } from './api-client';
import { workspaceHref } from './nav';

/**
 * The full address of a ticket, for pasting into a message. Built from where the app is running
 * at the moment of the call, so it is only for use in the browser.
 */
export function ticketHref(slug: string, key: string): string {
  return `${window.location.origin}${workspaceHref(slug, `/tickets/${key}`)}`;
}

/**
 * The words for the outcome of a bulk change: one line for the count, and one line per ticket
 * that could not be changed, so a person can see which ones and why.
 */
export function bulkSummary(results: BulkTicketResult['results']): {
  text: string;
  failures: string[];
} {
  const failures = results.flatMap((result) =>
    result.ok ? [] : [`${result.key}: ${result.error.message}`],
  );
  const changed = results.length - failures.length;
  const counted = `Changed ${changed} of ${results.length}.`;
  return {
    text: failures.length > 0 ? `${counted} ${failures.length} could not be changed:` : counted,
    failures,
  };
}

/**
 * What a ticket made without choosing starts with: the Task type (else the first type) and the
 * Normal priority (else the middle one by rank). An empty id means the workspace has none.
 */
export function defaultTypeAndPriority(config: TicketConfig): {
  typeId: string;
  priorityId: string;
} {
  const type = config.types.find((item) => item.key === 'task') ?? config.types[0];
  const byRank = [...config.priorities].sort((a, b) => a.rank - b.rank);
  const priority =
    byRank.find((item) => item.key === 'normal') ?? byRank[Math.floor((byRank.length - 1) / 2)];
  return { typeId: type?.id ?? '', priorityId: priority?.id ?? '' };
}

const ticketPath = (organisationId: string, key: string) =>
  `/api/v1/orgs/${organisationId}/tickets/${key}`;

export const archiveTicket = (organisationId: string, key: string) =>
  apiFetch<TicketDetail>(`${ticketPath(organisationId, key)}/archive`, { method: 'POST' });

export const unarchiveTicket = (organisationId: string, key: string) =>
  apiFetch<TicketDetail>(`${ticketPath(organisationId, key)}/unarchive`, { method: 'POST' });

/** Changes one or more fields of a ticket, against the version the person was looking at. */
export const updateTicket = (
  organisationId: string,
  key: string,
  version: number,
  fields: { priorityId: string } | { assigneeId: string | null } | { statusId: string },
) =>
  apiFetch<TicketDetail>(ticketPath(organisationId, key), {
    method: 'PATCH',
    json: { version, ...fields },
  });

/** Makes a copy of the ticket and returns the copy. */
export const duplicateTicket = (organisationId: string, key: string) =>
  apiFetch<TicketDetail>(`${ticketPath(organisationId, key)}/duplicate`, { method: 'POST' });

/** One change to many tickets. Each ticket's own result comes back; see `bulkSummary`. */
export const bulkUpdate = (organisationId: string, body: BulkTicketBody) =>
  apiFetch<BulkTicketResult>(`/api/v1/orgs/${organisationId}/tickets/bulk`, {
    method: 'POST',
    json: body,
  });

/** Puts text on the clipboard. False when the browser would not allow it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
