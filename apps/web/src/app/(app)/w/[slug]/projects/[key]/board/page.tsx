import {
  boardSchema,
  hasPermission,
  memberSchema,
  normalizeProjectKey,
  projectDetailSchema,
  resolveBoardDisplay,
  savedViewSchema,
  ticketConfigSchema,
  ticketFiltersToSearchParams,
} from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Board } from '@/components/board/board';
import { DisplayMenu } from '@/components/board/display-menu';
import { BoardPrefsProvider } from '@/components/board/prefs-provider';
import { FilterBar } from '@/components/tickets/filter-bar';
import { buildFilterOptions } from '@/components/tickets/filter-options';
import { SavedViewsMenu } from '@/components/tickets/saved-views';
import { NoAccess } from '@/components/workspace/no-access';
import { workspaceHref } from '@/lib/nav';
import { getViewer, serverGet } from '@/lib/server/session';
import { fieldPermissions } from '@/lib/ticket-form';
import { ticketQueryFromSearchParams } from '@/lib/ticket-query';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Board' };
export const dynamic = 'force-dynamic';

export default async function ProjectBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug: rawSlug, key: rawKey } = await params;
  const slug = workspaceSlugFromPath(`/w/${rawSlug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  const key = normalizeProjectKey(rawKey);
  if (!membership || !key) notFound();

  const parsed = ticketQueryFromSearchParams(await searchParams);
  // A board is one project's: the address says which, whatever the query string says.
  const filters = { ...parsed.filters, project: [key] };
  // A board showing only top-level tickets asks the server for just those, so counts are right.
  const fetched = {
    ...filters,
    top: filters.top || resolveBoardDisplay(viewer.preferences.board).show === 'top',
  };
  const organisationId = membership.organisation.id;
  const api = `/api/v1/orgs/${organisationId}`;
  const permissions = fieldPermissions(membership.permissions);

  const [board, project, config, members, views] = await Promise.all([
    serverGet(`${api}/projects/${key}/board?${ticketFiltersToSearchParams(fetched)}`, boardSchema),
    serverGet(`${api}/projects/${key}`, projectDetailSchema),
    serverGet(`${api}/ticket-config`, ticketConfigSchema),
    hasPermission(membership.permissions, 'members.view')
      ? serverGet(`${api}/members`, memberSchema.array())
      : null,
    serverGet(`${api}/views`, savedViewSchema.array()),
  ]);

  if (!board.ok || !project.ok || !config.ok) {
    return (
      <NoAccess
        what="this board"
        workspaceName={membership.organisation.name}
        roleName={membership.role.name}
      />
    );
  }

  const now = new Date();
  const maxRank = Math.max(1, ...config.data.priorities.map((priority) => priority.rank));

  return (
    <BoardPrefsProvider
      scope={{ kind: 'project', projectKey: key }}
      initialDisplay={resolveBoardDisplay(viewer.preferences.board)}
      initialColumns={viewer.preferences.boardColumns?.[key] ?? undefined}
    >
      <div className="flex flex-col gap-4">
        <FilterBar
          basePath={workspaceHref(membership.organisation.slug, `/projects/${key}/board`)}
          filters={filters}
          scoped
          showStatus={false}
          ignored={parsed.ignored}
          options={buildFilterOptions({
            config: config.data,
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
              />
            </div>
          }
        />

        <Board
          initial={board.data}
          workflows={[
            {
              projectId: project.data.id,
              projectKey: project.data.key,
              archived: project.data.archived,
              statuses: project.data.statuses,
              transitions: project.data.transitions,
            },
          ]}
          organisationId={organisationId}
          slug={membership.organisation.slug}
          canMove={permissions.canEdit}
          today={now.toISOString().slice(0, 10)}
          maxRank={maxRank}
          filters={filters}
          listBase={workspaceHref(membership.organisation.slug, `/projects/${key}/list`)}
          scoped
          dndId={`board-${key}`}
          config={config.data}
          members={members?.ok ? members.data : null}
          viewerId={viewer.user.id}
          canCreate={permissions.canCreate}
          canAssign={permissions.canAssign}
          projects={[
            { key: project.data.key, name: project.data.name, archived: project.data.archived },
          ]}
        />
      </div>
    </BoardPrefsProvider>
  );
}
