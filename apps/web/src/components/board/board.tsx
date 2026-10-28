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
import type {
  Member,
  TicketConfig,
  TicketDetail,
  TicketFilters,
  TicketSummary,
  Workflow,
} from '@forge/shared';
import { useRouter } from 'next/navigation';
import { useReducer, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  allowedStatuses,
  boardReducer,
  canMoveTo,
  dropId,
  fitsLane,
  isMovable,
  lanesOf,
  parseDropId,
  topLevelOnly,
  type BoardColumnData,
  type BoardData,
  type StatusRef,
} from '@/lib/board';
import { arrangeColumns } from '@/lib/board-columns';
import { defaultTypeAndPriority } from '@/lib/ticket-actions';
import { hrefFor } from '@/lib/ticket-query';
import { CardOverlay, DraggableCard } from './card';
import { BoardColumn, type DropState } from './column';
import { useBoardPrefs } from './prefs-provider';

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
 * A board: one project's, or every project's on the Tickets page. Columns are status keys; a card
 * moves under its own project's workflow. Cards move the instant they are dropped and move back,
 * with a message, if the server refuses. People who may not edit tickets get no grips and a menu of
 * copies only, and so do tickets of an archived project. A column's "+" makes a ticket in that
 * status with the default type and priority.
 */
export function Board({
  initial,
  workflows,
  organisationId,
  slug,
  canMove,
  today,
  maxRank,
  filters,
  listBase,
  scoped,
  dndId,
  config,
  members,
  viewerId,
  canCreate,
  canAssign,
  projects,
}: {
  initial: BoardData;
  /** The workflow of every project whose tickets can be on this board. */
  workflows: Workflow[];
  organisationId: string;
  slug: string;
  canMove: boolean;
  today: string;
  maxRank: number;
  filters: TicketFilters;
  /** The list a column's "See all" link opens. */
  listBase: string;
  /** True on a project's board, where the address names the project. */
  scoped: boolean;
  /** A fixed id keeps the server's and the browser's generated accessibility ids the same. */
  dndId: string;
  config: TicketConfig;
  /** For "Assign to…". Null when this person may not list the workspace's members. */
  members: Member[] | null;
  /** Who is looking, for "Assign to me". */
  viewerId: string;
  canCreate: boolean;
  canAssign: boolean;
  /** The projects a ticket can be made in: all of them on the Tickets board, one on a project's. */
  projects: { key: string; name: string; archived: boolean }[];
}) {
  const router = useRouter();
  const { display, columnPrefs } = useBoardPrefs();
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

  // Only the columns this person has chosen to see. "Move to" still offers every status.
  const board = display.show === 'top' ? topLevelOnly(state.board) : state.board;
  const { shown } = arrangeColumns(board.columns, columnPrefs);
  const shownKeys = new Set(shown.map((column) => column.status.key));
  // Lanes only make sense where several projects share the board.
  const lanes = display.lanes === 'project' && !scoped ? lanesOf(shown) : null;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const all = state.board.columns.flatMap((column) => column.tickets);
  const find = (id: string | number): TicketSummary | undefined =>
    all.find((ticket) => ticket.id === id);
  const statusName = (id: string | number) => {
    const { statusKey } = parseDropId(String(id));
    return (
      state.board.columns.find((column) => column.status.key === statusKey)?.status.name ??
      'that status'
    );
  };

  const active = activeId ? find(activeId) : undefined;

  const dropStateOf = (key: string, laneKey: string | null): DropState => {
    if (!active) return 'idle';
    if (!fitsLane(active, laneKey)) return 'refuses';
    if (key === active.status.key) return 'current';
    return canMoveTo(workflows, active, key) ? 'accepts' : 'refuses';
  };

  async function move(ticket: TicketSummary, toKey: string) {
    if (!canMove || state.pending) return;
    // Dropped back where it came from: nothing to do, nothing to say.
    if (toKey === ticket.status.key) return;
    const target: StatusRef | null = canMoveTo(workflows, ticket, toKey);
    if (!target) {
      toast.error(`${ticket.key} cannot move from ${ticket.status.name} to ${statusName(toKey)}.`);
      return;
    }

    dispatch({ type: 'moved', ticketId: ticket.id, toKey, status: target });
    try {
      const saved = await apiFetch<TicketDetail>(
        `/api/v1/orgs/${organisationId}/tickets/${ticket.key}`,
        { method: 'PATCH', json: { version: ticket.version, statusId: target.id } },
      );
      dispatch({ type: 'saved', ticketId: ticket.id, version: saved.version });
      if (!shownKeys.has(toKey)) {
        toast(`${ticket.key} moved to ${target.name}, which is hidden on your board.`);
      }
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

  /** The projects with this status that are open for new tickets. */
  const projectsFor = (statusKey: string) =>
    projects.filter(
      (project) =>
        !project.archived &&
        workflows.some(
          (workflow) =>
            workflow.projectKey === project.key &&
            !workflow.archived &&
            workflow.statuses.some((status) => status.key === statusKey),
        ),
    );

  // The filter names one project: that is the one the person means.
  const onlyFiltered = filters.project.length === 1 ? filters.project[0]! : null;

  async function quickCreate(statusKey: string, title: string, projectKey: string) {
    const status = workflows
      .find((workflow) => workflow.projectKey === projectKey)
      ?.statuses.find((candidate) => candidate.key === statusKey);
    const { typeId, priorityId } = defaultTypeAndPriority(config);
    if (!status || typeId === '' || priorityId === '') {
      toast.error(`Could not add a ticket to ${statusName(statusKey)}.`);
      return false;
    }
    try {
      const created = await apiFetch<TicketDetail>(
        `/api/v1/orgs/${organisationId}/projects/${projectKey}/tickets`,
        { method: 'POST', json: { title, typeId, priorityId, statusId: status.id } },
      );
      toast.success(`Created ${created.key}.`);
      router.refresh();
      return true;
    } catch (failure) {
      toast.error(
        failure instanceof ApiRequestError ? failure.message : 'Could not create the ticket.',
      );
      return false;
    }
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const ticket = find(event.active.id);
    if (!ticket || !event.over) return;
    const { statusKey, laneKey } = parseDropId(String(event.over.id));
    if (!fitsLane(ticket, laneKey)) {
      toast.error(
        `${ticket.key} belongs to ${ticket.project.key}, so it stays in that project's lane.`,
      );
      return;
    }
    void move(ticket, statusKey);
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

  const renderColumn = (column: BoardColumnData, laneKey: string | null) => {
    const choices = canCreate
      ? projectsFor(column.status.key).filter((project) => !laneKey || project.key === laneKey)
      : [];
    const defaultProject =
      choices.find((project) => project.key === onlyFiltered)?.key ??
      (choices.length === 1 && (scoped || laneKey) ? choices[0]!.key : '');
    return (
      <BoardColumn
        key={dropId(column.status.key, laneKey ?? undefined)}
        column={column}
        dropId={dropId(column.status.key, laneKey ?? undefined)}
        dropState={dropStateOf(column.status.key, laneKey)}
        heat={display.heat}
        {...(choices.length > 0
          ? {
              onQuickCreate: (title: string, projectKey: string) =>
                quickCreate(column.status.key, title, projectKey),
              projectChoices: choices,
              defaultProject,
              askProject: !scoped && !laneKey,
            }
          : {})}
        draggedFrom={active?.status.name ?? null}
        seeAllHref={hrefFor(
          listBase,
          { ...filters, statusKey: [column.status.key], statusCategory: [], page: 1 },
          { omitProject: scoped },
        )}
      >
        {column.tickets.map((ticket) => {
          const targets = allowedStatuses(workflows, ticket);
          const movable = isMovable(workflows, ticket);
          return (
            <DraggableCard
              key={ticket.id}
              ticket={ticket}
              slug={slug}
              today={today}
              maxRank={maxRank}
              fields={display.fields}
              density={display.density}
              canMove={canMove && movable}
              targets={targets}
              actions={{
                organisationId,
                priorities: config.priorities,
                members,
                viewerId,
                canAssign: canAssign && movable,
                canCreate: canCreate && movable,
              }}
              busy={state.pending !== null}
              onMove={(statusId) => {
                const target = targets.find((status) => status.id === statusId);
                if (target) void move(ticket, target.key);
              }}
            />
          );
        })}
      </BoardColumn>
    );
  };

  return (
    <DndContext
      id={dndId}
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
      <div
        data-density={display.density}
        className="relative -mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8"
      >
        {state.board.columns.length === 0 ? (
          // Only the Tickets board can have no columns: no projects yet, or a filter matching none.
          <p className="rounded-md border border-edge px-4 py-6 text-[13px] text-muted">
            No project’s statuses to show. Create a project, or clear the Project filter.
          </p>
        ) : shown.length === 0 ? (
          <p className="rounded-md border border-edge px-4 py-6 text-[13px] text-muted">
            Every column is hidden. Open Display to show some.
          </p>
        ) : lanes ? (
          <div className="flex flex-col gap-4">
            {lanes.map((lane) => {
              const open = !collapsed.has(lane.project.key);
              return (
                <section
                  key={lane.project.key}
                  aria-label={`${lane.project.key} lane, ${lane.total} ${lane.total === 1 ? 'ticket' : 'tickets'}`}
                  className="flex flex-col gap-2"
                >
                  <h2 className="text-[13px] font-semibold">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (open) next.add(lane.project.key);
                          else next.delete(lane.project.key);
                          return next;
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded px-1 hover:bg-raised"
                    >
                      {open ? (
                        <ChevronDown size={14} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={14} aria-hidden="true" />
                      )}
                      <span className="font-mono text-xs text-muted">{lane.project.key}</span>
                      {lane.project.name}
                      <span className="font-mono text-xs font-normal text-muted">{lane.total}</span>
                    </button>
                  </h2>
                  {open && (
                    <div className="flex items-start gap-3">
                      {lane.columns.map((column) => renderColumn(column, lane.project.key))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="flex items-start gap-3">
            {shown.map((column) => renderColumn(column, null))}
          </div>
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {active ? (
          <CardOverlay
            ticket={active}
            slug={slug}
            today={today}
            maxRank={maxRank}
            fields={display.fields}
            density={display.density}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
