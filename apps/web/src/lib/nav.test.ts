import { PERMISSIONS } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, breadcrumbsFor, visibleNavItems } from './nav';

const acme = { slug: 'acme', name: 'Acme Robotics' };

describe('navigation registry', () => {
  it('lists the ten product areas from the spec, then the admin area', () => {
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
      'Members',
    ]);
  });

  it('gives every item a unique id and path', () => {
    expect(new Set(NAV_ITEMS.map((item) => item.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((item) => item.path)).size).toBe(NAV_ITEMS.length);
  });

  it('keeps every path workspace-relative', () => {
    for (const item of NAV_ITEMS) expect(item.path).toMatch(/^(\/[a-z-]+)*$/);
  });
});

describe('visibleNavItems', () => {
  const visible = (permissions: string[], slug = 'acme') =>
    visibleNavItems({ slug, permissions }).map((item) => item.label);

  it('shows nothing to someone with no permissions', () => {
    expect(visible([])).toEqual([]);
  });

  it('shows the overview to someone who may view the workspace', () => {
    expect(visible(['workspace.view'])).toEqual(['Overview']);
  });

  it('adds Members only with members.view', () => {
    expect(visible(['workspace.view', 'members.view'])).toEqual(['Overview', 'Members']);
    expect(visible(['members.view'])).toEqual(['Members']);
  });

  it('never shows planned areas, even to someone holding every permission', () => {
    expect(visible([...PERMISSIONS])).toEqual(['Overview', 'Members']);
  });

  it('puts the workspace slug into every href', () => {
    const items = visibleNavItems({
      slug: 'acme',
      permissions: ['workspace.view', 'members.view'],
    });
    expect(items.map((item) => item.href)).toEqual(['/w/acme', '/w/acme/members']);
  });

  it('encodes an unusual slug instead of trusting it', () => {
    const [item] = visibleNavItems({ slug: 'a/b?c', permissions: ['workspace.view'] });
    expect(item?.href).toBe('/w/a%2Fb%3Fc');
  });
});

describe('breadcrumbsFor', () => {
  it('names the workspace and the page', () => {
    expect(breadcrumbsFor('/w/acme', acme)).toEqual([
      { label: 'Acme Robotics', href: '/w/acme' },
      { label: 'Overview' },
    ]);
    expect(breadcrumbsFor('/w/acme/members', acme)).toEqual([
      { label: 'Acme Robotics', href: '/w/acme' },
      { label: 'Members' },
    ]);
  });

  it('names the profile page', () => {
    expect(breadcrumbsFor('/settings/profile')).toEqual([{ label: 'Profile' }]);
  });

  it('returns no crumbs for a path it does not know', () => {
    expect(breadcrumbsFor('/does-not-exist')).toEqual([]);
    expect(breadcrumbsFor('/w/acme/unknown', acme)).toEqual([]);
  });
});
