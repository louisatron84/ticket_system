import {
  backlogSchema,
  hasPermission,
  normalizeProjectKey,
  ticketConfigSchema,
} from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { BacklogList } from '@/components/planning/backlog-list';
import { getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Backlog' };
export const dynamic = 'force-dynamic';

export default async function ProjectBacklogPage({
  params,
}: {
  params: Promise<{ slug: string; key: string }>;
}) {
  const { slug: rawSlug, key: rawKey } = await params;
  const slug = workspaceSlugFromPath(`/w/${rawSlug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  const key = normalizeProjectKey(rawKey);
  if (!membership || !key) notFound();

  // The project layout has already checked the project exists and the person may see it.
  const api = `/api/v1/orgs/${membership.organisation.id}`;
  const [backlog, config] = await Promise.all([
    serverGet(`${api}/projects/${key}/backlog`, backlogSchema),
    serverGet(`${api}/ticket-config`, ticketConfigSchema),
  ]);
  if (!backlog.ok || !config.ok) notFound();
  const maxRank = Math.max(1, ...config.data.priorities.map((priority) => priority.rank));

  return (
    <BacklogList
      organisationId={membership.organisation.id}
      slug={membership.organisation.slug}
      projectKey={key}
      backlog={backlog.data}
      maxRank={maxRank}
      canEdit={!backlog.data.archived && hasPermission(membership.permissions, 'tickets.edit')}
    />
  );
}
