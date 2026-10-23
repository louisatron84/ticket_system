import {
  boardSchema,
  hasPermission,
  memberSchema,
  normalizeProjectKey,
  projectDetailSchema,
  savedViewSchema,
  ticketConfigSchema,
  ticketFiltersToSearchParams,
} from '@forge/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Board } from '@/components/board/board';
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
  const organisationId = membership.organisation.id;
  const api = `/api/v1/orgs/${organisationId}`;
  const permissions = fieldPermissions(membership.permissions);

  const [board, project, config, members, views] = await Promise.all([
    serverGet(`${api}/projects/${key}/board?${ticketFiltersToSearchParams(filters)}`, boardSchema),
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
          <SavedViewsMenu
            slug={membership.organisation.slug}
            organisationId={organisationId}
            viewerUserId={viewer.user.id}
            views={views.ok ? views.data : []}
            canShare={hasPermission(membership.permissions, 'projects.manage')}
            filters={filters}
            display="board"
          />
        }
      />

      <Board
        initial={board.data}
        organisationId={organisationId}
        slug={membership.organisation.slug}
        projectKey={key}
        transitions={project.data.transitions}
        canMove={permissions.canEdit && !project.data.archived}
        today={now.toISOString().slice(0, 10)}
        maxRank={maxRank}
        filters={filters}
      />
    </div>
  );
}
