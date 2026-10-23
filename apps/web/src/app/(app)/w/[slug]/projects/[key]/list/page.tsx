import { normalizeProjectKey } from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { TicketListView } from '@/components/tickets/ticket-list-view';
import { workspaceHref } from '@/lib/nav';
import { getViewer } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'List' };
export const dynamic = 'force-dynamic';

export default async function ProjectListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug: rawSlug, key: rawKey } = await params;
  const slug = workspaceSlugFromPath(`/w/${rawSlug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  const key = normalizeProjectKey(rawKey);
  if (!membership || !key) notFound();

  // The project layout has already checked the project exists and the person may see it.
  return (
    <TicketListView
      membership={membership}
      viewerUserId={viewer.user.id}
      searchParams={await searchParams}
      basePath={workspaceHref(membership.organisation.slug, `/projects/${key}/list`)}
      scope={{ projectKey: key }}
    />
  );
}
