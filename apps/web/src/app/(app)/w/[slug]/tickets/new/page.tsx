import { hasPermission, memberSchema, projectSchema, ticketConfigSchema } from '@forge/shared';
import { FolderKanban } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { EmptyState } from '@/components/tickets/empty-state';
import { TicketForm } from '@/components/tickets/ticket-form';
import { NoAccess } from '@/components/workspace/no-access';
import { getViewer, serverGet } from '@/lib/server/session';
import { fieldPermissions } from '@/lib/ticket-form';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'New ticket' };
export const dynamic = 'force-dynamic';

export default async function NewTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const slug = workspaceSlugFromPath(`/w/${(await params).slug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!membership) notFound();

  const permissions = fieldPermissions(membership.permissions);
  if (!hasPermission(membership.permissions, 'tickets.view') || !permissions.canCreate) {
    return (
      <NoAccess
        what="creating tickets"
        workspaceName={membership.organisation.name}
        roleName={membership.role.name}
      />
    );
  }

  const api = `/api/v1/orgs/${membership.organisation.id}`;
  const [projects, config, members] = await Promise.all([
    serverGet(`${api}/projects`, projectSchema.array()),
    serverGet(`${api}/ticket-config`, ticketConfigSchema),
    permissions.canAssign && hasPermission(membership.permissions, 'members.view')
      ? serverGet(`${api}/members`, memberSchema.array())
      : null,
  ]);
  if (!projects.ok || !config.ok) {
    return (
      <NoAccess
        what="creating tickets"
        workspaceName={membership.organisation.name}
        roleName={membership.role.name}
      />
    );
  }

  const open = projects.data.filter((project) => !project.archived);
  const requested = (await searchParams).project;
  const initialProject = (Array.isArray(requested) ? requested[0] : requested)?.toUpperCase() ?? '';

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">New ticket</h1>
        <p className="mt-1 max-w-prose text-[13px] text-muted">
          It starts in the project&apos;s first status, and you are recorded as the reporter.
        </p>
      </header>

      {open.length === 0 ? (
        <EmptyState icon={FolderKanban} title="There is no project to put a ticket in">
          {hasPermission(membership.permissions, 'projects.manage')
            ? 'Create a project first, then come back.'
            : 'Ask an owner or administrator to create a project.'}
        </EmptyState>
      ) : (
        <TicketForm
          organisationId={membership.organisation.id}
          slug={membership.organisation.slug}
          projects={open}
          config={config.data}
          members={members?.ok ? members.data : []}
          canAssign={permissions.canAssign}
          initialProject={initialProject}
        />
      )}
    </div>
  );
}
