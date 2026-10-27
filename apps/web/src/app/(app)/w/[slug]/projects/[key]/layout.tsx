import { hasPermission, normalizeProjectKey, projectDetailSchema } from '@forge/shared';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ViewTabs } from '@/components/tickets/view-tabs';
import { NoAccess } from '@/components/workspace/no-access';
import { workspaceHref } from '@/lib/nav';
import { getViewer, serverGet } from '@/lib/server/session';
import { buttonClass } from '@/lib/ui';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string; key: string }>;
}) {
  const { slug: rawSlug, key: rawKey } = await params;
  const slug = workspaceSlugFromPath(`/w/${rawSlug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!membership) notFound();

  if (!hasPermission(membership.permissions, 'tickets.view')) {
    return (
      <NoAccess
        what="this project"
        workspaceName={membership.organisation.name}
        roleName={membership.role.name}
      />
    );
  }

  // A key that could never exist, and a project that is not here, look exactly alike.
  const key = normalizeProjectKey(rawKey);
  if (!key) notFound();
  const project = await serverGet(
    `/api/v1/orgs/${membership.organisation.id}/projects/${key}`,
    projectDetailSchema,
  );
  if (!project.ok) notFound();

  const base = workspaceHref(membership.organisation.slug, `/projects/${project.data.key}`);
  const canCreate = hasPermission(membership.permissions, 'tickets.create');

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1 inline-flex h-6 min-w-10 shrink-0 items-center justify-center rounded border border-edge-strong bg-raised px-1.5 font-mono text-xs font-medium">
            {project.data.key}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">
              {project.data.name}
              {project.data.archived && (
                <span className="ml-2 align-middle rounded border border-edge-strong px-1.5 py-0.5 text-[11px] font-normal text-muted">
                  Archived
                </span>
              )}
            </h1>
            {project.data.description && (
              <p className="mt-0.5 max-w-prose text-[13px] text-muted">
                {project.data.description}
              </p>
            )}
            <p className="mt-1 text-xs text-muted">
              <span className="font-mono text-text">{project.data.openCount}</span> open of{' '}
              <span className="font-mono text-text">{project.data.ticketCount}</span> tickets
            </p>
          </div>
        </div>
        {canCreate && !project.data.archived && (
          <Link
            href={workspaceHref(
              membership.organisation.slug,
              `/tickets/new?project=${project.data.key}`,
            )}
            className={buttonClass('primary')}
          >
            <Plus size={15} aria-hidden="true" />
            New ticket
          </Link>
        )}
      </header>

      <ViewTabs label="Project views" boardHref={`${base}/board`} listHref={`${base}/list`} />
      {children}
    </div>
  );
}
