import { hasPermission, milestoneListSchema, normalizeProjectKey } from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { MilestonesView } from '@/components/planning/milestones-view';
import { getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Milestones' };
export const dynamic = 'force-dynamic';

export default async function ProjectMilestonesPage({
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
  const milestones = await serverGet(
    `/api/v1/orgs/${membership.organisation.id}/projects/${key}/milestones`,
    milestoneListSchema,
  );
  if (!milestones.ok) notFound();

  return (
    <MilestonesView
      organisationId={membership.organisation.id}
      slug={membership.organisation.slug}
      projectKey={key}
      initial={milestones.data}
      today={new Date().toISOString().slice(0, 10)}
      canEdit={hasPermission(membership.permissions, 'tickets.edit')}
    />
  );
}
