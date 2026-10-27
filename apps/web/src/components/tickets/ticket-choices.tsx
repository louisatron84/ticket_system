'use client';

import type { Label, Member, Priority, StatusCategory } from '@forge/shared';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Item } from './action-menu';
import { StatusGlyph } from './badges';

// The short lists a ticket's menus choose from: where it can move, its priority, its assignee.
// A board card's menu and the list's cells both show these, so they read and behave the same.

export type MoveTarget = { id: string; key: string; name: string; category: StatusCategory };

/** A choice in a short list: what it is, with a tick on the one in force now. */
function Choice({
  current,
  autoFocus,
  icon,
  onClick,
  children,
}: {
  current: boolean;
  autoFocus: boolean;
  icon?: ReactNode;
  onClick: () => void;
  children: string;
}) {
  return (
    <Item
      current={current}
      autoFocus={autoFocus}
      onClick={onClick}
      icon={
        icon ?? (current ? <Check size={14} aria-hidden="true" /> : <span className="size-3.5" />)
      }
    >
      {children}
    </Item>
  );
}

/** The choice to focus when a list opens: the one in force now, else the first. */
const startAt = (currents: boolean[]) => Math.max(0, currents.indexOf(true));

export function StatusChoices({
  ticketKey,
  targets,
  onPick,
}: {
  ticketKey: string;
  targets: MoveTarget[];
  onPick: (statusId: string) => void;
}) {
  return (
    <div role="group" aria-label={`Move ${ticketKey} to`}>
      <p className="px-2 py-1 text-xs text-muted">Move to</p>
      {targets.map((target, index) => (
        <Choice
          key={target.id}
          current={false}
          autoFocus={index === 0}
          icon={<StatusGlyph category={target.category} statusKey={target.key} />}
          onClick={() => onPick(target.id)}
        >
          {target.name}
        </Choice>
      ))}
    </div>
  );
}

export function PriorityChoices({
  ticketKey,
  priorities,
  currentId,
  onPick,
}: {
  ticketKey: string;
  priorities: Priority[];
  currentId: string;
  onPick: (priority: Priority) => void;
}) {
  // Highest first, the way people think of "Blaze".
  const ordered = [...priorities].sort((a, b) => b.rank - a.rank);
  const first = startAt(ordered.map((priority) => priority.id === currentId));
  return (
    <div role="group" aria-label={`Priority for ${ticketKey}`}>
      <p className="px-2 py-1 text-xs text-muted">Priority</p>
      {ordered.map((priority, index) => (
        <Choice
          key={priority.id}
          current={priority.id === currentId}
          autoFocus={index === first}
          onClick={() => onPick(priority)}
        >
          {priority.name}
        </Choice>
      ))}
    </div>
  );
}

/**
 * The workspace's members to assign to. With `includeNone` the list starts with "Unassigned", for
 * places that have no separate Unassign action.
 */
export function AssigneeChoices({
  ticketKey,
  members,
  currentId,
  includeNone = false,
  onPick,
}: {
  ticketKey: string;
  members: Member[];
  currentId: string | null;
  includeNone?: boolean;
  onPick: (userId: string | null) => void;
}) {
  const choices = [
    ...(includeNone ? [{ id: null, name: 'Unassigned' }] : []),
    ...members.map((member) => ({ id: member.user.id, name: member.user.displayName })),
  ];
  const first = startAt(choices.map((choice) => choice.id === currentId));
  return (
    <div role="group" aria-label={`Assign ${ticketKey} to`}>
      <p className="px-2 py-1 text-xs text-muted">Assign to</p>
      {choices.map((choice, index) => (
        <Choice
          key={choice.id ?? 'none'}
          current={choice.id === currentId}
          autoFocus={index === first}
          onClick={() => onPick(choice.id)}
        >
          {choice.name}
        </Choice>
      ))}
    </div>
  );
}

/** The workspace's labels, for adding to or taking off several tickets at once. */
export function LabelChoices({
  label,
  labels,
  onPick,
}: {
  /** What the list is for, read out to screen readers ("Add label to selected"). */
  label: string;
  labels: Label[];
  onPick: (labelId: string) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      {labels.map((item, index) => (
        <Choice
          key={item.id}
          current={false}
          autoFocus={index === 0}
          onClick={() => onPick(item.id)}
        >
          {item.name}
        </Choice>
      ))}
    </div>
  );
}
