import { hasPermission } from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { TicketListView } from '@/components/tickets/ticket-list-view';
import { TicketsHeader } from '@/components/tickets/tickets-header';
import { NoAccess } from '@/components/workspace/no-access';
import { workspaceHref } from '@/lib/nav';
import { getViewer } from '@/lib/server/session';
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

  return (
    <div className="flex flex-col gap-5">
      <TicketsHeader membership={membership} />
      <TicketListView
        membership={membership}
        viewerUserId={viewer.user.id}
        searchParams={await searchParams}
        basePath={workspaceHref(membership.organisation.slug, '/tickets')}
      />
    </div>
  );
}
