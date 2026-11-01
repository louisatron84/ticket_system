'use client';

import { LABEL_COLORS, type LabelColor, type LabelSetting } from '@forge/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LabelChip } from '@/components/tickets/label-chip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass, inputClass } from '@/lib/ui';
import { NameField } from './setting-list';

const ticketsWord = (count: number) => (count === 1 ? '1 ticket' : `${count} tickets`);

/**
 * The workspace's labels. Labels are tags, not history, so unlike types they can be merged into
 * another (its tickets get that one) or deleted for real, each after a confirmation saying how
 * many tickets it touches.
 */
export function LabelsSettings({
  organisationId,
  labels,
}: {
  organisationId: string;
  labels: LabelSetting[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor>('blue');
  const [merging, setMerging] = useState<{ label: LabelSetting; intoId: string } | null>(null);
  const [deleting, setDeleting] = useState<LabelSetting | null>(null);
  const base = `/api/v1/orgs/${organisationId}/labels`;
  const sorted = [...labels].sort((a, b) => a.name.localeCompare(b.name));

  async function run(
    url: string,
    init: RequestInit & { json?: unknown },
    done: string,
    failure: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      await apiFetch(url, init);
      toast.success(done);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (
      await run(
        base,
        { method: 'POST', json: { name: trimmed, color } },
        `Added ${trimmed}.`,
        'Could not add the label.',
      )
    ) {
      setName('');
    }
  }

  const mergeTarget = merging ? labels.find((label) => label.id === merging.intoId) : undefined;

  return (
    <section aria-labelledby="labels-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="labels-heading" className="text-[13px] font-semibold">
          Labels
        </h2>
        <p className="max-w-2xl text-xs text-muted">
          Tags any ticket can carry. Merging moves one label&apos;s tickets to another and removes
          it; deleting takes it off every ticket.
        </p>
      </div>
      {sorted.length === 0 ? (
        <p className="text-[13px] text-muted">No labels yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge rounded-md border border-edge bg-panel">
          {sorted.map((label) => (
            <li
              key={label.id}
              data-testid={`label-${label.name}`}
              className="flex flex-wrap items-center gap-2 px-3 py-2"
            >
              <LabelChip label={label} />
              <NameField
                key={`${label.id}:${label.name}`}
                label={`Name of ${label.name}`}
                initial={label.name}
                busy={busy}
                onSave={(next) =>
                  run(
                    `${base}/${label.id}`,
                    { method: 'PATCH', json: { name: next } },
                    `Renamed to ${next}.`,
                    'Could not rename the label.',
                  )
                }
              />
              <select
                aria-label={`Colour of ${label.name}`}
                value={label.color}
                disabled={busy}
                onChange={(event) =>
                  void run(
                    `${base}/${label.id}`,
                    { method: 'PATCH', json: { color: event.target.value } },
                    `${label.name} is now ${event.target.value}.`,
                    'Could not change the colour.',
                  )
                }
                className={`${inputClass()} w-28`}
              >
                {LABEL_COLORS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">{ticketsWord(label.ticketCount)}</span>
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  className={buttonClass('ghost')}
                  disabled={busy || labels.length < 2}
                  onClick={() =>
                    setMerging({
                      label,
                      intoId: sorted.find((other) => other.id !== label.id)!.id,
                    })
                  }
                >
                  Merge…
                </button>
                <button
                  type="button"
                  className={buttonClass('ghost')}
                  disabled={busy}
                  onClick={() => setDeleting(label)}
                >
                  Delete…
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} noValidate className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          New label
          <input
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            className={`${inputClass()} w-56`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Colour
          <select
            value={color}
            onChange={(event) => setColor(event.target.value as LabelColor)}
            className={`${inputClass()} w-28`}
          >
            {LABEL_COLORS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass()} disabled={busy || !name.trim()}>
          Add
        </button>
      </form>

      <ConfirmDialog
        open={merging !== null}
        title={merging ? `Merge ${merging.label.name}` : 'Merge'}
        confirmLabel="Merge"
        busy={busy}
        onCancel={() => setMerging(null)}
        onConfirm={() => {
          if (!merging || !mergeTarget) return;
          void run(
            `${base}/${merging.label.id}/merge`,
            { method: 'POST', json: { intoId: merging.intoId } },
            `Merged ${merging.label.name} into ${mergeTarget.name}.`,
            'Could not merge the labels.',
          ).then((ok) => ok && setMerging(null));
        }}
      >
        {merging && (
          <div className="flex flex-col gap-3 text-[13px]">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Into
              <select
                value={merging.intoId}
                onChange={(event) => setMerging({ ...merging, intoId: event.target.value })}
                className={inputClass()}
              >
                {sorted
                  .filter((other) => other.id !== merging.label.id)
                  .map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.name}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              {ticketsWord(merging.label.ticketCount)} with {merging.label.name} will get{' '}
              {mergeTarget?.name ?? 'the other label'} instead, and {merging.label.name} will be
              removed.
            </p>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `Delete ${deleting.name}` : 'Delete'}
        confirmLabel="Delete label"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          void run(
            `${base}/${deleting.id}`,
            { method: 'DELETE' },
            `Deleted ${deleting.name}.`,
            'Could not delete the label.',
          ).then((ok) => ok && setDeleting(null));
        }}
      >
        {deleting && (
          <p className="text-[13px]">
            {deleting.ticketCount === 0
              ? `No ticket has ${deleting.name}.`
              : `${deleting.name} will be taken off ${ticketsWord(deleting.ticketCount)}.`}{' '}
            This cannot be undone.
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
