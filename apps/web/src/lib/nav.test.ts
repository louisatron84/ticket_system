import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, breadcrumbsFor, visibleNavItems } from './nav';

describe('navigation registry', () => {
  it('lists all ten product areas from the spec', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Overview',
      'My Work',
      'Projects',
      'Tickets',
      'Repositories',
      'Code Reviews',
      'Workflows',
      'Activity',
      'Notifications',
      'Search',
    ]);
  });

  it('shows only routes that exist', () => {
    expect(visibleNavItems().map((item) => item.label)).toEqual(['Overview']);
  });

  it('never exposes a placeholder link', () => {
    for (const item of visibleNavItems()) {
      expect(item.href).toMatch(/^\/\S*$/);
      expect(item.href).not.toBe('#');
    }
  });

  it('gives every item a unique id and href', () => {
    expect(new Set(NAV_ITEMS.map((item) => item.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((item) => item.href)).size).toBe(NAV_ITEMS.length);
  });

  it('filters a custom list by availability', () => {
    const [first, ...rest] = NAV_ITEMS;
    const items = [{ ...first!, availability: 'planned' as const }, ...rest];
    expect(visibleNavItems(items)).toEqual([]);
  });
});

describe('breadcrumbsFor', () => {
  it('names the current page from the registry', () => {
    expect(breadcrumbsFor('/')).toEqual([{ label: 'Overview' }]);
  });

  it('returns no crumbs for a path the registry does not know', () => {
    expect(breadcrumbsFor('/does-not-exist')).toEqual([]);
  });
});
