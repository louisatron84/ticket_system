import { hasPermission } from './permissions';

export type MemberRoleChange = {
  actor: { userId: string; roleKey: string; permissions: readonly string[] };
  target: { userId: string; roleKey: string };
  newRole: { key: string; permissions: readonly string[] };
  /** How many owners the workspace has right now, including the target if they are one. */
  ownerCount: number;
};

export type RoleChangeDenial =
  | 'missing_permission'
  | 'cannot_change_own_role'
  | 'owner_required'
  | 'exceeds_own_permissions'
  | 'last_owner';

export type RoleChangeDecision = { allowed: true } | { allowed: false; reason: RoleChangeDenial };

const deny = (reason: RoleChangeDenial): RoleChangeDecision => ({ allowed: false, reason });

/**
 * Pure rules for changing a member's role. The API applies them authoritatively; the web app
 * reuses them only to decide which options to offer.
 */
export function decideRoleChange({
  actor,
  target,
  newRole,
  ownerCount,
}: MemberRoleChange): RoleChangeDecision {
  if (!hasPermission(actor.permissions, 'members.manage')) return deny('missing_permission');

  // Nobody can escalate (or lock themselves out) by editing their own membership.
  if (actor.userId === target.userId) return deny('cannot_change_own_role');

  const touchesOwner = target.roleKey === 'owner' || newRole.key === 'owner';
  if (touchesOwner && actor.roleKey !== 'owner') return deny('owner_required');

  const held = new Set(actor.permissions);
  if (newRole.permissions.some((permission) => !held.has(permission))) {
    return deny('exceeds_own_permissions');
  }

  if (target.roleKey === 'owner' && newRole.key !== 'owner' && ownerCount <= 1) {
    return deny('last_owner');
  }

  return { allowed: true };
}
