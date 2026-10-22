import { SYSTEM_ROLES, SYSTEM_ROLE_KEYS, type SystemRoleKey } from '@forge/shared';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type * as schema from './schema';
import { organisations, roles } from './schema';

/** Either the database or an open transaction: both expose the same query builders. */
export type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/** Creates an organisation together with the five system roles every organisation has. */
export async function createOrganisationWithSystemRoles(
  executor: Executor,
  input: { slug: string; name: string },
): Promise<{ organisationId: string; roleIds: Record<SystemRoleKey, string> }> {
  const [organisation] = await executor
    .insert(organisations)
    .values({ slug: input.slug, name: input.name })
    .returning({ id: organisations.id });
  if (!organisation) throw new Error('Organisation insert returned no row');

  const inserted = await executor
    .insert(roles)
    .values(
      SYSTEM_ROLE_KEYS.map((key) => ({
        organisationId: organisation.id,
        key,
        name: SYSTEM_ROLES[key].name,
        description: SYSTEM_ROLES[key].description,
        permissions: [...SYSTEM_ROLES[key].permissions],
        isSystem: true,
      })),
    )
    .returning({ id: roles.id, key: roles.key });

  const roleIds = Object.fromEntries(inserted.map((row) => [row.key, row.id])) as Record<
    SystemRoleKey,
    string
  >;
  return { organisationId: organisation.id, roleIds };
}
