import type { Member, Priority, TicketFilters, TicketSummary, Workflow } from '@forge/shared';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { allowedStatuses, isMovable } from '@/lib/board';
import { workspaceHref } from '@/lib/nav';
import { hrefFor, sortedBy } from '@/lib/ticket-query';
import { formatRelativeTime } from '@/lib/tickets';
import { DueDate, PriorityMark, StatusBadge, TypeBadge } from './badges';
import { RowCheckbox, SelectAllCheckbox } from './bulk-selection';
import { AssigneeCell, PriorityCell, StatusCell } from './inline-cell-menu';
import { LabelChips } from './label-chip';
import { UserChip } from './user-chip';

/**
 * What the person may change straight from the list. Without it the list is read-only. A cell
 * becomes a menu only when there is something to choose: a status the workflow allows, more than
 * one priority, members to assign to.
 */
export type InlineEditing = {
  organisationId: string;
  workflows: Workflow[];
  priorities: Priority[];
  /** Null when the person may not assign, or may not see the member list to choose from. */
  members: Member[] | null;
  canEdit: boolean;
};

/** With editing, the table has a checkbox per row for bulk changes; it must sit in a BulkSelection. */

function SortHeader({
  label,
  sort,
  filters,
  basePath,
  scoped,
  className = '',
}: {
  label: string;
  sort: TicketFilters['sort'];
  filters: TicketFilters;
  basePath: string;
  scoped: boolean;
  className?: string;
}) {
  const current = filters.sort === sort;
  const Icon = !current ? ArrowUpDown : filters.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={current ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-2 font-medium ${className}`}
    >
      <Link
        href={hrefFor(basePath, sortedBy(filters, sort), { omitProject: scoped })}
        className={`inline-flex items-center gap-1 hover:text-text ${current ? 'text-text' : ''}`}
      >
        {label}
        <Icon size={12} aria-hidden="true" className={current ? '' : 'opacity-50'} />
      </Link>
    </th>
  );
}

/** The ticket list: one row per ticket, sortable by key, priority, due date and last update. */
export function TicketTable({
  items,
  filters,
  basePath,
  scoped,
  slug,
  today,
  now,
  maxRank,
  editing,
}: {
  items: TicketSummary[];
  filters: TicketFilters;
  basePath: string;
  scoped: boolean;
  slug: string;
  /** The server's calendar date and time, so the page reads the same once it is hydrated. */
  today: string;
  now: string;
  maxRank: number;
  editing?: InlineEditing;
}) {
  const header = { filters, basePath, scoped };
  // An archived project's tickets cannot change, so their cells stay plain.
  const editable = (ticket: TicketSummary) =>
    editing?.canEdit === true && isMovable(editing.workflows, ticket);
  return (
    <div className="overflow-x-auto rounded-md border border-edge bg-panel">
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">
          Tickets, {filters.dir === 'asc' ? 'ascending' : 'descending'} by {filters.sort}
        </caption>
        <thead>
          <tr className="border-b border-edge text-xs text-muted">
            {editing?.canEdit && (
              <th scope="col" className="w-8 py-2 pl-3">
                <SelectAllCheckbox keys={items.map((ticket) => ticket.key)} />
              </th>
            )}
            <SortHeader label="Key" sort="key" className="w-24" {...header} />
            <th scope="col" className="px-3 py-2 font-medium">
              Title
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <SortHeader
              label="Priority"
              sort="priority"
              className="hidden md:table-cell"
              {...header}
            />
            <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">
              Assignee
            </th>
            <SortHeader label="Due" sort="due" className="hidden lg:table-cell" {...header} />
            <SortHeader
              label="Updated"
              sort="updated"
              className="hidden xl:table-cell"
              {...header}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {items.map((ticket) => {
            const done = ticket.status.category === 'completed';
            const cell = editing && editable(ticket) ? { ticket, slug, ...editing } : null;
            const targets = cell ? allowedStatuses(cell.workflows, ticket) : [];
            return (
              <tr key={ticket.id} className="align-top hover:bg-raised/50">
                {editing?.canEdit && (
                  <td className="py-2.5 pl-3">
                    <RowCheckbox ticketKey={ticket.key} />
                  </td>
                )}
                <th scope="row" className="px-3 py-2.5 font-normal">
                  <span className="font-mono text-xs text-muted">{ticket.key}</span>
                </th>
                <td className="px-3 py-2.5">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 shrink-0" title={ticket.type.name}>
                      <TypeBadge type={ticket.type} iconOnly />
                    </span>
                    <div className="min-w-0">
                      <Link
                        href={workspaceHref(slug, `/tickets/${ticket.key}`)}
                        className="font-medium hover:underline"
                        data-row-link
                      >
                        {ticket.title}
                      </Link>
                      {ticket.labels.length > 0 && (
                        <div className="mt-1">
                          <LabelChips labels={ticket.labels} />
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {cell && targets.length > 0 ? (
                    <StatusCell
                      ticket={ticket}
                      organisationId={cell.organisationId}
                      slug={slug}
                      targets={targets}
                    />
                  ) : (
                    <StatusBadge status={ticket.status} />
                  )}
                </td>
                <td className="hidden px-3 py-2.5 md:table-cell">
                  {cell && cell.priorities.length > 1 ? (
                    <PriorityCell
                      ticket={ticket}
                      organisationId={cell.organisationId}
                      slug={slug}
                      priorities={cell.priorities}
                      maxRank={maxRank}
                    />
                  ) : (
                    <PriorityMark priority={ticket.priority} maxRank={maxRank} />
                  )}
                </td>
                <td className="hidden px-3 py-2.5 lg:table-cell">
                  {cell?.members && cell.members.length > 0 ? (
                    <AssigneeCell
                      ticket={ticket}
                      organisationId={cell.organisationId}
                      slug={slug}
                      members={cell.members}
                    />
                  ) : (
                    <UserChip person={ticket.assignee} />
                  )}
                </td>
                <td className="hidden px-3 py-2.5 lg:table-cell">
                  <DueDate date={ticket.dueDate} today={today} done={done} />
                </td>
                <td className="hidden px-3 py-2.5 text-muted xl:table-cell">
                  <time dateTime={ticket.updatedAt}>
                    {formatRelativeTime(ticket.updatedAt, now)}
                  </time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
