'use client';

import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { StatusGlyph } from '@/components/tickets/badges';
import type { BoardColumnData } from '@/lib/board';
import { HEAT_COLOURS, heatOf } from '@/lib/heat';
import { QuickCreate } from './quick-create';

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
 * not says so, so an illegal move is explained before it is attempted. With `heat` on, the column
 * has an edge and a faint glow in the colour of its status; off, it is neutral. With
 * `onQuickCreate` the header has a "+" that opens a one-line form for a new ticket in this status.
 */
export function BoardColumn({
  column,
  dropState,
  draggedFrom,
  seeAllHref,
  dropId = column.status.key,
  heat = true,
  onQuickCreate,
  projectChoices = [],
  defaultProject = '',
  askProject = false,
  children,
}: {
  column: BoardColumnData;
  dropState: DropState;
  /** Name of the status the dragged card is in, for the refusal message. */
  draggedFrom: string | null;
  /** Where to see every ticket of this status, when the column shows only some. */
  seeAllHref: string;
  /** Its id as a drop target: the status key, with the lane in it when the board has lanes. */
  dropId?: string;
  heat?: boolean;
  /** Makes a ticket in this column's status; true when it was made. Absent: no "+". */
  onQuickCreate?: (title: string, projectKey: string) => Promise<boolean>;
  /** The projects a ticket made here could go to. */
  projectChoices?: { key: string; name: string }[];
  defaultProject?: string;
  /** Ask which project (the Tickets board) rather than assume it (a project's board). */
  askProject?: boolean;
  children: React.ReactNode;
}) {
  // A column that refuses the card stays a drop target on purpose: letting go over it explains
  // why it cannot go there, instead of quietly picking a neighbour. `accepts` is for the keyboard,
  // which skips the ones that refuse.
  const { setNodeRef, isOver } = useDroppable({
    // A status key, not an id: on the Tickets page a column holds several projects' statuses.
    id: dropId,
    data: { accepts: dropState === 'accepts' },
  });
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const truncated = column.tickets.length < column.total;
  const token = heatOf(column.status);
  const colour = HEAT_COLOURS[token];

  const frame =
    dropState === 'accepts'
      ? isOver
        ? 'border-active bg-raised'
        : 'border-dashed border-edge-strong'
      : dropState === 'refuses'
        ? 'border-transparent opacity-50'
        : 'border-transparent';

  return (
    <section
      aria-label={`${column.status.name}, ${column.total} ${column.total === 1 ? 'ticket' : 'tickets'}`}
      data-heat={token}
      title={
        dropState === 'refuses'
          ? `A ticket in ${draggedFrom ?? 'its current status'} cannot move to ${column.status.name}.`
          : undefined
      }
      style={
        heat
          ? {
              borderTopColor: colour,
              backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${colour} 14%, var(--panel)) 0, var(--panel) 90px)`,
            }
          : undefined
      }
      // Columns share the width the window has, like a wall of lanes, and only start to scroll
      // sideways when there is not room for each to be at least 14rem wide.
      // Focusable by script only: where the focus lands if the card that had it is archived away.
      tabIndex={-1}
      className={`outline-none flex min-w-56 max-w-96 flex-1 basis-0 flex-col gap-2 rounded-md border-t-2 px-1.5 pb-1.5 pt-2 ${
        heat ? '' : 'border-transparent'
      }`}
    >
      <div className="flex items-center gap-2 px-1">
        <header className="flex min-w-0 flex-1 items-center gap-2">
          <StatusGlyph category={column.status.category} statusKey={column.status.key} />
          <h2 className="min-w-0 truncate text-[13px] font-semibold">{column.status.name}</h2>
          <span className="font-mono text-xs text-muted">{column.total}</span>
        </header>
        {onQuickCreate && (
          <button
            ref={addRef}
            type="button"
            aria-label={`Add a ticket to ${column.status.name}`}
            aria-expanded={adding}
            title="Add a ticket"
            onClick={() => setAdding((current) => !current)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-raised hover:text-text"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-col gap-2 rounded-md border p-1.5 transition-colors ${
          heat ? '' : 'bg-bg'
        } ${frame}`}
      >
        {onQuickCreate && adding && (
          <QuickCreate
            statusName={column.status.name}
            projects={projectChoices}
            defaultProject={defaultProject}
            showProject={askProject}
            onCreate={onQuickCreate}
            onClose={() => {
              setAdding(false);
              addRef.current?.focus();
            }}
          />
        )}
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
