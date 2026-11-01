'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { inputClass } from '@/lib/ui';

/**
 * Whether the project plans in cycles (time boxes), and how long a new one is. Off suits a Kanban
 * team; the Cycles tab only appears while it is on.
 */
export function CycleSetting({
  organisationId,
  projectKey,
  initialEnabled,
  initialLength,
}: {
  organisationId: string;
  projectKey: string;
  initialEnabled: boolean;
  initialLength: number;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [length, setLength] = useState(String(initialLength));
  const [saved, setSaved] = useState(initialLength);
  const [saving, setSaving] = useState(false);
  const lengthValue = Number(length);
  const lengthValid = Number.isInteger(lengthValue) && lengthValue >= 7 && lengthValue <= 28;

  async function save(
    changes: { cyclesEnabled?: boolean; cycleLengthDays?: number },
    done: string,
    undo: () => void,
  ) {
    setSaving(true);
    try {
      await apiFetch(`/api/v1/orgs/${organisationId}/projects/${projectKey}`, {
        method: 'PATCH',
        json: changes,
      });
      toast.success(done);
      router.refresh();
    } catch (error) {
      undo();
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save the setting.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-3 rounded-md border border-edge bg-panel p-4">
      <label className="flex cursor-pointer items-start justify-between gap-6">
        <span className="flex flex-col gap-1">
          <span className="text-[13px] font-medium">Plan in cycles</span>
          <span className="text-xs text-muted">
            Time-boxed rounds of work with a burndown. Leave it off if the team works from the board
            alone.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={saving}
          onChange={(event) => {
            const next = event.target.checked;
            setEnabled(next);
            void save(
              { cyclesEnabled: next },
              next ? `${projectKey} now plans in cycles.` : `Cycles are off for ${projectKey}.`,
              () => setEnabled(!next),
            );
          }}
          className="mt-0.5 size-4 shrink-0 accent-[var(--active)]"
        />
      </label>
      {enabled && (
        <label className="flex items-center gap-2 text-[13px]">
          A new cycle lasts
          <input
            type="number"
            min={7}
            max={28}
            value={length}
            disabled={saving}
            aria-invalid={!lengthValid || undefined}
            onChange={(event) => setLength(event.target.value)}
            onBlur={() => {
              if (!lengthValid || lengthValue === saved) return;
              const previous = saved;
              setSaved(lengthValue);
              void save(
                { cycleLengthDays: lengthValue },
                `New cycles last ${lengthValue} days.`,
                () => {
                  setSaved(previous);
                  setLength(String(previous));
                },
              );
            }}
            className={`${inputClass(!lengthValid)} w-20`}
          />
          days
          {!lengthValid && <span className="text-xs text-fail">7 to 28 days.</span>}
        </label>
      )}
    </div>
  );
}
