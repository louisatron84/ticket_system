import { parseTicketFilters, ticketFiltersToSearchParams, type TicketFilters } from '@forge/shared';

// The address is the state of a list or board: change a filter and you navigate. These helpers
// read an address into filters (never throwing, whatever is in it) and write filters back out.

export type RawSearchParams = Record<string, string | string[] | undefined>;

export type FilterField =
  | 'project'
  | 'statusKey'
  | 'statusCategory'
  | 'type'
  | 'priority'
  | 'assignee'
  | 'reporter'
  | 'label';

const KNOWN_PARAMETERS = [
  'q',
  'project',
  'statusKey',
  'statusCategory',
  'type',
  'priority',
  'assignee',
  'reporter',
  'label',
  'due',
  'archived',
  'sort',
  'dir',
  'page',
  'pageSize',
] as const;

function defaultFilters(): TicketFilters {
  const result = parseTicketFilters({});
  if (!result.ok) throw new Error('The default ticket filters are not valid.');
  return result.filters;
}

/**
 * Reads filters from an address. If part of it is invalid, that part falls back to its default,
 * the rest is kept, and `ignored` says so, so the page can tell the person instead of failing.
 * Parameters it does not know (tracking tags and the like) are silently left out.
 */
export function ticketQueryFromSearchParams(raw: RawSearchParams): {
  filters: TicketFilters;
  ignored: boolean;
} {
  const whole = parseTicketFilters(raw);
  if (whole.ok) return { filters: whole.filters, ignored: false };

  const kept: RawSearchParams = {};
  for (const name of KNOWN_PARAMETERS) {
    const value = raw[name];
    if (value !== undefined && parseTicketFilters({ [name]: value }).ok) kept[name] = value;
  }
  const salvaged = parseTicketFilters(kept);
  return { filters: salvaged.ok ? salvaged.filters : defaultFilters(), ignored: true };
}

/** A copy with these values changed. Back to page 1 unless a page is asked for. */
export function withFilters(filters: TicketFilters, patch: Partial<TicketFilters>): TicketFilters {
  return { ...filters, ...patch, page: patch.page ?? 1 };
}

/** Adds the value to a multi-choice filter, or removes it if it is already chosen. */
export function toggleFilterValue(
  filters: TicketFilters,
  field: FilterField,
  value: string,
): TicketFilters {
  const current = filters[field] as string[];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  return withFilters(filters, { [field]: next } as Partial<TicketFilters>);
}

/** Every filter off. The way the list is sorted and paged is a display choice, so it stays. */
export function clearFilters(
  filters: TicketFilters,
  options: { keepProject?: boolean } = {},
): TicketFilters {
  return {
    ...defaultFilters(),
    sort: filters.sort,
    dir: filters.dir,
    pageSize: filters.pageSize,
    // The tree is a way of looking at the list, not a filter, so it stays.
    tree: filters.tree,
    project: options.keepProject ? filters.project : [],
  };
}

export function hasActiveFilters(
  filters: TicketFilters,
  options: { ignoreProject?: boolean } = {},
): boolean {
  return (
    filters.q !== '' ||
    (!options.ignoreProject && filters.project.length > 0) ||
    filters.statusKey.length > 0 ||
    filters.statusCategory.length > 0 ||
    filters.type.length > 0 ||
    filters.priority.length > 0 ||
    filters.assignee.length > 0 ||
    filters.reporter.length > 0 ||
    filters.label.length > 0 ||
    filters.due !== undefined ||
    filters.archived ||
    structureChips(filters).length > 0
  );
}

/**
 * The structure filters as chips: "Parent: WEB-20", "Epic: WEB-5", "Linked to: WEB-3",
 * "Has blocker: Yes", "Top level only". Each carries the change that removes it.
 */
export function structureChips(
  filters: TicketFilters,
): { key: string; text: string; remove: Partial<TicketFilters> }[] {
  return [
    ...(filters.parent
      ? [{ key: 'parent', text: `Parent: ${filters.parent}`, remove: { parent: undefined } }]
      : []),
    ...(filters.epic
      ? [{ key: 'epic', text: `Epic: ${filters.epic}`, remove: { epic: undefined } }]
      : []),
    ...(filters.linked
      ? [{ key: 'linked', text: `Linked to: ${filters.linked}`, remove: { linked: undefined } }]
      : []),
    ...(filters.blocked
      ? [
          {
            key: 'blocked',
            text: `Has blocker: ${filters.blocked === 'yes' ? 'Yes' : 'No'}`,
            remove: { blocked: undefined },
          },
        ]
      : []),
    ...(filters.top ? [{ key: 'top', text: 'Top level only', remove: { top: false } }] : []),
  ];
}

/** Newest and most urgent first; soonest due and lowest key first. */
const NATURAL_DIRECTION: Record<TicketFilters['sort'], TicketFilters['dir']> = {
  updated: 'desc',
  created: 'desc',
  priority: 'desc',
  due: 'asc',
  key: 'asc',
};

/** Choosing the column already sorted by flips its direction; a new column starts its natural way. */
export function sortedBy(filters: TicketFilters, sort: TicketFilters['sort']): TicketFilters {
  const dir =
    filters.sort === sort ? (filters.dir === 'asc' ? 'desc' : 'asc') : NATURAL_DIRECTION[sort];
  return withFilters(filters, { sort, dir });
}

/** The address for a list or board showing these filters. */
export function hrefFor(
  basePath: string,
  filters: TicketFilters,
  options: { omitProject?: boolean } = {},
): string {
  const query = ticketFiltersToSearchParams(
    options.omitProject ? { ...filters, project: [] } : filters,
  ).toString();
  return query ? `${basePath}?${query}` : basePath;
}
