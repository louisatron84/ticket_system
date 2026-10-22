import { hasPermission, memberSchema, roleDetailSchema } from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { MembersTable } from '@/components/members/members-table';
import { NoAccess } from '@/components/workspace/no-access';
import { getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Members' };
export const dynamic = 'force-dynamic';

export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = workspaceSlugFromPath(`/w/${(await params).slug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!membership) notFound();

  const noAccess = (
    <NoAccess
      what="the member list"
      workspaceName={membership.organisation.name}
      roleName={membership.role.name}
    />
  );
  if (!hasPermission(membership.permissions, 'members.view')) return noAccess;

  const orgPath = `/api/v1/orgs/${membership.organisation.id}`;
  const [members, roles] = await Promise.all([
    serverGet(`${orgPath}/members`, memberSchema.array()),
    serverGet(`${orgPath}/roles`, roleDetailSchema.array()),
  ]);
  if (!members.ok || !roles.ok) return noAccess;

  const canManage = hasPermission(membership.permissions, 'members.manage');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Members</h1>
        <p className="mt-1 max-w-prose text-[13px] text-muted">
          {canManage
            ? 'Change what each person can do by giving them a different role. Only roles you are allowed to assign are offered.'
            : 'Everyone in this workspace and the role they hold. Only owners and administrators can change roles.'}
        </p>
      </header>
      <MembersTable
        organisationId={membership.organisation.id}
        viewerUserId={viewer.user.id}
        actor={membership}
        members={members.data}
        roles={roles.data}
      />
    </div>
  );
}
