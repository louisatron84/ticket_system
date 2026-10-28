import {
  ticketFiltersToSearchParams,
  type SavedView,
  type TicketFilters,
  type ViewDefinition,
} from '@forge/shared';
import { workspaceHref } from './nav';
import { hrefFor } from './ticket-query';

/** What a saved view stores: the filters and sort as they are now, without the page. */
export function definitionFromFilters(
  filters: TicketFilters,
  display: ViewDefinition['display'],
): ViewDefinition {
  const { page: _page, ...rest } = filters;
  return { filters: rest, display };
}

/**
 * Where opening a view leads. A list view opens the tickets page. A board view naming exactly one
 * project opens that project's board; one naming none, or several, opens the Tickets board.
 */
export function viewTarget(slug: string, view: SavedView): string {
  const filters: TicketFilters = { ...view.definition.filters, page: 1 };
  if (view.definition.display === 'board') {
    const [project, ...others] = filters.project;
    if (project && others.length === 0) {
      return hrefFor(workspaceHref(slug, `/projects/${project}/board`), filters, {
        omitProject: true,
      });
    }
    return hrefFor(workspaceHref(slug, '/tickets/board'), filters);
  }
  return hrefFor(workspaceHref(slug, '/tickets'), filters);
}

/** Whether the filters on screen are exactly this view, so the menu can mark it as current. */
export function matchesView(
  view: SavedView,
  filters: TicketFilters,
  display: ViewDefinition['display'],
): boolean {
  if (view.definition.display !== display) return false;
  const canonical = (value: TicketFilters) =>
    ticketFiltersToSearchParams({ ...value, page: 1 }).toString();
  return canonical({ ...view.definition.filters, page: 1 }) === canonical(filters);
}
