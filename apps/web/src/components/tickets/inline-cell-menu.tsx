'use client';

import type { Member, Priority, TicketSummary } from '@forge/shared';
import { useRouter } from 'next/navigation';
import { updateTicket } from '@/lib/ticket-actions';
import { ActionMenu, useActionMenu } from './action-menu';
import { PriorityMark, StatusBadge } from './badges';
import { AssigneeChoices, PriorityChoices, StatusChoices, type MoveTarget } from './ticket-choices';
import { useTicketActions } from './use-ticket-actions';
import { UserChip } from './user-chip';

// The list's Status, Priority and Assignee cells for people who may change them: each is the value
// itself, as a button that opens the same short list a board card's menu offers. People who may
// not change it get the plain value from the table instead.

type CellProps = { ticket: TicketSummary; organisationId: string; slug: string };

/** One cell's menu and the save behind it: one change, then the list is drawn again. */
function useCell({ ticket, organisationId, slug }: CellProps, field: string) {
  const router = useRouter();
  const menu = useActionMenu(`${ticket.key}:${field}`);
  const actions = useTicketActions({
    organisationId,
    slug,
    ticket: { key: ticket.key, archived: false },
    menu,
  });
  const save = (failure: string, change: Parameters<typeof updateTicket>[3]) =>
    actions.run(failure, async () => {
      await updateTicket(organisationId, ticket.key, ticket.version, change);
      router.refresh();
    });
  const unchanged = () => {
    menu.close();
    menu.restoreFocus();
  };
  return { menu, busy: actions.busy, save, unchanged };
}

export function StatusCell({ targets, ...props }: CellProps & { targets: MoveTarget[] }) {
  const { ticket } = props;
  const cell = useCell(props, 'status');
  return (
    <ActionMenu
      menu={cell.menu}
      label={`Change status of ${ticket.key}`}
      appearance="value"
      icon={<StatusBadge status={ticket.status} />}
      disabled={cell.busy}
    >
      <StatusChoices
        ticketKey={ticket.key}
        targets={targets}
        onPick={(statusId) => void cell.save(`Could not move ${ticket.key}.`, { statusId })}
      />
    </ActionMenu>
  );
}

export function PriorityCell({
  priorities,
  maxRank,
  ...props
}: CellProps & { priorities: Priority[]; maxRank: number }) {
  const { ticket } = props;
  const cell = useCell(props, 'priority');
  return (
    <ActionMenu
      menu={cell.menu}
      label={`Change priority of ${ticket.key}`}
      appearance="value"
      icon={<PriorityMark priority={ticket.priority} maxRank={maxRank} />}
      disabled={cell.busy}
    >
      <PriorityChoices
        ticketKey={ticket.key}
        priorities={priorities}
        currentId={ticket.priority.id}
        onPick={(priority) =>
          priority.id === ticket.priority.id
            ? cell.unchanged()
            : void cell.save(`Could not change the priority of ${ticket.key}.`, {
                priorityId: priority.id,
              })
        }
      />
    </ActionMenu>
  );
}

export function AssigneeCell({ members, ...props }: CellProps & { members: Member[] }) {
  const { ticket } = props;
  const cell = useCell(props, 'assignee');
  const currentId = ticket.assignee?.id ?? null;
  return (
    <ActionMenu
      menu={cell.menu}
      label={`Change assignee of ${ticket.key}`}
      appearance="value"
      icon={<UserChip person={ticket.assignee} />}
      disabled={cell.busy}
    >
      <AssigneeChoices
        ticketKey={ticket.key}
        members={members}
        currentId={currentId}
        includeNone
        onPick={(assigneeId) =>
          assigneeId === currentId
            ? cell.unchanged()
            : void cell.save(`Could not ${assigneeId ? 'assign' : 'unassign'} ${ticket.key}.`, {
                assigneeId,
              })
        }
      />
    </ActionMenu>
  );
}
