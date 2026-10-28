import {
  hasPermission,
  memberSchema,
  parseTicketKey,
  MAX_TICKET_DEPTH,
  projectSchema,
  ticketConfigSchema,
  ticketDetailSchema,
  timelineItemSchema,
} from '@forge/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { TicketCommands } from '@/components/command/ticket-commands';
import { RichTextScopeProvider } from '@/components/rich-text/rich-text';
import { ArchivedBanner } from '@/components/tickets/archived-banner';
import { ChildTickets } from '@/components/tickets/child-tickets';
import { PriorityMark, StatusBadge, TypeBadge } from '@/components/tickets/badges';
import { TicketActionsMenu } from '@/components/tickets/ticket-actions-menu';
import {
  AcceptanceCriteria,
  MentionedIn,
  TicketAttachments,
  TicketFilesProvider,
  TicketGoal,
} from '@/components/tickets/ticket-content';
import { TicketEditorProvider } from '@/components/tickets/ticket-editor';
import { TicketFields } from '@/components/tickets/ticket-fields';
import { BlockedNotice, ParentField, TicketLinks } from '@/components/tickets/ticket-links';
import { TicketProgress } from '@/components/tickets/ticket-progress';
import { TicketDescription, TicketTitle } from '@/components/tickets/ticket-text';
import { TicketTimeline } from '@/components/tickets/ticket-timeline';
import { UserChip } from '@/components/tickets/user-chip';
import { NoAccess } from '@/components/workspace/no-access';
import { workspaceHref } from '@/lib/nav';
import { getViewer, serverGet } from '@/lib/server/session';
import { defaultTypeAndPriority } from '@/lib/ticket-actions';
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
  const [ticket, timeline, config, members, project] = await Promise.all([
    serverGet(`${api}/tickets/${key}`, ticketDetailSchema),
    serverGet(`${api}/tickets/${key}/timeline`, timelineItemSchema.array()),
    serverGet(`${api}/ticket-config`, ticketConfigSchema),
    // Members fill the assignee menu and the `@` suggestions.
    hasPermission(membership.permissions, 'members.view')
      ? serverGet(`${api}/members`, memberSchema.array())
      : null,
    serverGet(`${api}/projects/${parsed.projectKey}`, projectSchema),
  ]);
  // A ticket that is not here, and one in another workspace, look exactly alike.
  if (!ticket.ok || !timeline.ok || !config.ok) notFound();

  const now = new Date();
  const archived = ticket.data.archivedAt !== null;
  const maxRank = Math.max(1, ...config.data.priorities.map((priority) => priority.rank));
  // Parents and links change only on a ticket that is not archived, in a project that is not.
  const projectArchived = project.ok && project.data.archived;
  const canShape = permissions.canEdit && !archived && !projectArchived;
  const { ancestors } = ticket.data;
  const canWrite = permissions.canEdit && !archived;
  const memberList = members?.ok ? members.data : [];
  const mentionable = memberList.map((m) => ({
    id: m.user.id,
    displayName: m.user.displayName,
    email: m.user.email,
  }));

  return (
    <TicketEditorProvider
      initial={ticket.data}
      organisationId={membership.organisation.id}
      permissions={membership.permissions}
    >
      <RichTextScopeProvider
        slug={membership.organisation.slug}
        organisationId={membership.organisation.id}
        ticketKey={ticket.data.key}
        references={ticket.data.references}
        members={mentionable}
      >
        <TicketFilesProvider
          organisationId={membership.organisation.id}
          ticketKey={ticket.data.key}
          initial={ticket.data.attachments}
          canUpload={canWrite}
        >
          <TicketCommands
            organisationId={membership.organisation.id}
            slug={membership.organisation.slug}
            viewerId={viewer.user.id}
            canArchive={permissions.canEdit}
            canCreate={permissions.canCreate}
            canMarkDuplicate={canShape}
          />
          <div className="flex flex-col gap-5">
            {archived && (
              <ArchivedBanner
                organisationId={membership.organisation.id}
                ticketKey={ticket.data.key}
                canEdit={permissions.canEdit}
              />
            )}
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
                <div className="ml-auto">
                  <TicketActionsMenu
                    organisationId={membership.organisation.id}
                    slug={membership.organisation.slug}
                    ticket={{ key: ticket.data.key, title: ticket.data.title, archived }}
                    canEdit={permissions.canEdit}
                    canCreate={permissions.canCreate}
                    canMarkDuplicate={canShape}
                  />
                </div>
              </div>
              {ancestors.length > 0 && (
                <nav aria-label="Parent tickets">
                  <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
                    {ancestors.map((ancestor, index) => (
                      <li key={ancestor.key} className="flex min-w-0 items-center gap-1">
                        {index > 0 && <span aria-hidden="true">›</span>}
                        <Link
                          href={workspaceHref(
                            membership.organisation.slug,
                            `/tickets/${ancestor.key}`,
                          )}
                          className="truncate hover:text-text hover:underline"
                        >
                          <span className="font-mono">{ancestor.key}</span> {ancestor.title}
                        </Link>
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
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
                <TicketGoal />
                <AcceptanceCriteria
                  organisationId={membership.organisation.id}
                  ticketKey={ticket.data.key}
                  initial={ticket.data.criteriaItems}
                  canEdit={canWrite}
                />
                <TicketDescription />
                <TicketAttachments
                  organisationId={membership.organisation.id}
                  ticketKey={ticket.data.key}
                  viewerId={viewer.user.id}
                  canModerate={canWrite}
                />
                <ChildTickets
                  organisationId={membership.organisation.id}
                  slug={membership.organisation.slug}
                  ticket={{ key: ticket.data.key, projectKey: ticket.data.project.key }}
                  nodes={ticket.data.children}
                  progress={ticket.data.progress}
                  canEdit={canShape}
                  canCreate={permissions.canCreate}
                  defaults={defaultTypeAndPriority(config.data)}
                  canHaveChildren={ancestors.length + 1 < MAX_TICKET_DEPTH}
                />
                <TicketTimeline
                  items={timeline.data}
                  organisationId={membership.organisation.id}
                  ticketKey={ticket.data.key}
                  viewerUserId={viewer.user.id}
                  canComment={permissions.canComment}
                  canModerate={permissions.canEdit}
                  archived={archived}
                  now={now.toISOString()}
                />
              </div>
              <aside
                aria-label="Ticket fields"
                className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-4 lg:self-start"
              >
                <BlockedNotice keys={ticket.data.openBlockerKeys} />
                {ticket.data.progress && <TicketProgress progress={ticket.data.progress} />}
                <TicketFields
                  config={config.data}
                  members={permissions.canAssign ? memberList : []}
                  today={now.toISOString().slice(0, 10)}
                  now={now.toISOString()}
                />
                <ParentField
                  organisationId={membership.organisation.id}
                  slug={membership.organisation.slug}
                  ticketKey={ticket.data.key}
                  parent={ancestors.at(-1) ?? null}
                  isEpic={ticket.data.type.key === 'epic'}
                  canEdit={canShape}
                />
                <TicketLinks
                  organisationId={membership.organisation.id}
                  slug={membership.organisation.slug}
                  ticketKey={ticket.data.key}
                  links={ticket.data.links}
                  canEdit={canShape}
                />
                <MentionedIn
                  slug={membership.organisation.slug}
                  tickets={ticket.data.mentionedIn}
                />
              </aside>
            </div>
          </div>
        </TicketFilesProvider>
      </RichTextScopeProvider>
    </TicketEditorProvider>
  );
}
