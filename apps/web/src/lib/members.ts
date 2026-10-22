import { decideRoleChange, type MemberRoleChange, type RoleDetail } from '@forge/shared';

/**
 * The roles this actor may give this member, using the same rules as the API. This only decides
 * which options to show; the API re-checks everything and stays authoritative.
 */
export function assignableRoles(input: {
  actor: MemberRoleChange['actor'];
  target: MemberRoleChange['target'];
  roles: RoleDetail[];
  ownerCount: number;
}): RoleDetail[] {
  return input.roles.filter(
    (role) =>
      decideRoleChange({
        actor: input.actor,
        target: input.target,
        newRole: { key: role.key, permissions: role.permissions },
        ownerCount: input.ownerCount,
      }).allowed,
  );
}
