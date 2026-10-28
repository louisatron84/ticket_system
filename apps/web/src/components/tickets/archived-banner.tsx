'use client';

import { Archive, ArchiveRestore } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api-client';
import { unarchiveTicket } from '@/lib/ticket-actions';
import { buttonClass } from '@/lib/ui';

/**
 * Shown at the top of an archived ticket, so it is clear why nothing on the page can be changed.
 * People who may edit can unarchive from here too.
 */
export function ArchivedBanner({
  organisationId,
  ticketKey,
  canEdit,
}: {
  organisationId: string;
  ticketKey: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function unarchive() {
    setBusy(true);
    try {
      await unarchiveTicket(organisationId, ticketKey);
      toast.success(`Unarchived ${ticketKey}.`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : `Could not unarchive ${ticketKey}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-md border border-edge-strong bg-raised px-3 py-2 text-[13px]"
    >
      <Archive size={16} aria-hidden="true" className="shrink-0" />
      <p className="min-w-0 flex-1">
        This ticket is archived. It is read-only, and left out of lists and boards, until it is
        unarchived.
      </p>
      {canEdit && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void unarchive()}
          className={buttonClass('secondary')}
        >
          <ArchiveRestore size={14} aria-hidden="true" />
          Unarchive
        </button>
      )}
    </div>
  );
}
