'use client';

import type { TicketSummary } from '@forge/shared';
import { useDraggable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import Link from 'next/link';
import { DueDate, PriorityMark, TypeBadge } from '@/components/tickets/badges';
import { LabelChips } from '@/components/tickets/label-chip';
import { UserChip } from '@/components/tickets/user-chip';
import { workspaceHref } from '@/lib/nav';
import { MoveMenu, type MoveTarget } from './move-menu';

type CardProps = {
  ticket: TicketSummary;
  slug: string;
  today: string;
  maxRank: number;
};

/** What a card shows: key, title, labels, priority, type, due date, assignee. */
export function CardBody({
  ticket,
  slug,
  today,
  maxRank,
  handle,
  menu,
}: CardProps & { handle?: React.ReactNode; menu?: React.ReactNode }) {
  const done = ticket.status.category === 'completed';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          {handle}
          <span className="font-mono text-xs text-muted">{ticket.key}</span>
        </span>
        {menu}
      </div>
      <Link
        href={workspaceHref(slug, `/tickets/${ticket.key}`)}
        className="line-clamp-3 break-words text-[13px] font-medium leading-snug hover:underline"
      >
        {ticket.title}
      </Link>
      {ticket.labels.length > 0 && <LabelChips labels={ticket.labels} max={2} />}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2.5">
          <PriorityMark priority={ticket.priority} maxRank={maxRank} compact />
          <TypeBadge type={ticket.type} iconOnly />
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {ticket.dueDate && (
            <span className="min-w-0 text-xs">
              <DueDate date={ticket.dueDate} today={today} done={done} />
            </span>
          )}
          <UserChip person={ticket.assignee} compact />
        </span>
      </div>
    </div>
  );
}

const CARD_CLASS = 'rounded-md border border-edge bg-panel p-3';

/** A card that can be picked up. Dragging starts from the grip, so the title stays a normal link. */
export function DraggableCard({
  ticket,
  slug,
  today,
  maxRank,
  canMove,
  targets,
  busy,
  onMove,
}: CardProps & {
  /** May this person move cards at all (tickets.edit). Without it there is no grip and no menu. */
  canMove: boolean;
  targets: MoveTarget[];
  /** Another move is waiting for the server. */
  busy: boolean;
  onMove: (statusId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: ticket.id,
    disabled: !canMove || busy,
  });

  return (
    <li
      ref={setNodeRef}
      className={`${CARD_CLASS} ${isDragging ? 'opacity-40' : ''}`}
      data-ticket={ticket.key}
    >
      <CardBody
        ticket={ticket}
        slug={slug}
        today={today}
        maxRank={maxRank}
        handle={
          canMove ? (
            <button
              type="button"
              aria-label={`Pick up ${ticket.key} to move it`}
              disabled={busy}
              // The grip is the activator: without registering it, dnd-kit ignores the keyboard,
              // because the key event's target is not the card itself.
              ref={setActivatorNodeRef}
              className="-ml-1 inline-flex size-6 cursor-grab touch-none items-center justify-center rounded text-muted hover:bg-raised hover:text-text active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
              {...attributes}
              {...listeners}
            >
              <GripVertical size={14} aria-hidden="true" />
            </button>
          ) : undefined
        }
        menu={
          canMove ? (
            <MoveMenu ticketKey={ticket.key} targets={targets} disabled={busy} onMove={onMove} />
          ) : undefined
        }
      />
    </li>
  );
}

/** The copy that follows the pointer while a card is being dragged. */
export function CardOverlay(props: CardProps) {
  return (
    <div
      className={`${CARD_CLASS} w-72 cursor-grabbing border-edge-strong shadow-[0_14px_32px_rgba(0,0,0,0.55)]`}
    >
      <CardBody {...props} />
    </div>
  );
}
