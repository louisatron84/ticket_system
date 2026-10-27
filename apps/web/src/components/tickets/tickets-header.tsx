import { hasPermission, type Membership } from '@forge/shared';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { workspaceHref } from '@/lib/nav';
import { buttonClass } from '@/lib/ui';
import { ViewTabs } from './view-tabs';

/** The top of the Tickets page, shared by its Board and List: title, New ticket and the tabs. */
export function TicketsHeader({ membership }: { membership: Membership }) {
  const slug = membership.organisation.slug;
  const canCreate = hasPermission(membership.permissions, 'tickets.create');

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tickets</h1>
          <p className="mt-1 max-w-prose text-[13px] text-muted">
            Every ticket in {membership.organisation.name}. Filters live in the address, so you can
            bookmark or share exactly what you are looking at.
          </p>
        </div>
        {canCreate && (
          <Link href={workspaceHref(slug, '/tickets/new')} className={buttonClass('primary')}>
            <Plus size={15} aria-hidden="true" />
            New ticket
          </Link>
        )}
      </header>
      <ViewTabs
        label="Ticket views"
        boardHref={workspaceHref(slug, '/tickets/board')}
        listHref={workspaceHref(slug, '/tickets')}
      />
    </>
  );
}
