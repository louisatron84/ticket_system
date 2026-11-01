import { hasPermission, workspaceTicketSettingsSchema } from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { CustomFieldsSettings } from '@/components/config/custom-fields-settings';
import { LabelsSettings } from '@/components/config/labels-settings';
import { PrioritiesSettings } from '@/components/config/priorities-settings';
import { TicketTypesSettings } from '@/components/config/ticket-types-settings';
import { NoAccess } from '@/components/workspace/no-access';
import { getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Ticket settings' };
export const dynamic = 'force-dynamic';

/** The workspace's ticket settings: types, priorities, labels and custom fields (P4). */
export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = workspaceSlugFromPath(`/w/${(await params).slug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!membership) notFound();
  if (!hasPermission(membership.permissions, 'fields.manage')) {
    return (
      <NoAccess
        what="this workspace's ticket settings"
        workspaceName={membership.organisation.name}
        roleName={membership.role.name}
      />
    );
  }
  const organisationId = membership.organisation.id;
  const settings = await serverGet(
    `/api/v1/orgs/${organisationId}/ticket-settings`,
    workspaceTicketSettingsSchema,
  );
  if (!settings.ok) notFound();

  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Ticket settings</h1>
        <p className="text-[13px] text-muted">
          Types, priorities, labels and custom fields for every project in{' '}
          {membership.organisation.name}.
        </p>
      </header>
      <TicketTypesSettings organisationId={organisationId} types={settings.data.types} />
      <PrioritiesSettings organisationId={organisationId} priorities={settings.data.priorities} />
      <LabelsSettings organisationId={organisationId} labels={settings.data.labels} />
      <CustomFieldsSettings organisationId={organisationId} types={settings.data.types} />
    </div>
  );
}
