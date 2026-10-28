import { parseTicketFilters, ticketFiltersToSearchParams, type TicketFilters } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import {
  clearFilters,
  hasActiveFilters,
  hrefFor,
  sortedBy,
  structureChips,
  ticketQueryFromSearchParams,
  toggleFilterValue,
  withFilters,
} from './ticket-query';

const uuid = '01a1656b-1a49-7146-94ac-1c72df43ddb4';

const defaults = (): TicketFilters => ticketQueryFromSearchParams({}).filters;

describe('ticketQueryFromSearchParams', () => {
  it('gives the defaults for an empty address, and says nothing was ignored', () => {
    const { filters, ignored } = ticketQueryFromSearchParams({});
    expect(ignored).toBe(false);
    expect(filters).toMatchObject({
      q: '',
      project: [],
      sort: 'updated',
      dir: 'desc',
      page: 1,
      pageSize: 50,
      archived: false,
    });
  });

  it('reads what an address says', () => {
    const { filters, ignored } = ticketQueryFromSearchParams({
      q: 'login',
      project: ['web', 'api'],
      assignee: ['me', 'none', uuid],
      label: 'bug',
      due: 'overdue',
      sort: 'priority',
      dir: 'asc',
      page: '3',
      pageSize: '25',
    });
    expect(ignored).toBe(false);
    expect(filters).toMatchObject({
      q: 'login',
      project: ['WEB', 'API'],
      assignee: ['me', 'none', uuid],
      label: ['bug'],
      due: 'overdue',
      sort: 'priority',
      dir: 'asc',
      page: 3,
      pageSize: 25,
    });
  });

  it('survives garbage: bad parts fall back to defaults and the rest is kept', () => {
    const { filters, ignored } = ticketQueryFromSearchParams({
      pageSize: '100000',
      sort: 'x',
      status: '\u0000',
      q: 'still here',
      priority: 'high',
    });
    expect(ignored).toBe(true);
    expect(filters).toMatchObject({
      q: 'still here',
      priority: ['high'],
      sort: 'updated',
      pageSize: 50,
    });
  });

  it.each([
    ['a page that is not a number', { page: 'abc' }],
    ['a negative page', { page: '-1' }],
    ['an unknown due filter', { due: 'sometime' }],
    ['an assignee that is not a person', { assignee: 'nope' }],
    ['too many values', { project: Array.from({ length: 21 }, () => 'WEB') }],
    ['a control character in the text', { q: 'a\u0000b' }],
    ['two values where one is allowed', { sort: ['updated', 'created'] }],
  ])('ignores %s, never throws', (_label, raw) => {
    const { filters, ignored } = ticketQueryFromSearchParams(raw);
    expect(ignored).toBe(true);
    expect(parseTicketFilters({}).ok).toBe(true);
    expect(filters.page).toBeGreaterThanOrEqual(1);
    expect(filters.pageSize).toBeLessThanOrEqual(100);
  });

  it('does not count parameters it simply does not know as a problem', () => {
    const { ignored } = ticketQueryFromSearchParams({ utm_source: 'newsletter', fbclid: 'x' });
    expect(ignored).toBe(false);
  });

  it('round-trips: filters written to an address read back the same', () => {
    const original = withFilters(defaults(), {
      q: 'dark mode',
      project: ['WEB'],
      statusCategory: ['in_progress', 'not_started'],
      assignee: ['me', uuid],
      label: ['bug', 'front end'],
      due: 'week',
      archived: true,
      sort: 'due',
      dir: 'asc',
      pageSize: 20,
    });
    const params = ticketFiltersToSearchParams(original);
    const raw: Record<string, string[]> = {};
    for (const [name, value] of params) (raw[name] ??= []).push(value);
    const back = ticketQueryFromSearchParams(raw);
    expect(back.ignored).toBe(false);
    expect(back.filters).toEqual({ ...original, page: 1 });
  });
});

describe('toggleFilterValue', () => {
  it('adds a value, keeping the order they were chosen in', () => {
    let filters = toggleFilterValue(defaults(), 'priority', 'high');
    filters = toggleFilterValue(filters, 'priority', 'low');
    expect(filters.priority).toEqual(['high', 'low']);
  });

  it('removes a value that is already chosen', () => {
    let filters = toggleFilterValue(defaults(), 'priority', 'high');
    filters = toggleFilterValue(filters, 'priority', 'low');
    filters = toggleFilterValue(filters, 'priority', 'high');
    expect(filters.priority).toEqual(['low']);
  });

  it('goes back to page 1, because the old page may not exist any more', () => {
    const onPageFour = withFilters(defaults(), { page: 4 });
    expect(onPageFour.page).toBe(4);
    expect(toggleFilterValue(onPageFour, 'type', 'bug').page).toBe(1);
  });

  it('leaves everything else alone and does not change the original', () => {
    const original = withFilters(defaults(), { q: 'x', sort: 'key', dir: 'asc' });
    const next = toggleFilterValue(original, 'label', 'bug');
    expect(next).toMatchObject({ q: 'x', sort: 'key', dir: 'asc', label: ['bug'] });
    expect(original.label).toEqual([]);
  });
});

describe('withFilters', () => {
  it('resets to page 1 unless a page is asked for', () => {
    const base = withFilters(defaults(), { page: 5 });
    expect(withFilters(base, { q: 'x' }).page).toBe(1);
    expect(withFilters(base, { page: 6 }).page).toBe(6);
  });
});

describe('clearFilters', () => {
  it('removes every filter but keeps the sort, the direction and the page size', () => {
    const busy = withFilters(defaults(), {
      q: 'x',
      project: ['WEB'],
      statusKey: ['open'],
      assignee: ['me'],
      label: ['bug'],
      due: 'overdue',
      archived: true,
      sort: 'priority',
      dir: 'asc',
      pageSize: 25,
      page: 3,
    });
    expect(clearFilters(busy)).toEqual({
      ...defaults(),
      sort: 'priority',
      dir: 'asc',
      pageSize: 25,
    });
  });

  it('can leave the project alone, for a page that belongs to one project', () => {
    const busy = withFilters(defaults(), { project: ['WEB'], q: 'x' });
    expect(clearFilters(busy, { keepProject: true })).toMatchObject({ project: ['WEB'], q: '' });
  });
});

describe('hasActiveFilters', () => {
  it('is false for the defaults and for a different sort or page size', () => {
    expect(hasActiveFilters(defaults())).toBe(false);
    expect(
      hasActiveFilters(withFilters(defaults(), { sort: 'key', dir: 'asc', pageSize: 10 })),
    ).toBe(false);
  });

  it.each([
    ['text', { q: 'x' }],
    ['a project', { project: ['WEB'] }],
    ['a status', { statusKey: ['open'] }],
    ['a person', { assignee: ['me'] }],
    ['a label', { label: ['bug'] }],
    ['a due filter', { due: 'overdue' as const }],
    ['archived', { archived: true }],
  ])('is true with %s', (_label, patch) => {
    expect(hasActiveFilters(withFilters(defaults(), patch))).toBe(true);
  });

  it('can ignore the project, for a page that belongs to one project', () => {
    const scoped = withFilters(defaults(), { project: ['WEB'] });
    expect(hasActiveFilters(scoped, { ignoreProject: true })).toBe(false);
  });
});

describe('sortedBy', () => {
  it('flips the direction when the same column is chosen again', () => {
    const byKey = sortedBy(defaults(), 'key');
    expect(byKey).toMatchObject({ sort: 'key', dir: 'asc' });
    expect(sortedBy(byKey, 'key')).toMatchObject({ sort: 'key', dir: 'desc' });
    expect(sortedBy(sortedBy(byKey, 'key'), 'key')).toMatchObject({ dir: 'asc' });
  });

  it('starts a new column in its natural direction: newest and most urgent first, soonest due first', () => {
    expect(sortedBy(defaults(), 'priority')).toMatchObject({ sort: 'priority', dir: 'desc' });
    expect(sortedBy(defaults(), 'created')).toMatchObject({ sort: 'created', dir: 'desc' });
    expect(sortedBy(defaults(), 'due')).toMatchObject({ sort: 'due', dir: 'asc' });
    expect(sortedBy(defaults(), 'key')).toMatchObject({ sort: 'key', dir: 'asc' });
  });

  it('goes back to page 1', () => {
    expect(sortedBy(withFilters(defaults(), { page: 4 }), 'key').page).toBe(1);
  });
});

describe('hrefFor', () => {
  it('is just the path when nothing is set', () => {
    expect(hrefFor('/w/acme/tickets', defaults())).toBe('/w/acme/tickets');
  });

  it('puts the filters in the query string', () => {
    const href = hrefFor(
      '/w/acme/tickets',
      withFilters(defaults(), { q: 'login', priority: ['high'], sort: 'key', dir: 'asc' }),
    );
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/w/acme/tickets');
    expect(url.searchParams.get('q')).toBe('login');
    expect(url.searchParams.getAll('priority')).toEqual(['high']);
    expect(url.searchParams.get('sort')).toBe('key');
    expect(url.searchParams.get('dir')).toBe('asc');
    expect(url.searchParams.has('page')).toBe(false);
  });

  it('encodes awkward text safely', () => {
    const href = hrefFor('/w/acme/tickets', withFilters(defaults(), { q: 'a&b=c #1 ñ 👋' }));
    expect(new URL(href, 'http://x').searchParams.get('q')).toBe('a&b=c #1 ñ 👋');
  });

  it('can leave the project out, for a page that already names it', () => {
    const href = hrefFor(
      '/w/acme/projects/WEB/list',
      withFilters(defaults(), { project: ['WEB'], q: 'x' }),
      {
        omitProject: true,
      },
    );
    expect(href).toBe('/w/acme/projects/WEB/list?q=x');
  });
});

describe('structure filters', () => {
  const busy = () =>
    withFilters(defaults(), {
      parent: 'WEB-20',
      epic: 'WEB-5',
      linked: 'WEB-3',
      blocked: 'yes',
      top: true,
    });

  it('each shows as a chip in words', () => {
    expect(structureChips(busy()).map((chip) => chip.text)).toEqual([
      'Parent: WEB-20',
      'Epic: WEB-5',
      'Linked to: WEB-3',
      'Has blocker: Yes',
      'Top level only',
    ]);
    expect(
      structureChips(withFilters(defaults(), { blocked: 'no' })).map((chip) => chip.text),
    ).toEqual(['Has blocker: No']);
    expect(structureChips(defaults())).toEqual([]);
  });

  it('each chip removes only its own filter', () => {
    for (const chip of structureChips(busy())) {
      const left = withFilters(busy(), chip.remove);
      expect(structureChips(left)).toHaveLength(4);
    }
  });

  it('count as active, and are cleared with the rest', () => {
    for (const patch of [
      { parent: 'WEB-1' },
      { epic: 'WEB-1' },
      { linked: 'WEB-1' },
      { blocked: 'no' as const },
      { top: true },
    ]) {
      expect(hasActiveFilters(withFilters(defaults(), patch)), JSON.stringify(patch)).toBe(true);
    }
    expect(structureChips(clearFilters(busy()))).toEqual([]);
  });

  it('the tree is a way of looking, not a filter: it is not active and survives Clear all', () => {
    const tree = withFilters(defaults(), { tree: true, q: 'x' });
    expect(hasActiveFilters(withFilters(defaults(), { tree: true }))).toBe(false);
    expect(clearFilters(tree)).toMatchObject({ tree: true, q: '' });
  });
});
