'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass, inputClass } from '@/lib/ui';

export type SettingItem = {
  id: string;
  key: string;
  name: string;
  active: boolean;
  ticketCount: number;
};

const ticketsWord = (count: number) => (count === 1 ? '1 ticket' : `${count} tickets`);

/** The order after moving one id a step up (-1) or down (+1). */
export function moveId(ids: readonly string[], id: string, step: -1 | 1): string[] {
  const next = [...ids];
  const from = next.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/**
 * Ticket types or priorities: rename in place, reorder, deactivate and reactivate, add. Nothing is
 * deleted, because tickets and their history name them. `saveOrder` turns the order shown into the
 * order the API stores (priorities are shown most urgent first but stored least urgent first).
 */
export function SettingList({
  organisationId,
  path,
  heading,
  noun,
  description,
  items,
  saveOrder = (ids) => ids,
}: {
  organisationId: string;
  /** `ticket-types` or `priorities`. */
  path: string;
  heading: string;
  noun: string;
  description: string;
  items: SettingItem[];
  saveOrder?: (shownIds: string[]) => string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const base = `/api/v1/orgs/${organisationId}/${path}`;
  const ids = items.map((item) => item.id);
  const activeCount = items.filter((item) => item.active).length;
  const headingId = `${path}-heading`;

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
        { method: 'POST', json: { name: trimmed } },
        `Added ${trimmed}.`,
        `Could not add the ${noun}.`,
      )
    ) {
      setName('');
    }
  }

  const reorder = (id: string, step: -1 | 1) =>
    void run(
      `${base}/order`,
      { method: 'PUT', json: { ids: saveOrder(moveId(ids, id, step)) } },
      'Order saved.',
      `Could not reorder the ${noun}s.`,
    );

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-[13px] font-semibold">
          {heading}
        </h2>
        <p className="max-w-2xl text-xs text-muted">{description}</p>
      </div>
      <ul className="flex flex-col divide-y divide-edge rounded-md border border-edge bg-panel">
        {items.map((item, index) => (
          <li
            key={item.id}
            data-testid={`${path}-${item.key}`}
            className={`flex flex-wrap items-center gap-2 px-3 py-2 ${item.active ? '' : 'opacity-60'}`}
          >
            <span className="flex flex-col">
              <button
                type="button"
                className="text-muted hover:text-text disabled:opacity-30"
                aria-label={`Move ${item.name} up`}
                disabled={busy || index === 0}
                onClick={() => reorder(item.id, -1)}
              >
                <ArrowUp size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="text-muted hover:text-text disabled:opacity-30"
                aria-label={`Move ${item.name} down`}
                disabled={busy || index === items.length - 1}
                onClick={() => reorder(item.id, 1)}
              >
                <ArrowDown size={12} aria-hidden="true" />
              </button>
            </span>
            <NameField
              key={`${item.id}:${item.name}`}
              label={`Name of ${item.name}`}
              initial={item.name}
              busy={busy}
              onSave={(next) =>
                run(
                  `${base}/${item.id}`,
                  { method: 'PATCH', json: { name: next } },
                  `Renamed to ${next}.`,
                  `Could not rename the ${noun}.`,
                )
              }
            />
            <span
              className="font-mono text-xs text-muted"
              title="The fixed key: it never changes when the name does. Queries and the API take either."
            >
              key {item.key}
            </span>
            <span className="text-xs text-muted">{ticketsWord(item.ticketCount)}</span>
            <span className="ml-auto">
              {item.active ? (
                <button
                  type="button"
                  className={buttonClass('ghost')}
                  disabled={busy || activeCount <= 1}
                  title={
                    activeCount <= 1 ? `The last active ${noun} cannot be deactivated.` : undefined
                  }
                  onClick={() =>
                    void run(
                      `${base}/${item.id}`,
                      { method: 'PATCH', json: { active: false } },
                      `${item.name} is no longer offered. Tickets that have it keep it.`,
                      `Could not deactivate the ${noun}.`,
                    )
                  }
                >
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  className={buttonClass('ghost')}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      `${base}/${item.id}`,
                      { method: 'PATCH', json: { active: true } },
                      `${item.name} is offered again.`,
                      `Could not reactivate the ${noun}.`,
                    )
                  }
                >
                  Reactivate
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={add} noValidate className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {`New ${noun}`}
          <input
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            className={`${inputClass()} w-56`}
          />
        </label>
        <button type="submit" className={buttonClass()} disabled={busy || !name.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

/** A name that saves when the field loses focus or Enter is pressed, and only if it changed. */
export function NameField({
  label,
  initial,
  busy,
  maxLength = 40,
  onSave,
}: {
  label: string;
  initial: string;
  busy: boolean;
  maxLength?: number;
  onSave: (name: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(initial);
  const save = async () => {
    const next = value.trim();
    if (!next || next === initial) {
      setValue(initial);
      return;
    }
    if (!(await onSave(next))) setValue(initial);
  };
  return (
    <input
      aria-label={label}
      value={value}
      maxLength={maxLength}
      disabled={busy}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          (event.target as HTMLInputElement).blur();
        }
        if (event.key === 'Escape') setValue(initial);
      }}
      className={`${inputClass()} w-48`}
    />
  );
}
