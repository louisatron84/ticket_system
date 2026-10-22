import { organisationMemberships, roles, type Executor } from '@forge/db';
import { and, eq } from 'drizzle-orm';

export type MembershipRole = {
  userId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
};

/** A user's membership in one organisation, with the permissions of the role they hold there. */
export async function loadMembership(
  executor: Executor,
  organisationId: string,
  userId: string,
): Promise<MembershipRole | null> {
  const [row] = await executor
    .select({
      userId: organisationMemberships.userId,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      permissions: roles.permissions,
    })
    .from(organisationMemberships)
    .innerJoin(
      roles,
      and(
        eq(roles.id, organisationMemberships.roleId),
        eq(roles.organisationId, organisationMemberships.organisationId),
      ),
    )
    .where(
      and(
        eq(organisationMemberships.organisationId, organisationId),
        eq(organisationMemberships.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}
