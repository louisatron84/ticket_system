'use client';

import {
  burndownSchema,
  cycleListSchema,
  formatEstimate,
  formatPoints,
  type Cycle,
  type CycleList,
} from '@forge/shared';
import { Timer } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { burndownChart, pathOf } from '@/lib/burndown';
import { workspaceHref } from '@/lib/nav';
import { buttonClass, inputClass } from '@/lib/ui';
import { useApiData } from '@/lib/use-api-data';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Modal } from '../ui/modal';

const WIDTH = 560;
const HEIGHT = 160;

function Burndown({ url, cycle, format }: { url: string; cycle: Cycle; format: Formatter }) {
  const { data, error } = useApiData(
    `${url}/${cycle.id}/burndown`,
    (raw) => burndownSchema.parse(raw),
    'Could not load the burndown.',
  );
  if (error) return <p className="text-xs text-fail">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded bg-raised" aria-hidden="true" />;
  const chart = burndownChart(cycle, data.days);
  const last = data.days.at(-1);
  const remaining = last
    ? chart.unit === 'estimate'
      ? format(last.remainingEstimate)
      : `${last.remainingTickets} ${last.remainingTickets === 1 ? 'ticket' : 'tickets'}`
    : 'nothing yet';
  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Burndown of ${cycle.name}: ${remaining} left, by ${chart.unit === 'estimate' ? 'estimate' : 'ticket count'}.`}
        className="h-40 w-full overflow-visible"
        preserveAspectRatio="none"
      >
        <line x1={0} y1={HEIGHT} x2={WIDTH} y2={HEIGHT} className="stroke-edge" strokeWidth={1} />
        <path
          d={pathOf(chart.ideal, WIDTH, HEIGHT)}
          className="stroke-muted"
          strokeWidth={1}
          strokeDasharray="4 4"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathOf(chart.scope, WIDTH, HEIGHT)}
          className="stroke-edge-strong"
          strokeWidth={1.5}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathOf(chart.remaining, WIDTH, HEIGHT)}
          className="stroke-active"
          strokeWidth={2}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 text-xs text-muted">
        <span>
          <span aria-hidden="true" className="mr-1 inline-block h-0.5 w-3 bg-active align-middle" />
          Left: <span className="font-mono text-text">{remaining}</span>
        </span>
        <span>
          <span
            aria-hidden="true"
            className="mr-1 inline-block h-0.5 w-3 bg-edge-strong align-middle"
          />
          Scope
        </span>
        <span>
          <span
            aria-hidden="true"
            className="mr-1 inline-block w-3 border-t border-dashed border-muted align-middle"
          />
          Ideal
        </span>
      </figcaption>
    </figure>
  );
}

type Formatter = (value: number) => string;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span className="font-mono text-[13px]">{value}</span>
    </div>
  );
}

function CycleEditor({
  cycle,
  onSave,
  onCancel,
}: {
  cycle: Cycle;
  onSave: (changes: Record<string, unknown>) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(cycle.name);
  const [startsOn, setStartsOn] = useState(cycle.startsOn);
  const [endsOn, setEndsOn] = useState(cycle.endsOn);
  const [capacity, setCapacity] = useState(cycle.capacity === null ? '' : String(cycle.capacity));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await onSave({
      name: name.trim(),
      ...(cycle.state === 'planned' ? { startsOn } : {}),
      endsOn,
      capacity: capacity === '' ? null : Number(capacity),
    });
    if (saved) onCancel();
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted">
        Name
        <input
          value={name}
          required
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          className={inputClass()}
        />
      </label>
      {cycle.state === 'planned' && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Starts
          <input
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
            className={inputClass()}
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs text-muted">
        Ends
        <input
          type="date"
          value={endsOn}
          onChange={(event) => setEndsOn(event.target.value)}
          className={inputClass()}
        />
      </label>
      <label className="flex w-28 flex-col gap-1 text-xs text-muted">
        Capacity
        <input
          type="number"
          min={0}
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
          className={inputClass()}
        />
      </label>
      <button type="submit" className={buttonClass('primary')} disabled={!name.trim()}>
        Save
      </button>
      <button type="button" className={buttonClass()} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

/**
 * A project's cycles: the one running now with its burndown, the ones planned next, and the ones
 * completed with what was planned against what got done.
 */
export function CyclesView({
  organisationId,
  slug,
  projectKey,
  initial,
  canEdit,
}: {
  organisationId: string;
  slug: string;
  projectKey: string;
  initial: CycleList;
  canEdit: boolean;
}) {
  const [list, setList] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [completing, setCompleting] = useState<Cycle | null>(null);
  const [deleting, setDeleting] = useState<Cycle | null>(null);
  const url = `/api/v1/orgs/${organisationId}/projects/${projectKey}/cycles`;
  const listHref = workspaceHref(slug, `/projects/${projectKey}/list`);
  const editable = canEdit && list.enabled && !list.archived;
  const format: Formatter = (value) =>
    list.estimation === 'points' ? formatPoints(value)! : (formatEstimate(value) ?? '0m');

  async function send(path: string, init: RequestInit & { json?: unknown }, done: string) {
    setBusy(true);
    try {
      setList(cycleListSchema.parse(await apiFetch(path, init)));
      toast.success(done);
      return true;
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save the change.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const active = list.cycles.find((cycle) => cycle.state === 'active');
  const planned = list.cycles.filter((cycle) => cycle.state === 'planned');
  const completed = list.cycles.filter((cycle) => cycle.state === 'completed');
  const ticketsOf = (cycle: Cycle) => `${listHref}?cycle=${cycle.id}`;
  const dates = (cycle: Cycle) => (
    <span className="font-mono">
      {cycle.startsOn} → {cycle.endsOn}
    </span>
  );
  const editButtons = (cycle: Cycle) =>
    editable && (
      <button type="button" className="hover:underline" onClick={() => setEditing(cycle.id)}>
        Edit
      </button>
    );

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      {!list.enabled && (
        <p className="rounded-md border border-dashed border-edge p-4 text-[13px] text-muted">
          Cycles are off for {projectKey}. A project manager can switch them on in Settings.
        </p>
      )}

      <section aria-labelledby="active-cycle" className="flex flex-col gap-3">
        <h2 id="active-cycle" className="text-[13px] font-semibold">
          Running now
        </h2>
        {active ? (
          <div className="flex flex-col gap-4 rounded-md border border-edge bg-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-[14px] font-semibold">
                  <Timer size={14} aria-hidden="true" className="text-active" />
                  {active.name}
                </h3>
                <p className="text-xs text-muted">{dates(active)}</p>
              </div>
              {editable && (
                <button
                  type="button"
                  className={buttonClass('primary')}
                  disabled={busy}
                  onClick={() => setCompleting(active)}
                >
                  Complete cycle
                </button>
              )}
            </div>
            {editing === active.id ? (
              <CycleEditor
                cycle={active}
                onCancel={() => setEditing(null)}
                onSave={(changes) =>
                  send(`${url}/${active.id}`, { method: 'PATCH', json: changes }, 'Saved.')
                }
              />
            ) : (
              <div className="flex flex-wrap gap-6">
                <Stat
                  label="Done"
                  value={`${active.tickets.done} of ${active.tickets.total} tickets`}
                />
                <Stat
                  label="Estimate done"
                  value={`${format(active.estimate.done)} of ${format(active.estimate.total)}`}
                />
                {active.planned && (
                  <Stat
                    label="Planned at the start"
                    value={`${active.planned.tickets} tickets, ${format(active.planned.estimate)}`}
                  />
                )}
                {active.capacity !== null && (
                  <Stat label="Capacity" value={format(active.capacity)} />
                )}
              </div>
            )}
            <Burndown url={url} cycle={active} format={format} />
            <div className="flex gap-3 text-[13px]">
              <Link href={ticketsOf(active)} className="text-active hover:underline">
                View tickets
              </Link>
              {editing !== active.id && editButtons(active)}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-muted">
            No cycle is running. {planned.length > 0 && editable ? 'Start the next one below.' : ''}
          </p>
        )}
      </section>

      <section aria-labelledby="planned-cycles" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="planned-cycles" className="text-[13px] font-semibold">
            Planned
          </h2>
          {editable && (
            <button
              type="button"
              className={buttonClass()}
              disabled={busy}
              onClick={() => void send(url, { method: 'POST', json: {} }, 'Planned a new cycle.')}
            >
              Plan a cycle
            </button>
          )}
        </div>
        {planned.length === 0 ? (
          <p className="text-[13px] text-muted">
            Nothing planned.{' '}
            {editable && `New cycles last ${list.lengthDays} days and follow on from the last one.`}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {planned.map((cycle) => (
              <li
                key={cycle.id}
                aria-label={cycle.name}
                className="flex flex-col gap-2 rounded-md border border-edge bg-panel p-3"
              >
                {editing === cycle.id ? (
                  <CycleEditor
                    cycle={cycle}
                    onCancel={() => setEditing(null)}
                    onSave={(changes) =>
                      send(`${url}/${cycle.id}`, { method: 'PATCH', json: changes }, 'Saved.')
                    }
                  />
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{cycle.name}</p>
                      <p className="text-xs text-muted">
                        {dates(cycle)} · {cycle.tickets.total}{' '}
                        {cycle.tickets.total === 1 ? 'ticket' : 'tickets'},{' '}
                        {format(cycle.estimate.total)}
                        {cycle.capacity !== null && <> of {format(cycle.capacity)} capacity</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-[13px]">
                      <Link href={ticketsOf(cycle)} className="text-active hover:underline">
                        View tickets
                      </Link>
                      {editButtons(cycle)}
                      {editable && cycle.tickets.total === 0 && (
                        <button
                          type="button"
                          className="text-fail hover:underline"
                          onClick={() => setDeleting(cycle)}
                        >
                          Delete
                        </button>
                      )}
                      {editable && !active && (
                        <button
                          type="button"
                          className={buttonClass('primary')}
                          disabled={busy}
                          onClick={() =>
                            void send(
                              `${url}/${cycle.id}/start`,
                              { method: 'POST' },
                              `Started ${cycle.name}.`,
                            )
                          }
                        >
                          Start
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {completed.length > 0 && (
        <section aria-labelledby="completed-cycles" className="flex flex-col gap-3">
          <h2 id="completed-cycles" className="text-[13px] font-semibold">
            Completed
          </h2>
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  Cycle
                </th>
                <th scope="col" className="py-1 font-medium">
                  Dates
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Planned
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Done
                </th>
              </tr>
            </thead>
            <tbody>
              {completed.map((cycle) => (
                <tr key={cycle.id} className="border-t border-edge">
                  <td className="py-1.5">
                    <Link href={ticketsOf(cycle)} className="hover:underline">
                      {cycle.name}
                    </Link>
                  </td>
                  <td className="py-1.5 text-xs text-muted">{dates(cycle)}</td>
                  <td className="py-1.5 text-right font-mono text-xs">
                    {cycle.planned
                      ? `${cycle.planned.tickets} · ${format(cycle.planned.estimate)}`
                      : '—'}
                  </td>
                  <td className="py-1.5 text-right font-mono text-xs">
                    {cycle.done ? `${cycle.done.tickets} · ${format(cycle.done.estimate)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Modal
        open={completing !== null}
        labelledBy="complete-cycle-title"
        onClose={() => setCompleting(null)}
      >
        {completing && (
          <div className="flex flex-col gap-3 p-4 text-[13px]">
            <h2 id="complete-cycle-title" className="text-[14px] font-semibold">
              Complete {completing.name}
            </h2>
            <p>
              {completing.tickets.total - completing.tickets.done === 0
                ? 'Every ticket is done.'
                : `${completing.tickets.total - completing.tickets.done} unfinished ${
                    completing.tickets.total - completing.tickets.done === 1 ? 'ticket' : 'tickets'
                  }. Where should ${
                    completing.tickets.total - completing.tickets.done === 1 ? 'it' : 'they'
                  } go?`}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass('primary')}
                disabled={busy}
                onClick={() =>
                  void send(
                    `${url}/${completing.id}/complete`,
                    { method: 'POST', json: { unfinished: 'next' } },
                    `Completed ${completing.name}.`,
                  ).then(() => setCompleting(null))
                }
              >
                {planned[0] ? `Move to ${planned[0].name}` : 'Move to a new cycle'}
              </button>
              <button
                type="button"
                className={buttonClass()}
                disabled={busy}
                onClick={() =>
                  void send(
                    `${url}/${completing.id}/complete`,
                    { method: 'POST', json: { unfinished: 'backlog' } },
                    `Completed ${completing.name}.`,
                  ).then(() => setCompleting(null))
                }
              >
                Back to the backlog
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'cycle'}?`}
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          void send(`${url}/${target.id}`, { method: 'DELETE' }, `Deleted ${target.name}.`).then(
            () => setDeleting(null),
          );
        }}
      >
        It has no tickets, so nothing else changes.
      </ConfirmDialog>
    </div>
  );
}
