import {
  hasPermission,
  memberSchema,
  parseTicketKey,
  ticketConfigSchema,
  ticketDetailSchema,
  timelineItemSchema,
} from '@forge/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PriorityMark, StatusBadge, TypeBadge } from '@/components/tickets/badges';
import { TicketEditorProvider } from '@/components/tickets/ticket-editor';
import { TicketFields } from '@/components/tickets/ticket-fields';
import { TicketDescription, TicketTitle } from '@/components/tickets/ticket-text';
import { TicketTimeline } from '@/components/tickets/ticket-timeline';
import { UserChip } from '@/components/tickets/user-chip';
import { NoAccess } from '@/components/workspace/no-access';
import { workspaceHref } from '@/lib/nav';
import { getViewer, serverGet } from '@/lib/server/session';
import { fieldPermissions } from '@/lib/ticket-form';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticketKey: string }>;
}): Promise<Metadata> {
  const parsed = parseTicketKey((await params).ticketKey);
  return { title: parsed ? `${parsed.projectKey}-${parsed.number}` : 'Ticket' };
}

export default async function TicketPage({
  params,
}: {
  params: Promise<{ slug: string; ticketKey: string }>;
}) {
  const { slug: rawSlug, ticketKey: rawKey } = await params;
  const slug = workspaceSlugFromPath(`/w/${rawSlug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!membership) notFound();

  if (!hasPermission(membership.permissions, 'tickets.view')) {
    return (
      <NoAccess
        what="this ticket"
        workspaceName={membership.organisation.name}
        roleName={membership.role.name}
      />
    );
  }

  // Odd keys are not found, and a lower-case key is sent to its proper address.
  const parsed = parseTicketKey(rawKey);
  if (!parsed) notFound();
  const key = `${parsed.projectKey}-${parsed.number}`;
  if (rawKey !== key) redirect(workspaceHref(membership.organisation.slug, `/tickets/${key}`));

  const api = `/api/v1/orgs/${membership.organisation.id}`;
  const permissions = fieldPermissions(membership.permissions);
  const [ticket, timeline, config, members] = await Promise.all([
    serverGet(`${api}/tickets/${key}`, ticketDetailSchema),
    serverGet(`${api}/tickets/${key}/timeline`, timelineItemSchema.array()),
    serverGet(`${api}/ticket-config`, ticketConfigSchema),
    permissions.canAssign && hasPermission(membership.permissions, 'members.view')
      ? serverGet(`${api}/members`, memberSchema.array())
      : null,
  ]);
  // A ticket that is not here, and one in another workspace, look exactly alike.
  if (!ticket.ok || !timeline.ok || !config.ok) notFound();

  const now = new Date();
  const maxRank = Math.max(1, ...config.data.priorities.map((priority) => priority.rank));

  return (
    <TicketEditorProvider
      initial={ticket.data}
      organisationId={membership.organisation.id}
      permissions={membership.permissions}
    >
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="font-mono text-xs text-muted">{ticket.data.key}</span>
            <TypeBadge type={ticket.data.type} />
            <Link
              href={workspaceHref(
                membership.organisation.slug,
                `/projects/${ticket.data.project.key}/board`,
              )}
              className="text-muted hover:text-text hover:underline"
            >
              {ticket.data.project.name}
            </Link>
          </div>
          <TicketTitle />
          {/* On a narrow screen the fields are far below, so the essentials sit under the title. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 lg:hidden">
            <StatusBadge status={ticket.data.status} />
            <PriorityMark priority={ticket.data.priority} maxRank={maxRank} />
            <UserChip person={ticket.data.assignee} />
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-8">
            <TicketDescription />
            <TicketTimeline
              items={timeline.data}
              organisationId={membership.organisation.id}
              ticketKey={ticket.data.key}
              viewerUserId={viewer.user.id}
              canComment={permissions.canComment}
              canModerate={permissions.canEdit}
              now={now.toISOString()}
            />
          </div>
          <aside aria-label="Ticket fields" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <TicketFields
              config={config.data}
              members={members?.ok ? members.data : []}
              today={now.toISOString().slice(0, 10)}
              now={now.toISOString()}
            />
          </aside>
        </div>
      </div>
    </TicketEditorProvider>
  );
}
