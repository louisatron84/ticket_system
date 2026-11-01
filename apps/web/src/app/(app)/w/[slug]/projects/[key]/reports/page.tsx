import { normalizeProjectKey, reportsSchema } from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ReportsView } from '@/components/planning/reports-view';
import { getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function ProjectReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; key: string }>;
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const { slug: rawSlug, key: rawKey } = await params;
  const slug = workspaceSlugFromPath(`/w/${rawSlug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  const key = normalizeProjectKey(rawKey);
  if (!membership || !key) notFound();
  // Only the two ranges there are; anything else shows the default.
  const days = (await searchParams).days === '90' ? 90 : 30;

  // The project layout has already checked the project exists and the person may see it.
  const reports = await serverGet(
    `/api/v1/orgs/${membership.organisation.id}/projects/${key}/reports?days=${days}`,
    reportsSchema,
  );
  if (!reports.ok) notFound();

  return (
    <ReportsView slug={membership.organisation.slug} projectKey={key} reports={reports.data} />
  );
}
