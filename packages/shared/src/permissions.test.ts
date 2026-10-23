import { describe, expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_KEYS, hasPermission } from './permissions';

describe('system roles', () => {
  it.each(SYSTEM_ROLE_KEYS)('%s uses its own key and only known, unique permissions', (key) => {
    const role = SYSTEM_ROLES[key];
    expect(role.key).toBe(key);
    expect(new Set(role.permissions).size).toBe(role.permissions.length);
    for (const permission of role.permissions) expect(PERMISSIONS).toContain(permission);
  });

  it('gives owner and admin every permission', () => {
    expect([...SYSTEM_ROLES.owner.permissions].sort()).toEqual([...PERMISSIONS].sort());
    expect([...SYSTEM_ROLES.admin.permissions].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('limits read-only to viewing the workspace, members and tickets', () => {
    expect([...SYSTEM_ROLES.readonly.permissions].sort()).toEqual([
      'members.view',
      'tickets.view',
      'workspace.view',
    ]);
  });

  it('lets a reviewer approve and merge but not edit tickets', () => {
    const held = SYSTEM_ROLES.reviewer.permissions;
    expect(hasPermission(held, 'reviews.approve')).toBe(true);
    expect(hasPermission(held, 'pullRequests.merge')).toBe(true);
    expect(hasPermission(held, 'tickets.edit')).toBe(false);
  });

  it('lets a developer work tickets and branches but not approve or manage members', () => {
    const held = SYSTEM_ROLES.developer.permissions;
    for (const permission of ['tickets.create', 'tickets.edit', 'branches.create'] as const) {
      expect(hasPermission(held, permission)).toBe(true);
    }
    expect(hasPermission(held, 'reviews.approve')).toBe(false);
    expect(hasPermission(held, 'members.manage')).toBe(false);
  });

  it('keeps project configuration to owners and administrators', () => {
    const holders = SYSTEM_ROLE_KEYS.filter((key) =>
      hasPermission(SYSTEM_ROLES[key].permissions, 'projects.manage'),
    );
    expect(holders).toEqual(['owner', 'admin']);
  });

  it('lets developers and reviewers comment on tickets, but not read-only members', () => {
    const holders = SYSTEM_ROLE_KEYS.filter((key) =>
      hasPermission(SYSTEM_ROLES[key].permissions, 'tickets.comment'),
    );
    expect(holders).toEqual(['owner', 'admin', 'developer', 'reviewer']);
  });
});

describe('hasPermission', () => {
  it('is true only for a held permission', () => {
    expect(hasPermission(['tickets.view'], 'tickets.view')).toBe(true);
    expect(hasPermission(['tickets.view'], 'tickets.edit')).toBe(false);
    expect(hasPermission([], 'tickets.view')).toBe(false);
  });

  it('does not match on prefixes or case', () => {
    expect(hasPermission(['tickets.view.all'], 'tickets.view')).toBe(false);
    expect(hasPermission(['TICKETS.VIEW'], 'tickets.view')).toBe(false);
  });
});
