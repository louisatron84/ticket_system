'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import type { Board as BoardData, TicketDetail, TicketFilters, TicketSummary } from '@forge/shared';
import { useRouter } from 'next/navigation';
import { useReducer, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { allowedTargets, boardReducer, canDrop } from '@/lib/board';
import { workspaceHref } from '@/lib/nav';
import { hrefFor } from '@/lib/ticket-query';
import { CardOverlay, DraggableCard } from './card';
import { BoardColumn, type DropState } from './column';
import type { MoveTarget } from './move-menu';

type Transition = { fromStatusId: string; toStatusId: string };

/**
 * Which column a card is over. With a mouse or finger it is exactly the column under the pointer,
 * which is what people mean: the default (most overlap with the dragged card) picks the neighbour
 * whenever the card hangs off to one side of the pointer, and falling back to it when the pointer
 * is over a column that refuses would drop the card somewhere the pointer is not. A keyboard has
 * no pointer, so it uses overlap, which is exact because the jump below centres the card on a column.
 */
const columnUnderPointer: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);

/**
 * Left and right jump from one status to the next one that will take the card, so a keyboard user
 * can pick a card up with Space, choose a column with the arrow keys and drop it with Space.
 * Columns that refuse the card are not enabled, so they are skipped.
 */
const columnJump: KeyboardCoordinateGetter = (
  event,
  { context: { droppableRects, droppableContainers, collisionRect } },
) => {
  const right = event.code === KeyboardCode.Right;
  const left = event.code === KeyboardCode.Left;
  if (!right && !left) return undefined;
  event.preventDefault();
  if (!collisionRect) return undefined;

  const centre = collisionRect.left + collisionRect.width / 2;
  const columns = droppableContainers
    .getEnabled()
    .filter((container) => container.data.current?.accepts === true)
    .map((container) => droppableRects.get(container.id))
    .filter((rect): rect is NonNullable<typeof rect> => rect !== undefined)
    .map((rect) => ({ rect, x: rect.left + rect.width / 2 }))
    .sort((a, b) => a.x - b.x);
  const next = right
    ? columns.find((column) => column.x > centre + 1)
    : [...columns].reverse().find((column) => column.x < centre - 1);
  if (!next) return undefined;

  return { x: next.rect.left + (next.rect.width - collisionRect.width) / 2, y: next.rect.top };
};

/**
 * A project's board. Cards move the instant they are dropped and move back, with a message, if
 * the server refuses. People who may not edit tickets get no grips and no menus.
 */
export function Board({
  initial,
  organisationId,
  slug,
  projectKey,
  transitions,
  canMove,
  today,
  maxRank,
  filters,
}: {
  initial: BoardData;
  organisationId: string;
  slug: string;
  projectKey: string;
  transitions: Transition[];
  canMove: boolean;
  today: string;
  maxRank: number;
  filters: TicketFilters;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(boardReducer, { board: initial, pending: null });
  const [activeId, setActiveId] = useState<string | null>(null);

  // A fresh board from the server (after a refresh) replaces what is on screen.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    dispatch({ type: 'replaced', board: initial });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnJump }),
  );

  const all = state.board.columns.flatMap((column) => column.tickets);
  const find = (id: string | number): TicketSummary | undefined =>
    all.find((ticket) => ticket.id === id);
  const statusName = (id: string | number) =>
    state.board.columns.find((column) => column.status.id === id)?.status.name ?? 'that status';

  const active = activeId ? find(activeId) : undefined;
  const activeTargets = active ? allowedTargets(transitions, active.status.id) : [];

  const dropStateOf = (statusId: string): DropState => {
    if (!active) return 'idle';
    if (statusId === active.status.id) return 'current';
    return canDrop(activeTargets, statusId) ? 'accepts' : 'refuses';
  };

  const targetsFor = (ticket: TicketSummary): MoveTarget[] =>
    allowedTargets(transitions, ticket.status.id).flatMap((statusId) => {
      const status = state.board.columns.find((column) => column.status.id === statusId)?.status;
      return status
        ? [{ id: status.id, key: status.key, name: status.name, category: status.category }]
        : [];
    });

  async function move(ticket: TicketSummary, toStatusId: string) {
    if (!canMove || state.pending) return;
    // Dropped back where it came from: nothing to do, nothing to say.
    if (toStatusId === ticket.status.id) return;
    if (!canDrop(allowedTargets(transitions, ticket.status.id), toStatusId)) {
      toast.error(
        `${ticket.key} cannot move from ${ticket.status.name} to ${statusName(toStatusId)}.`,
      );
      return;
    }

    dispatch({ type: 'moved', ticketId: ticket.id, toStatusId });
    try {
      const saved = await apiFetch<TicketDetail>(
        `/api/v1/orgs/${organisationId}/tickets/${ticket.key}`,
        { method: 'PATCH', json: { version: ticket.version, statusId: toStatusId } },
      );
      dispatch({ type: 'saved', ticketId: ticket.id, version: saved.version });
      router.refresh();
    } catch (failure) {
      dispatch({ type: 'rejected' });
      const message =
        failure instanceof ApiRequestError ? failure.message : `Could not move ${ticket.key}.`;
      toast.error(message);
      // Someone else changed it first: show what it is now.
      if (failure instanceof ApiRequestError && failure.status === 409) router.refresh();
    }
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const ticket = find(event.active.id);
    if (ticket && event.over) void move(ticket, String(event.over.id));
  }

  const announcements: Announcements = {
    onDragStart: ({ active: dragged }) => {
      const ticket = find(dragged.id);
      return ticket
        ? `Picked up ${ticket.key}, ${ticket.title}, from ${ticket.status.name}.`
        : undefined;
    },
    onDragOver: ({ active: dragged, over }) => {
      const ticket = find(dragged.id);
      if (!ticket) return undefined;
      return over
        ? `${ticket.key} is over ${statusName(over.id)}.`
        : `${ticket.key} is not over a status it can move to.`;
    },
    onDragEnd: ({ active: dragged, over }) => {
      const ticket = find(dragged.id);
      if (!ticket) return undefined;
      return over
        ? `${ticket.key} dropped on ${statusName(over.id)}.`
        : `${ticket.key} was not moved.`;
    },
    onDragCancel: ({ active: dragged }) => {
      const ticket = find(dragged.id);
      return ticket ? `Cancelled. ${ticket.key} was not moved.` : undefined;
    },
  };

  const listBase = workspaceHref(slug, `/projects/${projectKey}/list`);

  return (
    <DndContext
      // A fixed id keeps the server's and the browser's generated accessibility ids the same.
      id={`board-${projectKey}`}
      sensors={sensors}
      collisionDetection={columnUnderPointer}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To move a card, focus its grip and press Space. Then press the left or right arrow to choose a status and Space again to drop it. Press Escape to cancel.',
        },
      }}
    >
      {/*
        `relative` matters: the screen-reader-only text inside every card is absolutely positioned,
        and without a positioned ancestor here it escapes this scroller's clipping and widens the
        whole page, which then scrolls sideways while a card is dragged.
      */}
      <div className="relative -mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
        <div className="flex items-start gap-3">
          {state.board.columns.map((column) => (
            <BoardColumn
              key={column.status.id}
              column={column}
              dropState={dropStateOf(column.status.id)}
              draggedFrom={active?.status.name ?? null}
              seeAllHref={hrefFor(
                listBase,
                { ...filters, statusKey: [column.status.key], statusCategory: [], page: 1 },
                { omitProject: true },
              )}
            >
              {column.tickets.map((ticket) => (
                <DraggableCard
                  key={ticket.id}
                  ticket={ticket}
                  slug={slug}
                  today={today}
                  maxRank={maxRank}
                  canMove={canMove}
                  targets={targetsFor(ticket)}
                  busy={state.pending !== null}
                  onMove={(statusId) => void move(ticket, statusId)}
                />
              ))}
            </BoardColumn>
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {active ? (
          <CardOverlay ticket={active} slug={slug} today={today} maxRank={maxRank} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
