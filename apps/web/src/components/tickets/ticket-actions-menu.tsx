'use client';

import {
  Archive,
  ArchiveRestore,
  Copy,
  CopyPlus,
  CopyX,
  Ellipsis,
  Filter,
  Link as LinkIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { ActionMenu, Item, useActionMenu } from './action-menu';
import { MarkDuplicateDialog, useMarkDuplicateRequest } from './mark-duplicate-dialog';
import { useTicketActions } from './use-ticket-actions';

/**
 * Everything that can be done to a ticket from its page, behind one button: copy its key or link,
 * make a copy of it, archive it. Anyone who can see the ticket can copy; the rest appear only for
 * the people the server would allow, and the server decides in the end.
 */
export function TicketActionsMenu({
  organisationId,
  slug,
  ticket,
  canEdit,
  canCreate,
  canMarkDuplicate,
  canSendToTriage = false,
}: {
  organisationId: string;
  slug: string;
  ticket: { key: string; title: string; archived: boolean };
  canEdit: boolean;
  canCreate: boolean;
  /** May change its links: tickets.edit, the ticket and its project not archived. */
  canMarkDuplicate: boolean;
  /** tickets.edit, and the ticket is open and not already in triage. */
  canSendToTriage?: boolean;
}) {
  const router = useRouter();
  const { key } = ticket;
  const menu = useActionMenu(key);
  const actions = useTicketActions({ organisationId, slug, ticket, menu });
  const [markingDuplicate, setMarkingDuplicate] = useState(false);
  useMarkDuplicateRequest(
    key,
    useCallback(() => canMarkDuplicate && setMarkingDuplicate(true), [canMarkDuplicate]),
  );

  return (
    <>
      <ActionMenu
        menu={menu}
        label={`Actions for ${key}`}
        icon={<Ellipsis size={16} aria-hidden="true" />}
        disabled={actions.busy}
      >
        <div role="group" aria-label={`${key} actions`}>
          <Item autoFocus icon={<Copy size={14} aria-hidden="true" />} onClick={actions.copyKey}>
            Copy key
          </Item>
          <Item icon={<LinkIcon size={14} aria-hidden="true" />} onClick={actions.copyLink}>
            Copy link
          </Item>
          {canCreate && (
            <Item icon={<CopyPlus size={14} aria-hidden="true" />} onClick={actions.duplicate}>
              Duplicate
            </Item>
          )}
          {canSendToTriage && (
            <Item
              icon={<Filter size={14} aria-hidden="true" />}
              onClick={() => {
                menu.close();
                apiFetch(`/api/v1/orgs/${organisationId}/tickets/${key}/triage/send`, {
                  method: 'POST',
                })
                  .then(() => {
                    toast.success(`${key} is waiting in triage.`);
                    router.refresh();
                  })
                  .catch((error: unknown) =>
                    toast.error(
                      error instanceof ApiRequestError ? error.message : 'Could not send it.',
                    ),
                  );
              }}
            >
              Send to triage
            </Item>
          )}
          {canMarkDuplicate && (
            <Item
              icon={<CopyX size={14} aria-hidden="true" />}
              onClick={() => {
                menu.close();
                setMarkingDuplicate(true);
              }}
            >
              Mark as duplicate…
            </Item>
          )}
          {canEdit && (
            <Item
              icon={
                ticket.archived ? (
                  <ArchiveRestore size={14} aria-hidden="true" />
                ) : (
                  <Archive size={14} aria-hidden="true" />
                )
              }
              onClick={actions.archive}
            >
              {ticket.archived ? 'Unarchive' : 'Archive'}
            </Item>
          )}
        </div>
      </ActionMenu>
      {/* Only on the page while open: a board has one menu per card. */}
      {markingDuplicate && (
        <MarkDuplicateDialog
          organisationId={organisationId}
          ticketKey={key}
          open
          onClose={() => {
            setMarkingDuplicate(false);
            menu.restoreFocus();
          }}
        />
      )}
    </>
  );
}
