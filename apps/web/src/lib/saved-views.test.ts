import type { SavedView, TicketFilters } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import { definitionFromFilters, matchesView, viewTarget } from './saved-views';
import { ticketQueryFromSearchParams, withFilters } from './ticket-query';

const base = ticketQueryFromSearchParams({}).filters;

const view = (
  over: { display?: SavedView['definition']['display']; filters?: Partial<TicketFilters> } = {},
): SavedView => ({
  id: '01a1656b-1a49-7146-94ac-1c72df43ddb4',
  name: 'My work',
  scope: 'personal',
  ownerUserId: '01a1656b-1a49-7146-94ac-1c72df43ddb5',
  updatedAt: '2030-01-01T00:00:00.000Z',
  definition: {
    display: over.display ?? 'list',
    filters: { ...definitionFromFilters(base, 'list').filters, ...(over.filters ?? {}) },
  },
});

describe('definitionFromFilters', () => {
  it('keeps every filter and the way it is sorted, but not the page', () => {
    const filters = withFilters(base, {
      q: 'login',
      project: ['WEB'],
      assignee: ['me'],
      sort: 'priority',
      dir: 'asc',
      pageSize: 25,
      page: 4,
    });
    const definition = definitionFromFilters(filters, 'board');
    expect(definition.display).toBe('board');
    expect(definition.filters).toMatchObject({
      q: 'login',
      project: ['WEB'],
      assignee: ['me'],
      sort: 'priority',
      dir: 'asc',
      pageSize: 25,
    });
    expect(definition.filters).not.toHaveProperty('page');
  });
});

describe('viewTarget', () => {
  it('opens a list view on the tickets page with its filters', () => {
    const href = viewTarget(
      'acme',
      view({ filters: { priority: ['high'], assignee: ['me'], sort: 'due', dir: 'asc' } }),
    );
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/w/acme/tickets');
    expect(url.searchParams.getAll('priority')).toEqual(['high']);
    expect(url.searchParams.getAll('assignee')).toEqual(['me']);
    expect(url.searchParams.get('sort')).toBe('due');
    expect(url.searchParams.has('page')).toBe(false);
  });

  it('opens a board view on that project’s board, without repeating the project', () => {
    const href = viewTarget(
      'acme',
      view({ display: 'board', filters: { project: ['WEB'], label: ['bug'] } }),
    );
    expect(href).toBe('/w/acme/projects/WEB/board?label=bug');
  });

  it('falls back to the list when a board view names no project, or several', () => {
    expect(new URL(viewTarget('acme', view({ display: 'board' })), 'http://x').pathname).toBe(
      '/w/acme/tickets',
    );
    expect(
      new URL(
        viewTarget('acme', view({ display: 'board', filters: { project: ['WEB', 'API'] } })),
        'http://x',
      ).pathname,
    ).toBe('/w/acme/tickets');
  });

  it('encodes an unusual workspace slug', () => {
    expect(new URL(viewTarget('a/b', view()), 'http://x').pathname).toBe('/w/a%2Fb/tickets');
  });
});

describe('matchesView', () => {
  const saved = view({ filters: { priority: ['high'], assignee: ['me'] } });

  it('is true for the same filters and display, whatever page it is on', () => {
    const filters = withFilters(base, { priority: ['high'], assignee: ['me'], page: 3 });
    expect(matchesView(saved, { ...filters, page: 3 }, 'list')).toBe(true);
  });

  it('is false when a filter, the sort or the display differs', () => {
    const same = withFilters(base, { priority: ['high'], assignee: ['me'] });
    expect(matchesView(saved, withFilters(same, { priority: ['low'] }), 'list')).toBe(false);
    expect(matchesView(saved, withFilters(same, { sort: 'key', dir: 'asc' }), 'list')).toBe(false);
    expect(matchesView(saved, same, 'board')).toBe(false);
    expect(matchesView(saved, base, 'list')).toBe(false);
  });
});
