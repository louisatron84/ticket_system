'use client';

import {
  DEFAULT_CARD_FIELDS,
  type BoardDensity,
  type CardFields,
  type TicketSummary,
} from '@forge/shared';
import { useDraggable } from '@dnd-kit/core';
import { GripVertical, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { DueDate, PriorityMark, TypeBadge } from '@/components/tickets/badges';
import { LabelChips } from '@/components/tickets/label-chip';
import { UserChip } from '@/components/tickets/user-chip';
import { workspaceHref } from '@/lib/nav';
import { CardMenu, type CardMenuProps, type MoveTarget } from './card-menu';

type CardProps = {
  ticket: TicketSummary;
  slug: string;
  today: string;
  maxRank: number;
  /** Which optional parts to show. Key, title and assignee are always there. */
  fields?: CardFields;
  /** Compact packs cards tighter: a one-line title and no labels. */
  density?: BoardDensity;
};

/**
 * What a card shows: the key and priority, the number of comments, the title, up to two labels,
 * the due date, the type and the assignee. Each optional part can be switched off.
 */
export function CardBody({
  ticket,
  slug,
  today,
  maxRank,
  fields = DEFAULT_CARD_FIELDS,
  density = 'comfortable',
  handle,
  menu,
}: CardProps & { handle?: React.ReactNode; menu?: React.ReactNode }) {
  const done = ticket.status.category === 'completed';
  const showDue = fields.dueDate && ticket.dueDate !== null;
  const compact = density === 'compact';
  return (
    <div className={`flex min-w-0 flex-col ${compact ? 'gap-1' : 'gap-2'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {handle}
          <span className="font-mono text-xs text-muted">{ticket.key}</span>
          {fields.priority && <PriorityMark priority={ticket.priority} maxRank={maxRank} compact />}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {fields.comments && ticket.commentCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted"
              title={`${ticket.commentCount} ${ticket.commentCount === 1 ? 'comment' : 'comments'}`}
            >
              <MessageSquare size={12} aria-hidden="true" />
              <span className="font-mono">{ticket.commentCount}</span>
              <span className="sr-only">{ticket.commentCount === 1 ? 'comment' : 'comments'}</span>
            </span>
          )}
          {menu}
        </span>
      </div>
      <Link
        href={workspaceHref(slug, `/tickets/${ticket.key}`)}
        className={`${compact ? 'line-clamp-1' : 'line-clamp-3'} min-w-0 break-words text-[13px] font-medium leading-snug hover:underline`}
      >
        {ticket.title}
      </Link>
      {fields.labels && !compact && ticket.labels.length > 0 && (
        <LabelChips labels={ticket.labels} max={2} />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          {showDue && (
            <span className="min-w-0 text-xs">
              <DueDate date={ticket.dueDate} today={today} done={done} />
            </span>
          )}
          {fields.type && <TypeBadge type={ticket.type} iconOnly />}
        </span>
        <UserChip person={ticket.assignee} compact />
      </div>
    </div>
  );
}

const cardClass = (density: BoardDensity | undefined) =>
  `min-w-0 rounded-md border border-edge bg-panel ${density === 'compact' ? 'p-2' : 'p-3'}`;

/** A card that can be picked up. Dragging starts from the grip, so the title stays a normal link. */
export function DraggableCard({
  ticket,
  slug,
  today,
  maxRank,
  fields,
  density,
  canMove,
  targets,
  actions,
  busy,
  onMove,
}: CardProps & {
  /** May this person change this card (tickets.edit, project not archived). Without it there is no grip. */
  canMove: boolean;
  targets: MoveTarget[];
  /** What the card's menu needs besides the card itself. */
  actions: Pick<
    CardMenuProps,
    'organisationId' | 'priorities' | 'members' | 'viewerId' | 'canAssign' | 'canCreate'
  >;
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
      className={`${cardClass(density)} ${isDragging ? 'opacity-40' : ''}`}
      data-ticket={ticket.key}
    >
      <CardBody
        ticket={ticket}
        slug={slug}
        today={today}
        maxRank={maxRank}
        {...(fields ? { fields } : {})}
        {...(density ? { density } : {})}
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
          <CardMenu
            ticket={ticket}
            slug={slug}
            targets={targets}
            canChange={canMove}
            busy={busy}
            onMove={onMove}
            {...actions}
          />
        }
      />
    </li>
  );
}

/** The copy that follows the pointer while a card is being dragged. */
export function CardOverlay(props: CardProps) {
  return (
    <div
      className={`${cardClass(props.density)} w-72 cursor-grabbing border-edge-strong shadow-[0_14px_32px_rgba(0,0,0,0.55)]`}
    >
      <CardBody {...props} />
    </div>
  );
}
