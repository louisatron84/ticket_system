import {
  hasPermission,
  memberSchema,
  projectSchema,
  savedViewSchema,
  ticketConfigSchema,
  ticketFiltersToSearchParams,
  ticketListSchema,
  type Membership,
} from '@forge/shared';
import { Plus, SearchX, Ticket } from 'lucide-react';
import Link from 'next/link';
import { NoAccess } from '@/components/workspace/no-access';
import { workspaceHref } from '@/lib/nav';
import { serverGet } from '@/lib/server/session';
import {
  clearFilters,
  hasActiveFilters,
  hrefFor,
  ticketQueryFromSearchParams,
  type RawSearchParams,
} from '@/lib/ticket-query';
import { buttonClass } from '@/lib/ui';
import { EmptyState } from './empty-state';
import { FilterBar } from './filter-bar';
import { buildFilterOptions } from './filter-options';
import { Pagination } from './pagination';
import { SavedViewsMenu } from './saved-views';
import { TicketTable } from './ticket-table';

/**
 * The ticket list with its filter bar, saved views and paging. The address is the only state:
 * this reads it, asks the API, and draws the result. `scope` pins it to one project.
 */
export async function TicketListView({
  membership,
  viewerUserId,
  searchParams,
  basePath,
  scope,
}: {
  membership: Membership;
  viewerUserId: string;
  searchParams: RawSearchParams;
  /** The address of this page, without a query string. */
  basePath: string;
  scope?: { projectKey: string };
}) {
  const organisationId = membership.organisation.id;
  const slug = membership.organisation.slug;
  const api = `/api/v1/orgs/${organisationId}`;

  const parsed = ticketQueryFromSearchParams(searchParams);
  // On a project's own page the project is the address, whatever the query string says.
  const filters = scope ? { ...parsed.filters, project: [scope.projectKey] } : parsed.filters;

  const canSeeMembers = hasPermission(membership.permissions, 'members.view');
  const [list, config, projects, members, views] = await Promise.all([
    serverGet(`${api}/tickets?${ticketFiltersToSearchParams(filters)}`, ticketListSchema),
    serverGet(`${api}/ticket-config`, ticketConfigSchema),
    scope ? null : serverGet(`${api}/projects`, projectSchema.array()),
    canSeeMembers ? serverGet(`${api}/members`, memberSchema.array()) : null,
    serverGet(`${api}/views`, savedViewSchema.array()),
  ]);

  if (!list.ok || !config.ok) {
    return (
      <NoAccess
        what="these tickets"
        workspaceName={membership.organisation.name}
        roleName={membership.role.name}
      />
    );
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const maxRank = Math.max(1, ...config.data.priorities.map((priority) => priority.rank));
  const filtersActive = hasActiveFilters(filters, { ignoreProject: Boolean(scope) });
  const canCreate = hasPermission(membership.permissions, 'tickets.create');

  const newTicketHref = workspaceHref(
    slug,
    scope ? `/tickets/new?project=${scope.projectKey}` : '/tickets/new',
  );
  const hrefForPage = (page: number) =>
    hrefFor(basePath, { ...filters, page }, { omitProject: Boolean(scope) });

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        basePath={basePath}
        filters={filters}
        scoped={Boolean(scope)}
        ignored={parsed.ignored}
        options={buildFilterOptions({
          config: config.data,
          ...(projects?.ok ? { projects: projects.data } : {}),
          ...(members?.ok ? { members: members.data } : {}),
        })}
        trailing={
          <SavedViewsMenu
            slug={slug}
            organisationId={organisationId}
            viewerUserId={viewerUserId}
            views={views.ok ? views.data : []}
            canShare={hasPermission(membership.permissions, 'projects.manage')}
            filters={filters}
            display="list"
          />
        }
      />

      {list.data.total === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={SearchX}
            title="No tickets match these filters"
            action={
              <Link
                href={hrefFor(basePath, clearFilters(filters, { keepProject: Boolean(scope) }), {
                  omitProject: Boolean(scope),
                })}
                className={buttonClass('secondary')}
              >
                Clear filters
              </Link>
            }
          >
            Try removing a filter, or searching for something shorter.
          </EmptyState>
        ) : (
          <EmptyState
            icon={Ticket}
            title="No tickets yet"
            action={
              canCreate ? (
                <Link href={newTicketHref} className={buttonClass('primary')}>
                  <Plus size={15} aria-hidden="true" />
                  New ticket
                </Link>
              ) : undefined
            }
          >
            {canCreate
              ? 'Create the first ticket to start tracking work.'
              : 'Nothing has been created here yet.'}
          </EmptyState>
        )
      ) : (
        <>
          <TicketTable
            items={list.data.items}
            filters={filters}
            basePath={basePath}
            scoped={Boolean(scope)}
            slug={slug}
            today={today}
            now={now.toISOString()}
            maxRank={maxRank}
          />
          <Pagination
            page={list.data.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            hrefForPage={hrefForPage}
          />
        </>
      )}
    </div>
  );
}
