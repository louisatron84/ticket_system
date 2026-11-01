'use client';

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  formatTicketEstimate,
  type Backlog,
  type BacklogItem,
  type TicketDetail,
} from '@forge/shared';
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, GripVertical } from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { estimateTotal, moveItem, placeFor } from '@/lib/backlog';
import { workspaceHref } from '@/lib/nav';
import { inputClass } from '@/lib/ui';
import { PriorityMark, StatusBadge } from '../tickets/badges';
import { UserChip } from '../tickets/user-chip';

function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-raised hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function Row({
  item,
  index,
  count,
  slug,
  estimation,
  maxRank,
  canEdit,
  busy,
  onMove,
  cycles,
  onCycle,
}: {
  item: BacklogItem;
  /** Cycles a ticket can be planned into; empty when the project does not use them. */
  cycles: Backlog['cycles'];
  onCycle: (cycleId: string | null) => void;
  index: number;
  count: number;
  slug: string;
  estimation: Backlog['estimation'];
  maxRank: number;
  canEdit: boolean;
  busy: boolean;
  onMove: (from: number, to: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.key,
    disabled: !canEdit || busy,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: item.key });
  const estimate = formatTicketEstimate(estimation, item);

  // Alt+Up and Alt+Down move the row whose control has the focus; with Shift, to the very end.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!canEdit || busy || !event.altKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const up = event.key === 'ArrowUp';
    const to = event.shiftKey ? (up ? 0 : count - 1) : index + (up ? -1 : 1);
    if (to >= 0 && to < count && to !== index) onMove(index, to);
  };

  return (
    <li
      ref={setDropRef}
      data-testid={`backlog-${item.key}`}
      onKeyDown={onKeyDown}
      className={`group relative flex items-center gap-3 border-b border-edge px-2 py-2 last:border-b-0 ${
        isOver && !isDragging ? 'bg-raised' : ''
      }`}
    >
      <div
        ref={setNodeRef}
        style={
          transform ? { transform: `translate3d(0, ${transform.y}px, 0)`, zIndex: 10 } : undefined
        }
        className={`flex min-w-0 flex-1 items-center gap-3 ${
          isDragging ? 'rounded border border-edge-strong bg-panel shadow-lg' : ''
        }`}
      >
        {canEdit && (
          <button
            type="button"
            aria-label={`Drag ${item.key}`}
            className="cursor-grab text-muted hover:text-text active:cursor-grabbing"
            {...listeners}
            {...attributes}
            // Dragging is for the mouse; the keyboard uses Alt+arrows or the buttons.
            tabIndex={-1}
          >
            <GripVertical size={14} aria-hidden="true" />
          </button>
        )}
        <span className="w-7 shrink-0 text-right font-mono text-xs text-muted" aria-hidden="true">
          {index + 1}
        </span>
        <Link
          href={workspaceHref(slug, `/tickets/${item.key}`)}
          className="shrink-0 font-mono text-xs text-muted hover:text-text"
        >
          {item.key}
        </Link>
        <Link
          href={workspaceHref(slug, `/tickets/${item.key}`)}
          className="min-w-0 flex-1 truncate text-[13px] hover:underline"
        >
          {item.title}
        </Link>
        <span className="hidden w-32 shrink-0 md:block">
          <StatusBadge status={item.status} />
        </span>
        <span className="w-6 shrink-0">
          <PriorityMark priority={item.priority} maxRank={maxRank} compact />
        </span>
        <span className="w-14 shrink-0 text-right font-mono text-xs text-muted">
          {estimate ?? '—'}
        </span>
        <span className="shrink-0">
          <UserChip person={item.assignee} compact />
        </span>
        {cycles.length > 0 &&
          (canEdit ? (
            <select
              aria-label={`Cycle for ${item.key}`}
              value={item.cycleId ?? ''}
              disabled={busy}
              onChange={(event) => onCycle(event.target.value || null)}
              className={`${inputClass()} h-7 w-32 shrink-0 py-0 text-xs`}
            >
              <option value="">No cycle</option>
              {cycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.state === 'active' ? `${cycle.name} (now)` : cycle.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="w-32 shrink-0 truncate text-xs text-muted">
              {cycles.find((cycle) => cycle.id === item.cycleId)?.name ?? 'No cycle'}
            </span>
          ))}
      </div>
      {canEdit && (
        <span className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <MoveButton
            label={`Move ${item.key} to the top`}
            disabled={busy || index === 0}
            onClick={() => onMove(index, 0)}
          >
            <ChevronsUp size={14} aria-hidden="true" />
          </MoveButton>
          <MoveButton
            label={`Move ${item.key} up`}
            disabled={busy || index === 0}
            onClick={() => onMove(index, index - 1)}
          >
            <ArrowUp size={14} aria-hidden="true" />
          </MoveButton>
          <MoveButton
            label={`Move ${item.key} down`}
            disabled={busy || index === count - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <ArrowDown size={14} aria-hidden="true" />
          </MoveButton>
          <MoveButton
            label={`Move ${item.key} to the bottom`}
            disabled={busy || index === count - 1}
            onClick={() => onMove(index, count - 1)}
          >
            <ChevronsDown size={14} aria-hidden="true" />
          </MoveButton>
        </span>
      )}
    </li>
  );
}

/**
 * A project's open tickets in the order the team will take them. People who may edit drag rows,
 * use the buttons on a row, or Alt+↑/↓; each move asks the server for a rank between the new
 * neighbours, and goes back if it is refused.
 */
export function BacklogList({
  organisationId,
  slug,
  projectKey,
  backlog,
  maxRank,
  canEdit,
}: {
  organisationId: string;
  slug: string;
  projectKey: string;
  backlog: Backlog;
  maxRank: number;
  canEdit: boolean;
}) {
  const [items, setItems] = useState(backlog.items);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const list = useRef<HTMLOListElement>(null);
  // A stable id, so the drag library's screen-reader text matches between server and browser.
  const dndId = useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function move(from: number, to: number) {
    const item = items[from];
    if (!item || from === to) return;
    const before = items;
    const next = moveItem(items, from, to);
    setItems(next);
    setBusy(true);
    try {
      await apiFetch(`/api/v1/orgs/${organisationId}/tickets/${item.key}/rank`, {
        method: 'POST',
        json: placeFor(
          next.map((ticket) => ticket.key),
          to,
        ),
      });
      setAnnouncement(`${item.key} moved to position ${to + 1} of ${next.length}.`);
    } catch (error) {
      setItems(before);
      toast.error(error instanceof ApiRequestError ? error.message : `Could not move ${item.key}.`);
    } finally {
      setBusy(false);
      // Keep the keyboard on the moved row's controls.
      requestAnimationFrame(() => {
        list.current?.querySelector<HTMLElement>(`[data-testid="backlog-${item.key}"] a`)?.focus();
      });
    }
  }

  async function setCycle(item: BacklogItem, cycleId: string | null) {
    setBusy(true);
    try {
      const updated = await apiFetch<TicketDetail>(
        `/api/v1/orgs/${organisationId}/tickets/${item.key}`,
        { method: 'PATCH', json: { version: item.version, cycleId } },
      );
      setItems((current) =>
        current.map((ticket) =>
          ticket.id === item.id
            ? { ...ticket, cycleId: updated.cycle?.id ?? null, version: updated.version }
            : ticket,
        ),
      );
      const name = backlog.cycles.find((cycle) => cycle.id === cycleId)?.name;
      toast.success(name ? `${item.key} is in ${name}.` : `${item.key} is out of its cycle.`);
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : `Could not change ${item.key}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.key === active.id);
    const to = items.findIndex((item) => item.key === over.id);
    if (from >= 0 && to >= 0) void move(from, to);
  }

  const total = estimateTotal(backlog.estimation, items);

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-edge p-6 text-center text-[13px] text-muted">
        Nothing waiting in {projectKey}. New tickets land at the bottom of the backlog.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        <span className="font-mono text-text">{items.length}</span>{' '}
        {items.length === 1 ? 'ticket' : 'tickets'}
        {backlog.total > items.length && <> shown of {backlog.total}</>} ·{' '}
        <span className="font-mono text-text">{total.text}</span> estimated
        {total.missing > 0 && <> · {total.missing} without an estimate</>}
        {canEdit && (
          <span className="hidden sm:inline"> · Drag to reorder, or Alt+↑/↓ on a row</span>
        )}
      </p>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <ol
          ref={list}
          aria-label={`${projectKey} backlog, top first`}
          className="rounded-md border border-edge bg-panel"
        >
          {items.map((item, index) => (
            <Row
              key={item.id}
              item={item}
              index={index}
              count={items.length}
              slug={slug}
              estimation={backlog.estimation}
              maxRank={maxRank}
              canEdit={canEdit}
              busy={busy}
              onMove={(from, to) => void move(from, to)}
              cycles={backlog.cycles}
              onCycle={(cycleId) => void setCycle(item, cycleId)}
            />
          ))}
        </ol>
      </DndContext>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
