'use client';

import type { Board } from '@forge/shared';
import { useDroppable } from '@dnd-kit/core';
import Link from 'next/link';
import { StatusGlyph } from '@/components/tickets/badges';

export type DropState =
  /** Nothing is being dragged. */
  | 'idle'
  /** The dragged card may be dropped here. */
  | 'accepts'
  /** The workflow does not allow the dragged card to go here. */
  | 'refuses'
  /** The dragged card is already in this column. */
  | 'current';

/**
 * One status. While a card is dragged, a column that will take it is marked, and one that will
 * not says so, so an illegal move is explained before it is attempted.
 */
export function BoardColumn({
  column,
  dropState,
  draggedFrom,
  seeAllHref,
  children,
}: {
  column: Board['columns'][number];
  dropState: DropState;
  /** Name of the status the dragged card is in, for the refusal message. */
  draggedFrom: string | null;
  /** Where to see every ticket of this status, when the column shows only some. */
  seeAllHref: string;
  children: React.ReactNode;
}) {
  // A column that refuses the card stays a drop target on purpose: letting go over it explains
  // why it cannot go there, instead of quietly picking a neighbour. `accepts` is for the keyboard,
  // which skips the ones that refuse.
  const { setNodeRef, isOver } = useDroppable({
    id: column.status.id,
    data: { accepts: dropState === 'accepts' },
  });
  const truncated = column.tickets.length < column.total;

  const frame =
    dropState === 'accepts'
      ? isOver
        ? 'border-ember bg-raised'
        : 'border-dashed border-edge-strong'
      : dropState === 'refuses'
        ? 'border-transparent opacity-50'
        : 'border-transparent';

  return (
    <section
      aria-label={`${column.status.name}, ${column.total} ${column.total === 1 ? 'ticket' : 'tickets'}`}
      title={
        dropState === 'refuses'
          ? `A ticket in ${draggedFrom ?? 'its current status'} cannot move to ${column.status.name}.`
          : undefined
      }
      className="flex w-72 shrink-0 flex-col gap-2"
    >
      <header className="flex items-center gap-2 px-1">
        <StatusGlyph category={column.status.category} statusKey={column.status.key} />
        <h2 className="min-w-0 truncate text-[13px] font-semibold">{column.status.name}</h2>
        <span className="font-mono text-xs text-muted">{column.total}</span>
      </header>

      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-col gap-2 rounded-md border bg-bg p-1.5 transition-colors ${frame}`}
      >
        {column.tickets.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted">
            {dropState === 'accepts'
              ? 'Drop here'
              : dropState === 'refuses'
                ? `Not reachable from ${draggedFrom ?? 'here'}`
                : 'No tickets'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">{children}</ul>
        )}
        {truncated && (
          <p className="px-2 pb-1 text-xs text-muted">
            Showing <span className="font-mono text-text">{column.tickets.length}</span> of{' '}
            <span className="font-mono text-text">{column.total}</span>.{' '}
            <Link href={seeAllHref} className="underline hover:text-text">
              See all in the list
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
