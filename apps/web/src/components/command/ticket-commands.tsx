'use client';

import { useTicketEditor } from '@/components/tickets/ticket-editor';
import { useTicketActions } from '@/components/tickets/use-ticket-actions';
import type { Command } from '@/lib/commands';
import { usePageCommands } from './command-menu';

/** The command menu has no button of its own to close or give the focus back to. */
const NO_MENU = { close: () => {}, restoreFocus: () => {} };

/**
 * Puts the ticket on this page's actions into the command menu: assign, unassign, move, copy,
 * duplicate, archive. Changes go through the page's own editor, so they use the ticket as it is on
 * screen now and are refused the same way if someone else changed it first. Only what this person
 * may do is offered; the server decides in the end.
 */
export function TicketCommands({
  organisationId,
  slug,
  viewerId,
  canArchive,
  canCreate,
}: {
  organisationId: string;
  slug: string;
  viewerId: string;
  /** tickets.edit, which archiving and unarchiving need even on an archived ticket. */
  canArchive: boolean;
  canCreate: boolean;
}) {
  // On an archived ticket the editor says nobody may edit or assign, which is what we want here.
  const { ticket, canEdit, canAssign, save } = useTicketEditor();
  const archived = ticket.archivedAt !== null;
  const actions = useTicketActions({
    organisationId,
    slug,
    ticket: { key: ticket.key, archived },
    menu: NO_MENU,
  });
  const action = (id: string, label: string, run: () => void): Command => ({
    id: `ticket:${id}`,
    group: 'Actions',
    label,
    run,
  });
  const assigneeId = ticket.assignee?.id ?? null;

  usePageCommands([
    ...(canAssign && assigneeId !== viewerId
      ? [action('assign-me', 'Assign to me', () => void save({ assigneeId: viewerId }))]
      : []),
    ...(canAssign && assigneeId !== null
      ? [action('unassign', 'Unassign', () => void save({ assigneeId: null }))]
      : []),
    ...(canEdit
      ? ticket.allowedTransitions.map((status) =>
          action(
            `move:${status.id}`,
            `Move to ${status.name}`,
            () => void save({ statusId: status.id }),
          ),
        )
      : []),
    action('copy-key', 'Copy key', () => void actions.copyKey()),
    action('copy-link', 'Copy link', () => void actions.copyLink()),
    ...(canCreate ? [action('duplicate', 'Duplicate', () => void actions.duplicate())] : []),
    ...(canArchive
      ? [action('archive', archived ? 'Unarchive' : 'Archive', () => void actions.archive())]
      : []),
  ]);
  return null;
}
