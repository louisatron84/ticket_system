'use client';

import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  wantsNotification,
  type NotificationKind,
  type NotificationPrefs,
} from '@forge/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';

/** One switch per kind of notification. Each saves on its own and is undone if the save fails. */
export function NotificationSettings({ initial }: { initial: NotificationPrefs | undefined }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial ?? {});

  async function set(kind: NotificationKind, on: boolean) {
    setPrefs((current) => ({ ...current, [kind]: on }));
    try {
      await apiFetch('/api/v1/me/preferences', {
        method: 'PATCH',
        json: { notifications: { [kind]: on } },
      });
    } catch {
      setPrefs((current) => ({ ...current, [kind]: !on }));
      toast.error('Could not save that setting. Try again.');
    }
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Notify me when</legend>
      {NOTIFICATION_KINDS.map((kind) => (
        <label key={kind} className="flex cursor-pointer items-center gap-3 text-[13px]">
          <input
            type="checkbox"
            role="switch"
            checked={wantsNotification(prefs, kind)}
            onChange={(event) => void set(kind, event.target.checked)}
            className="size-4 accent-[var(--active)]"
          />
          {NOTIFICATION_KIND_LABELS[kind]}
        </label>
      ))}
    </fieldset>
  );
}
