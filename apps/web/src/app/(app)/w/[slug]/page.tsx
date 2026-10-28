import {
  PERMISSIONS,
  PERMISSION_LABELS,
  hasPermission,
  workspaceDetailSchema,
} from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { SystemStatus } from '@/components/status/system-status';
import { NoAccess } from '@/components/workspace/no-access';
import { fetchReadiness } from '@/lib/api';
import { apiBaseUrl, getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

export default async function WorkspaceOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = workspaceSlugFromPath(`/w/${(await params).slug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!membership) notFound();

  const noAccess = (
    <NoAccess
      what="this workspace"
      workspaceName={membership.organisation.name}
      roleName={membership.role.name}
    />
  );
  if (!hasPermission(membership.permissions, 'workspace.view')) return noAccess;

  const detail = await serverGet(
    `/api/v1/orgs/${membership.organisation.id}`,
    workspaceDetailSchema,
  );
  if (!detail.ok) return noAccess;

  const status = await fetchReadiness(apiBaseUrl());
  const { organisation, memberCount, role } = detail.data;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{organisation.name}</h1>
        <p className="mt-1 text-[13px] text-muted">
          Your role: <span className="text-text">{role.name}</span>
          {'  '}
          <span aria-hidden="true">/</span> {memberCount} {memberCount === 1 ? 'member' : 'members'}
        </p>
      </header>

      <section aria-labelledby="access-title">
        <h2 id="access-title" className="mb-3 text-base font-semibold">
          What your role allows here
        </h2>
        {membership.permissions.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing. Your role has no permissions.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
            {PERMISSIONS.filter((permission) => membership.permissions.includes(permission)).map(
              (permission) => (
                <li key={permission} className="text-muted" title={permission}>
                  {PERMISSION_LABELS[permission]}
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <SystemStatus result={status} checkedAt={new Date()} />
    </div>
  );
}
