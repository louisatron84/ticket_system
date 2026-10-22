import { SYSTEM_ROLES, SYSTEM_ROLE_KEYS, type RoleDetail } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import { assignableRoles } from './members';

const uuid = (n: number) => `01a1656b-1a49-7146-94ac-1c72df43dd${String(n).padStart(2, '0')}`;

const roles: RoleDetail[] = [
  ...SYSTEM_ROLE_KEYS.map((key, index) => ({
    id: uuid(index),
    key,
    name: SYSTEM_ROLES[key].name,
    description: SYSTEM_ROLES[key].description,
    permissions: [...SYSTEM_ROLES[key].permissions],
  })),
  { id: uuid(9), key: 'restricted', name: 'Restricted', description: '', permissions: [] },
];

const actorFor = (key: (typeof SYSTEM_ROLE_KEYS)[number], userId = 'actor') => ({
  userId,
  roleKey: key,
  permissions: SYSTEM_ROLES[key].permissions,
});
const keys = (list: RoleDetail[]) => list.map((role) => role.key);

describe('assignableRoles', () => {
  it('offers an owner every role for a developer', () => {
    const offered = assignableRoles({
      actor: actorFor('owner'),
      target: { userId: 'dana', roleKey: 'developer' },
      roles,
      ownerCount: 1,
    });
    expect(keys(offered)).toEqual(keys(roles));
  });

  it('offers an administrator everything except owner for a developer', () => {
    const offered = assignableRoles({
      actor: actorFor('admin'),
      target: { userId: 'dana', roleKey: 'developer' },
      roles,
      ownerCount: 1,
    });
    expect(keys(offered)).not.toContain('owner');
    expect(keys(offered)).toEqual(expect.arrayContaining(['admin', 'developer', 'restricted']));
  });

  it('offers an administrator nothing for an owner', () => {
    expect(
      assignableRoles({
        actor: actorFor('admin'),
        target: { userId: 'olivia', roleKey: 'owner' },
        roles,
        ownerCount: 1,
      }),
    ).toEqual([]);
  });

  it('offers nothing to someone without members.manage', () => {
    expect(
      assignableRoles({
        actor: actorFor('developer'),
        target: { userId: 'dana', roleKey: 'reviewer' },
        roles,
        ownerCount: 1,
      }),
    ).toEqual([]);
  });

  it('offers nothing for yourself', () => {
    expect(
      assignableRoles({
        actor: actorFor('owner', 'me'),
        target: { userId: 'me', roleKey: 'owner' },
        roles,
        ownerCount: 2,
      }),
    ).toEqual([]);
  });

  it('does not offer to demote the only owner', () => {
    const offered = assignableRoles({
      actor: actorFor('owner'),
      target: { userId: 'olivia', roleKey: 'owner' },
      roles,
      ownerCount: 1,
    });
    expect(keys(offered)).toEqual(['owner']);
  });
});
