'use client';

import type { Member, Priority, TicketSummary } from '@forge/shared';
import {
  Archive,
  ArrowRightLeft,
  ChevronLeft,
  Copy,
  CopyPlus,
  Ellipsis,
  Flag,
  Link as LinkIcon,
  UserMinus,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  ActionMenu,
  Item,
  useActionMenu,
  type ActionMenuState,
} from '@/components/tickets/action-menu';
import {
  AssigneeChoices,
  PriorityChoices,
  StatusChoices,
  type MoveTarget,
} from '@/components/tickets/ticket-choices';
import { useTicketActions } from '@/components/tickets/use-ticket-actions';
import { updateTicket } from '@/lib/ticket-actions';

export type { MoveTarget };

/** Where the focus goes when a card disappears under it: its column's "+", else the column. */
function focusColumn(button: HTMLElement) {
  const column = button.closest<HTMLElement>('section');
  return column?.querySelector<HTMLElement>('button[aria-label^="Add a ticket to"]') ?? column;
}

type View = 'actions' | 'move' | 'priority' | 'assign';

function Actions({
  ticket,
  organisationId,
  priorities,
  members,
  viewerId,
  targets,
  canChange,
  canAssign,
  canCreate,
  onMove,
  menu,
  actions,
}: CardMenuProps & {
  menu: ActionMenuState;
  actions: ReturnType<typeof useTicketActions>;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>('actions');
  const { key } = ticket;

  const move = (statusId: string) => {
    menu.close();
    menu.restoreFocus();
    onMove(statusId);
  };

  const setPriority = (priority: Priority) => {
    if (priority.id === ticket.priority.id) {
      menu.close();
      return menu.restoreFocus();
    }
    return actions.run(`Could not change the priority of ${key}.`, async () => {
      await updateTicket(organisationId, key, ticket.version, { priorityId: priority.id });
      router.refresh();
    });
  };

  const assign = (assigneeId: string | null) => {
    if (assigneeId === (ticket.assignee?.id ?? null)) {
      menu.close();
      return menu.restoreFocus();
    }
    return actions.run(`Could not ${assigneeId ? 'assign' : 'unassign'} ${key}.`, async () => {
      await updateTicket(organisationId, key, ticket.version, { assigneeId });
      router.refresh();
    });
  };

  if (view !== 'actions') {
    const back = (
      <button
        type="button"
        onClick={() => setView('actions')}
        className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs text-muted hover:bg-raised hover:text-text"
      >
        <ChevronLeft size={13} aria-hidden="true" />
        Back
      </button>
    );
    if (view === 'move') {
      return (
        <>
          {back}
          <StatusChoices ticketKey={key} targets={targets} onPick={move} />
        </>
      );
    }
    if (view === 'priority') {
      return (
        <>
          {back}
          <PriorityChoices
            ticketKey={key}
            priorities={priorities}
            currentId={ticket.priority.id}
            onPick={(priority) => void setPriority(priority)}
          />
        </>
      );
    }
    return (
      <>
        {back}
        <AssigneeChoices
          ticketKey={key}
          members={members ?? []}
          currentId={ticket.assignee?.id ?? null}
          onPick={(userId) => void assign(userId)}
        />
      </>
    );
  }

  const canMoveFromHere = canChange && targets.length > 0;
  const assigned = ticket.assignee !== null;
  const menuItems: { label: string; icon: ReactNode; onClick: () => void }[] = [
    ...(canMoveFromHere
      ? [
          {
            label: 'Move to…',
            icon: <ArrowRightLeft size={14} aria-hidden="true" />,
            onClick: () => setView('move'),
          },
        ]
      : []),
    ...(canChange && priorities.length > 1
      ? [
          {
            label: 'Priority…',
            icon: <Flag size={14} aria-hidden="true" />,
            onClick: () => setView('priority'),
          },
        ]
      : []),
    ...(canAssign && ticket.assignee?.id !== viewerId
      ? [
          {
            label: 'Assign to me',
            icon: <UserRound size={14} aria-hidden="true" />,
            onClick: () => void assign(viewerId),
          },
        ]
      : []),
    ...(canAssign && assigned
      ? [
          {
            label: 'Unassign',
            icon: <UserMinus size={14} aria-hidden="true" />,
            onClick: () => void assign(null),
          },
        ]
      : []),
    ...(canAssign && members !== null && members.length > 0
      ? [
          {
            label: 'Assign to…',
            icon: <UserPlus size={14} aria-hidden="true" />,
            onClick: () => setView('assign'),
          },
        ]
      : []),
    {
      label: 'Copy key',
      icon: <Copy size={14} aria-hidden="true" />,
      onClick: actions.copyKey,
    },
    {
      label: 'Copy link',
      icon: <LinkIcon size={14} aria-hidden="true" />,
      onClick: actions.copyLink,
    },
    ...(canCreate
      ? [
          {
            label: 'Duplicate',
            icon: <CopyPlus size={14} aria-hidden="true" />,
            onClick: actions.duplicate,
          },
        ]
      : []),
    ...(canChange
      ? [
          {
            label: 'Archive',
            icon: <Archive size={14} aria-hidden="true" />,
            onClick: actions.archive,
          },
        ]
      : []),
  ];

  return (
    <div role="group" aria-label={`${key} actions`}>
      {menuItems.map((item, index) => (
        <Item key={item.label} autoFocus={index === 0} icon={item.icon} onClick={item.onClick}>
          {item.label}
        </Item>
      ))}
    </div>
  );
}

export type CardMenuProps = {
  ticket: TicketSummary;
  slug: string;
  organisationId: string;
  priorities: Priority[];
  /** The workspace's members, for "Assign to…". Null when this person may not list them. */
  members: Member[] | null;
  /** Who is looking, for "Assign to me". */
  viewerId: string;
  /** The statuses the ticket's workflow lets it move to. */
  targets: MoveTarget[];
  /** May change this ticket: tickets.edit, on a project that is not archived. */
  canChange: boolean;
  /** May assign it (and change it). */
  canAssign: boolean;
  /** May make a copy of it. */
  canCreate: boolean;
  onMove: (statusId: string) => void;
};

/**
 * What can be done to a card without opening it: move it, change its priority or assignee, copy its
 * key or link, duplicate it, archive it. Anyone who can see the card can copy its key or link; the
 * rest appears only for the people the server would allow, and the server decides in the end.
 */
export function CardMenu({
  busy,
  ...props
}: CardMenuProps & {
  /** Another change is waiting for the server. */
  busy: boolean;
}) {
  const { ticket, slug, organisationId } = props;
  const menu = useActionMenu(ticket.key);
  const actions = useTicketActions({
    organisationId,
    slug,
    ticket: { key: ticket.key, archived: false },
    menu,
  });
  return (
    <ActionMenu
      menu={menu}
      label={`Actions for ${ticket.key}`}
      icon={<Ellipsis size={14} aria-hidden="true" />}
      size="sm"
      disabled={busy || actions.busy}
      focusFallback={focusColumn}
    >
      <Actions {...props} menu={menu} actions={actions} />
    </ActionMenu>
  );
}
