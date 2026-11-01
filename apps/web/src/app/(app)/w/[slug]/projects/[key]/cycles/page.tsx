import { hasPermission, cycleListSchema, normalizeProjectKey } from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { CyclesView } from '@/components/planning/cycles-view';
import { getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Cycles' };
export const dynamic = 'force-dynamic';

export default async function ProjectCyclesPage({
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
  const cycles = await serverGet(
    `/api/v1/orgs/${membership.organisation.id}/projects/${key}/cycles`,
    cycleListSchema,
  );
  if (!cycles.ok) notFound();

  return (
    <CyclesView
      organisationId={membership.organisation.id}
      slug={membership.organisation.slug}
      projectKey={key}
      initial={cycles.data}
      canEdit={hasPermission(membership.permissions, 'tickets.edit')}
    />
  );
}
