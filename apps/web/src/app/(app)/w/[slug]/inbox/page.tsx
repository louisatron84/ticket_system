import { hasPermission, notificationListSchema } from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { InboxList } from '@/components/notifications/inbox-list';
import { NoAccess } from '@/components/workspace/no-access';
import { getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const slug = workspaceSlugFromPath(`/w/${(await params).slug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!membership) notFound();
  if (!hasPermission(membership.permissions, 'tickets.view')) {
    return (
      <NoAccess
        what="the inbox"
        workspaceName={membership.organisation.name}
        roleName={membership.role.name}
      />
    );
  }
  const filter = (await searchParams).filter === 'unread' ? 'unread' : 'all';
  const list = await serverGet(
    `/api/v1/orgs/${membership.organisation.id}/notifications?filter=${filter}`,
    notificationListSchema,
  );
  if (!list.ok) notFound();

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-[13px] text-muted">
          What happened to tickets you are part of. Choose what reaches you in your{' '}
          <a href="/settings/profile#notifications" className="underline">
            profile
          </a>
          .
        </p>
      </header>
      <InboxList
        key={filter}
        organisationId={membership.organisation.id}
        slug={membership.organisation.slug}
        filter={filter}
        initial={list.data}
        now={new Date().toISOString()}
      />
    </div>
  );
}
