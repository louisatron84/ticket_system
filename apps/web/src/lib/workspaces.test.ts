import type { Membership } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import { currentWorkspace, pickDefaultWorkspace, workspaceSlugFromPath } from './workspaces';

const uuid = '01a1656b-1a49-7146-94ac-1c72df43ddb4';
const membership = (
  slug: string,
  name: string,
  permissions: Membership['permissions'],
): Membership => ({
  organisation: { id: uuid, slug, name },
  role: { id: uuid, key: 'x', name: 'X' },
  permissions,
});

const acme = membership('acme', 'Acme Robotics', ['workspace.view']);
const northwind = membership('northwind', 'Northwind Traders', ['workspace.view']);
const locked = membership('aardvark', 'Aardvark Labs', []);

describe('pickDefaultWorkspace', () => {
  it('returns null when there are no memberships', () => {
    expect(pickDefaultWorkspace([])).toBeNull();
  });

  it('prefers the first viewable workspace by name', () => {
    expect(pickDefaultWorkspace([northwind, acme])?.organisation.slug).toBe('acme');
  });

  it('skips a workspace the person cannot view when another is available', () => {
    expect(pickDefaultWorkspace([locked, northwind])?.organisation.slug).toBe('northwind');
  });

  it('falls back to the first workspace when none is viewable, so they see why', () => {
    expect(pickDefaultWorkspace([locked])?.organisation.slug).toBe('aardvark');
  });
});

describe('workspaceSlugFromPath', () => {
  it.each([
    ['/w/acme', 'acme'],
    ['/w/acme/members', 'acme'],
    ['/w/acme/', 'acme'],
    ['/w/a%2Fb/members', 'a/b'],
  ])('reads the slug from %s', (path, slug) => {
    expect(workspaceSlugFromPath(path)).toBe(slug);
  });

  it.each(['/', '/w', '/w/', '/settings/profile', '/worlds/acme', '/w/%E0%A4%A'])(
    'finds no workspace in %s',
    (path) => {
      expect(workspaceSlugFromPath(path)).toBeNull();
    },
  );
});

describe('currentWorkspace', () => {
  const memberships = [acme, northwind];

  it('uses the workspace named in the URL', () => {
    expect(currentWorkspace(memberships, '/w/northwind/members')?.organisation.slug).toBe(
      'northwind',
    );
  });

  it('falls back to the default on pages outside any workspace', () => {
    expect(currentWorkspace(memberships, '/settings/profile')?.organisation.slug).toBe('acme');
  });

  it('does not invent a workspace for a URL naming one the person is not in', () => {
    expect(currentWorkspace(memberships, '/w/secret')?.organisation.slug).toBe('acme');
  });

  it('returns null when the person has no workspaces', () => {
    expect(currentWorkspace([], '/')).toBeNull();
  });
});
