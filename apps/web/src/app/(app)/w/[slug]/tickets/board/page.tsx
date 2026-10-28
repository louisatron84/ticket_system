import {
  hasPermission,
  memberSchema,
  projectSchema,
  resolveBoardDisplay,
  savedViewSchema,
  ticketConfigSchema,
  ticketFiltersToSearchParams,
  workspaceBoardSchema,
} from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Board } from '@/components/board/board';
import { DisplayMenu } from '@/components/board/display-menu';
import { BoardPrefsProvider } from '@/components/board/prefs-provider';
import { FilterBar } from '@/components/tickets/filter-bar';
import { buildFilterOptions } from '@/components/tickets/filter-options';
import { SavedViewsMenu } from '@/components/tickets/saved-views';
import { TicketsHeader } from '@/components/tickets/tickets-header';
import { NoAccess } from '@/components/workspace/no-access';
import { workspaceHref } from '@/lib/nav';
import { getViewer, serverGet } from '@/lib/server/session';
import { fieldPermissions } from '@/lib/ticket-form';
import { ticketQueryFromSearchParams } from '@/lib/ticket-query';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Board' };
export const dynamic = 'force-dynamic';

/** Every project's tickets on one board, a column per status. */
export default async function TicketsBoardPage({
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

  const noAccess = (
    <NoAccess
      what="tickets"
      workspaceName={membership.organisation.name}
      roleName={membership.role.name}
    />
  );
  if (!hasPermission(membership.permissions, 'tickets.view')) return noAccess;

  const parsed = ticketQueryFromSearchParams(await searchParams);
  const filters = parsed.filters;
  // A board showing only top-level tickets asks the server for just those, so counts are right.
  const fetched = {
    ...filters,
    top: filters.top || resolveBoardDisplay(viewer.preferences.board).show === 'top',
  };
  const organisationId = membership.organisation.id;
  const api = `/api/v1/orgs/${organisationId}`;
  const permissions = fieldPermissions(membership.permissions);

  const [board, config, projects, members, views] = await Promise.all([
    serverGet(`${api}/board?${ticketFiltersToSearchParams(fetched)}`, workspaceBoardSchema),
    serverGet(`${api}/ticket-config`, ticketConfigSchema),
    serverGet(`${api}/projects`, projectSchema.array()),
    hasPermission(membership.permissions, 'members.view')
      ? serverGet(`${api}/members`, memberSchema.array())
      : null,
    serverGet(`${api}/views`, savedViewSchema.array()),
  ]);
  if (!board.ok || !config.ok) return noAccess;

  const now = new Date();
  const maxRank = Math.max(1, ...config.data.priorities.map((priority) => priority.rank));
  const ticketsHref = workspaceHref(membership.organisation.slug, '/tickets');

  return (
    <div className="flex flex-col gap-5">
      <TicketsHeader membership={membership} />
      <BoardPrefsProvider
        scope={{ kind: 'tickets' }}
        initialDisplay={resolveBoardDisplay(viewer.preferences.board)}
        initialColumns={viewer.preferences.ticketsBoardColumns ?? undefined}
      >
        <div className="flex flex-col gap-4">
          <FilterBar
            basePath={`${ticketsHref}/board`}
            filters={filters}
            scoped={false}
            showStatus={false}
            ignored={parsed.ignored}
            options={buildFilterOptions({
              config: config.data,
              ...(projects.ok ? { projects: projects.data } : {}),
              ...(members?.ok ? { members: members.data } : {}),
            })}
            trailing={
              <div className="flex items-center gap-2">
                <SavedViewsMenu
                  slug={membership.organisation.slug}
                  organisationId={organisationId}
                  viewerUserId={viewer.user.id}
                  views={views.ok ? views.data : []}
                  canShare={hasPermission(membership.permissions, 'projects.manage')}
                  filters={filters}
                  display="board"
                />
                <DisplayMenu
                  columns={board.data.columns.map(({ status, total }) => ({ status, total }))}
                  lanes
                />
              </div>
            }
          />

          <Board
            initial={board.data}
            workflows={board.data.workflows}
            organisationId={organisationId}
            slug={membership.organisation.slug}
            canMove={permissions.canEdit}
            today={now.toISOString().slice(0, 10)}
            maxRank={maxRank}
            filters={filters}
            listBase={ticketsHref}
            scoped={false}
            dndId="board-tickets"
            config={config.data}
            members={members?.ok ? members.data : null}
            viewerId={viewer.user.id}
            canCreate={permissions.canCreate}
            canAssign={permissions.canAssign}
            projects={
              projects.ok
                ? projects.data.map(({ key, name, archived }) => ({ key, name, archived }))
                : []
            }
          />
        </div>
      </BoardPrefsProvider>
    </div>
  );
}
