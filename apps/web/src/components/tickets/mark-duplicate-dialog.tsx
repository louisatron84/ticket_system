'use client';

import { useEffect, useId } from 'react';
import { markDuplicate } from '@/lib/ticket-actions';
import { buttonClass } from '@/lib/ui';
import { Modal } from '../ui/modal';
import { TicketPicker } from './ticket-picker';
import { useStructureAction } from './use-structure-action';

/** The command menu asks a ticket page to open this dialog with this event; its detail is the key. */
export const MARK_DUPLICATE_EVENT = 'forge:mark-duplicate';

/** Opens the dialog for `ticketKey` when the command menu asks for it. */
export function useMarkDuplicateRequest(ticketKey: string, open: () => void) {
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<string>).detail === ticketKey) open();
    };
    window.addEventListener(MARK_DUPLICATE_EVENT, listener);
    return () => window.removeEventListener(MARK_DUPLICATE_EVENT, listener);
  }, [ticketKey, open]);
}

/**
 * Asks which ticket this one duplicates, then links it and scraps it in one go. If the workflow
 * does not allow scrapping it from where it is, the server says so and nothing changes.
 */
export function MarkDuplicateDialog({
  organisationId,
  ticketKey,
  open,
  onClose,
}: {
  organisationId: string;
  ticketKey: string;
  open: boolean;
  onClose: () => void;
}) {
  const headingId = useId();
  const action = useStructureAction();

  const pick = (originalKey: string) =>
    void action
      .run(`Could not mark ${ticketKey} as a duplicate.`, async () => {
        await markDuplicate(organisationId, ticketKey, originalKey);
        return `Marked ${ticketKey} as a duplicate of ${originalKey}.`;
      })
      .then((worked) => worked && onClose());

  return (
    <Modal open={open} onClose={onClose} labelledBy={headingId} width="28rem">
      <div className="flex flex-col gap-4">
        <h2 id={headingId} className="text-sm font-semibold">
          Mark {ticketKey} as a duplicate
        </h2>
        <p className="text-[13px] text-muted">
          {ticketKey} will be linked to the original and scrapped.
        </p>
        {open && (
          <TicketPicker
            organisationId={organisationId}
            label="The original ticket"
            exclude={[ticketKey]}
            autoFocus
            disabled={action.busy}
            onPick={pick}
          />
        )}
        <button
          type="button"
          className={`${buttonClass('ghost')} h-8 self-end px-3 text-xs`}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
