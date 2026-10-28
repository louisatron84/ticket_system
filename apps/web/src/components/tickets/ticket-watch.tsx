'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass } from '@/lib/ui';

/** Watch or stop watching a ticket, and who else is. */
export function TicketWatch({
  organisationId,
  ticketKey,
  viewerId,
  watchers,
}: {
  organisationId: string;
  ticketKey: string;
  viewerId: string;
  watchers: { id: string; displayName: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const watching = watchers.some((w) => w.id === viewerId);

  async function toggle() {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/orgs/${organisationId}/tickets/${ticketKey}/watch`, {
        method: watching ? 'DELETE' : 'PUT',
      });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not change that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="watchers-heading" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id="watchers-heading" className="text-[13px] font-semibold">
          Watchers
          <span className="ml-1.5 font-normal text-muted">{watchers.length}</span>
        </h2>
        <button
          type="button"
          className={`${buttonClass('secondary')} h-7 px-2 text-xs`}
          aria-pressed={watching}
          disabled={busy}
          onClick={() => void toggle()}
        >
          {watching ? (
            <EyeOff size={12} aria-hidden="true" />
          ) : (
            <Eye size={12} aria-hidden="true" />
          )}
          {watching ? 'Stop watching' : 'Watch'}
        </button>
      </div>
      {watchers.length > 0 && (
        <p className="text-xs text-muted">{watchers.map((w) => w.displayName).join(', ')}</p>
      )}
    </section>
  );
}
