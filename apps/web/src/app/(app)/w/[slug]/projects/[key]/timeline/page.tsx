import { normalizeProjectKey, timelineSchema } from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { TimelineView } from '@/components/planning/timeline-view';
import { getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Timeline' };
export const dynamic = 'force-dynamic';

export default async function ProjectTimelinePage({
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
  const timeline = await serverGet(
    `/api/v1/orgs/${membership.organisation.id}/projects/${key}/timeline`,
    timelineSchema,
  );
  if (!timeline.ok) notFound();

  return (
    <TimelineView
      slug={membership.organisation.slug}
      projectKey={key}
      timeline={timeline.data}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}
