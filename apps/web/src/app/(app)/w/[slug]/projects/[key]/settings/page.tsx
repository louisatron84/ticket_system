import { hasPermission, normalizeProjectKey, projectDetailSchema } from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { BlockerSetting } from '@/components/projects/blocker-setting';
import { getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function ProjectSettingsPage({
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
  // Settings are for people who may manage projects; to anyone else the page does not exist.
  if (!hasPermission(membership.permissions, 'projects.manage')) notFound();

  const project = await serverGet(
    `/api/v1/orgs/${membership.organisation.id}/projects/${key}`,
    projectDetailSchema,
  );
  if (!project.ok) notFound();

  return (
    <section aria-labelledby="rules-heading" className="flex flex-col gap-3">
      <h2 id="rules-heading" className="text-[13px] font-semibold">
        Rules
      </h2>
      <BlockerSetting
        organisationId={membership.organisation.id}
        projectKey={project.data.key}
        initial={project.data.blockersStopCompletion}
      />
    </section>
  );
}
