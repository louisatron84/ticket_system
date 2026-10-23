import type { TicketFilters, TicketSummary } from '@forge/shared';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { workspaceHref } from '@/lib/nav';
import { hrefFor, sortedBy } from '@/lib/ticket-query';
import { formatRelativeTime } from '@/lib/tickets';
import { DueDate, PriorityMark, StatusBadge, TypeBadge } from './badges';
import { LabelChips } from './label-chip';
import { UserChip } from './user-chip';

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
}) {
  const header = { filters, basePath, scoped };
  return (
    <div className="overflow-x-auto rounded-md border border-edge bg-panel">
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">
          Tickets, {filters.dir === 'asc' ? 'ascending' : 'descending'} by {filters.sort}
        </caption>
        <thead>
          <tr className="border-b border-edge text-xs text-muted">
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
            return (
              <tr key={ticket.id} className="align-top hover:bg-raised/50">
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
                  <StatusBadge status={ticket.status} />
                </td>
                <td className="hidden px-3 py-2.5 md:table-cell">
                  <PriorityMark priority={ticket.priority} maxRank={maxRank} />
                </td>
                <td className="hidden px-3 py-2.5 lg:table-cell">
                  <UserChip person={ticket.assignee} />
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
