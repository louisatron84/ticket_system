import { hasPermission, projectSchema } from '@forge/shared';
import { FolderKanban } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { ProjectsTable } from '@/components/projects/projects-table';
import { EmptyState } from '@/components/tickets/empty-state';
import { NoAccess } from '@/components/workspace/no-access';
import { getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';

export default async function ProjectsPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = workspaceSlugFromPath(`/w/${(await params).slug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!membership) notFound();

  const noAccess = (
    <NoAccess
      what="projects"
      workspaceName={membership.organisation.name}
      roleName={membership.role.name}
    />
  );
  if (!hasPermission(membership.permissions, 'tickets.view')) return noAccess;

  const projects = await serverGet(
    `/api/v1/orgs/${membership.organisation.id}/projects`,
    projectSchema.array(),
  );
  if (!projects.ok) return noAccess;

  const canCreate = hasPermission(membership.permissions, 'projects.manage');
  const create = canCreate ? (
    <CreateProjectDialog
      organisationId={membership.organisation.id}
      slug={membership.organisation.slug}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 max-w-prose text-[13px] text-muted">
            Each project has its own key and its own workflow. Open one to see its board.
          </p>
        </div>
        {projects.data.length > 0 && create}
      </header>

      {projects.data.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          action={
            canCreate ? (
              <CreateProjectDialog
                organisationId={membership.organisation.id}
                slug={membership.organisation.slug}
              />
            ) : undefined
          }
        >
          {canCreate
            ? 'Create a project to start tracking tickets. Each one gets a short key, such as WEB, that its tickets are numbered with.'
            : 'No projects yet. Ask an owner or administrator to create one.'}
        </EmptyState>
      ) : (
        <ProjectsTable slug={membership.organisation.slug} projects={projects.data} />
      )}
    </div>
  );
}
