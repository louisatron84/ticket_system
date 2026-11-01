import { components, organisationMemberships, roles, users, type Executor } from '@forge/db';
import { and, asc, eq, sql } from 'drizzle-orm';

/**
 * Members whose role lets them see tickets: the only people who may lead a component or be its
 * default assignee. Ordered by name, for pickers.
 */
export async function ticketViewers(
  tx: Executor,
  organisationId: string,
): Promise<{ id: string; displayName: string }[]> {
  return tx
    .select({ id: users.id, displayName: users.displayName })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .innerJoin(roles, eq(roles.id, organisationMemberships.roleId))
    .where(
      and(
        eq(organisationMemberships.organisationId, organisationId),
        sql`'tickets.view' = any(${roles.permissions})`,
      ),
    )
    .orderBy(asc(users.displayName), asc(users.id));
}

/**
 * Who a new ticket with this component goes to when nobody was chosen: the component's default
 * assignee, if it has one and that person can still see tickets (a role change since may have
 * taken that away). Null otherwise.
 */
export async function componentDefaultAssignee(
  tx: Executor,
  organisationId: string,
  componentId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ userId: organisationMemberships.userId })
    .from(components)
    .innerJoin(
      organisationMemberships,
      and(
        eq(organisationMemberships.organisationId, components.organisationId),
        eq(organisationMemberships.userId, components.defaultAssigneeId),
      ),
    )
    .innerJoin(roles, eq(roles.id, organisationMemberships.roleId))
    .where(
      and(
        eq(components.organisationId, organisationId),
        eq(components.id, componentId),
        sql`'tickets.view' = any(${roles.permissions})`,
      ),
    );
  return row?.userId ?? null;
}
