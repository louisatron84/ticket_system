import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLES, type SystemRoleKey } from './permissions';
import { decideRoleChange, type MemberRoleChange } from './role-rules';

const actorFor = (userId: string, key: SystemRoleKey) => ({
  userId,
  roleKey: key,
  permissions: SYSTEM_ROLES[key].permissions,
});
const roleFor = (key: SystemRoleKey) => ({ key, permissions: SYSTEM_ROLES[key].permissions });

function change(overrides: Partial<MemberRoleChange> = {}): MemberRoleChange {
  return {
    actor: actorFor('admin-1', 'admin'),
    target: { userId: 'dev-2', roleKey: 'developer' },
    newRole: roleFor('reviewer'),
    ownerCount: 2,
    ...overrides,
  };
}

describe('decideRoleChange', () => {
  it('allows an admin to move a developer to reviewer', () => {
    expect(decideRoleChange(change())).toEqual({ allowed: true });
  });

  it('allows an owner to promote a developer to owner', () => {
    const decision = decideRoleChange(
      change({ actor: actorFor('owner-1', 'owner'), newRole: roleFor('owner') }),
    );
    expect(decision).toEqual({ allowed: true });
  });

  it('refuses anyone without members.manage', () => {
    const decision = decideRoleChange(change({ actor: actorFor('dev-1', 'developer') }));
    expect(decision).toEqual({ allowed: false, reason: 'missing_permission' });
  });

  it('reports missing permission before any other reason', () => {
    const decision = decideRoleChange({
      actor: actorFor('dev-1', 'developer'),
      target: { userId: 'dev-1', roleKey: 'developer' },
      newRole: roleFor('owner'),
      ownerCount: 1,
    });
    expect(decision).toEqual({ allowed: false, reason: 'missing_permission' });
  });

  it.each<SystemRoleKey>(['admin', 'owner'])('refuses a %s changing their own role', (key) => {
    const decision = decideRoleChange(
      change({
        actor: actorFor('self-1', key),
        target: { userId: 'self-1', roleKey: key },
        newRole: roleFor('developer'),
      }),
    );
    expect(decision).toEqual({ allowed: false, reason: 'cannot_change_own_role' });
  });

  it('refuses an admin promoting someone to owner', () => {
    const decision = decideRoleChange(change({ newRole: roleFor('owner') }));
    expect(decision).toEqual({ allowed: false, reason: 'owner_required' });
  });

  it('refuses an admin demoting an owner', () => {
    const decision = decideRoleChange(
      change({ target: { userId: 'owner-2', roleKey: 'owner' }, newRole: roleFor('developer') }),
    );
    expect(decision).toEqual({ allowed: false, reason: 'owner_required' });
  });

  it('refuses granting a role that holds permissions the actor lacks', () => {
    const actor = {
      userId: 'custom-1',
      roleKey: 'custom',
      permissions: ['members.manage', 'workspace.view'],
    };
    const decision = decideRoleChange(change({ actor, newRole: roleFor('reviewer') }));
    expect(decision).toEqual({ allowed: false, reason: 'exceeds_own_permissions' });
  });

  it('refuses demoting the last owner', () => {
    const decision = decideRoleChange({
      actor: actorFor('owner-1', 'owner'),
      target: { userId: 'owner-2', roleKey: 'owner' },
      newRole: roleFor('developer'),
      ownerCount: 1,
    });
    expect(decision).toEqual({ allowed: false, reason: 'last_owner' });
  });

  it('allows demoting an owner when another owner remains', () => {
    const decision = decideRoleChange({
      actor: actorFor('owner-1', 'owner'),
      target: { userId: 'owner-2', roleKey: 'owner' },
      newRole: roleFor('developer'),
      ownerCount: 2,
    });
    expect(decision).toEqual({ allowed: true });
  });
});
