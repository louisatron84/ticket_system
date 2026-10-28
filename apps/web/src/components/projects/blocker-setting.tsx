'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';

/**
 * The project's blocker rule: while on, a ticket with an open blocker cannot be completed as done
 * (it can always be scrapped). The switch moves at once and moves back if the save fails.
 */
export function BlockerSetting({
  organisationId,
  projectKey,
  initial,
}: {
  organisationId: string;
  projectKey: string;
  initial: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function change(next: boolean) {
    setOn(next);
    setSaving(true);
    try {
      await apiFetch(`/api/v1/orgs/${organisationId}/projects/${projectKey}`, {
        method: 'PATCH',
        json: { blockersStopCompletion: next },
      });
      toast.success(
        next
          ? `Blocked tickets of ${projectKey} can no longer be completed.`
          : `Blocked tickets of ${projectKey} can now be completed.`,
      );
      router.refresh();
    } catch (error) {
      setOn(!next);
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save the setting.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex max-w-xl cursor-pointer items-start justify-between gap-6 rounded-md border border-edge bg-panel p-4">
      <span className="flex flex-col gap-1">
        <span className="text-[13px] font-medium">
          Tickets with an open blocker can&apos;t be completed
        </span>
        <span className="text-xs text-muted">
          While a ticket is blocked by one that is not finished, it can&apos;t be moved to a done
          status. It can always be scrapped.
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        disabled={saving}
        onChange={(event) => void change(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--active)]"
      />
    </label>
  );
}
