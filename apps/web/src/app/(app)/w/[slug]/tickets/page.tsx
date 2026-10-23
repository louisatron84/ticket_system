import { hasPermission } from '@forge/shared';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { TicketListView } from '@/components/tickets/ticket-list-view';
import { NoAccess } from '@/components/workspace/no-access';
import { workspaceHref } from '@/lib/nav';
import { getViewer } from '@/lib/server/session';
import { buttonClass } from '@/lib/ui';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Tickets' };
export const dynamic = 'force-dynamic';

export default async function TicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const slug = workspaceSlugFromPath(`/w/${(await params).slug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!membership) notFound();

  if (!hasPermission(membership.permissions, 'tickets.view')) {
    return (
      <NoAccess
        what="tickets"
        workspaceName={membership.organisation.name}
        roleName={membership.role.name}
      />
    );
  }

  const canCreate = hasPermission(membership.permissions, 'tickets.create');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tickets</h1>
          <p className="mt-1 max-w-prose text-[13px] text-muted">
            Every ticket in {membership.organisation.name}. Filters live in the address, so you can
            bookmark or share exactly what you are looking at.
          </p>
        </div>
        {canCreate && (
          <Link
            href={workspaceHref(membership.organisation.slug, '/tickets/new')}
            className={buttonClass('primary')}
          >
            <Plus size={15} aria-hidden="true" />
            New ticket
          </Link>
        )}
      </header>

      <TicketListView
        membership={membership}
        viewerUserId={viewer.user.id}
        searchParams={await searchParams}
        basePath={workspaceHref(membership.organisation.slug, '/tickets')}
      />
    </div>
  );
}
