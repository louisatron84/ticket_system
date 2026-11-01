'use client';

import { ESTIMATE_POINTS, type EstimationSystem } from '@forge/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';

const CHOICES: { value: EstimationSystem; label: string; hint: string }[] = [
  { value: 'time', label: 'Time', hint: 'Hours and minutes, such as 1h 30m.' },
  {
    value: 'points',
    label: 'Points',
    hint: `Story points on a fixed scale: ${ESTIMATE_POINTS.join(', ')}.`,
  },
];

/**
 * How the project sizes its work. Switching keeps both kinds of estimate on every ticket; only the
 * chosen one is shown and counted, so switching back loses nothing.
 */
export function EstimationSetting({
  organisationId,
  projectKey,
  initial,
}: {
  organisationId: string;
  projectKey: string;
  initial: EstimationSystem;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function change(next: EstimationSystem) {
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      await apiFetch(`/api/v1/orgs/${organisationId}/projects/${projectKey}`, {
        method: 'PATCH',
        json: { estimation: next },
      });
      toast.success(`${projectKey} now estimates in ${next === 'points' ? 'points' : 'time'}.`);
      router.refresh();
    } catch (error) {
      setValue(previous);
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save the setting.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="flex max-w-xl flex-col gap-2 rounded-md border border-edge bg-panel p-4">
      <legend className="sr-only">Estimates</legend>
      <span className="text-[13px] font-medium">Estimate work in</span>
      <span className="text-xs text-muted">
        One system per project. Tickets keep the other kind of estimate if you switch back.
      </span>
      <div className="mt-1 flex flex-col gap-2">
        {CHOICES.map((choice) => (
          <label key={choice.value} className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="estimation"
              value={choice.value}
              checked={value === choice.value}
              disabled={saving}
              onChange={() => void change(choice.value)}
              className="mt-0.5 accent-[var(--active)]"
            />
            <span className="flex flex-col">
              <span className="text-[13px]">{choice.label}</span>
              <span className="text-xs text-muted">{choice.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
