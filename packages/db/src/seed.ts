import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { createOrganisationWithSystemRoles, type Executor } from './organisations';
import { truncateAllTables } from './reset';
import { insertDemoTickets } from './seed-tickets';
import {
  developmentFixtures,
  organisationMemberships,
  organisations,
  roles,
  users,
} from './schema';

export type DevIdentityDefinition = {
  key: string;
  email: string;
  displayName: string;
  label: string;
  description: string;
  memberships: { organisationSlug: string; roleKey: string }[];
};

export const DEV_ORGANISATIONS = [
  { slug: 'acme', name: 'Acme Robotics' },
  { slug: 'northwind', name: 'Northwind Traders' },
] as const;

/** A member with no permissions at all, for exercising denied actions. Acme only. */
const RESTRICTED_ROLE = {
  key: 'restricted',
  name: 'Restricted',
  description: 'A member with no permissions. Used to test denied actions.',
} as const;

/** In display order. Emails use the reserved .test domain, so they can never be real addresses. */
export const DEV_IDENTITIES: readonly DevIdentityDefinition[] = [
  {
    key: 'owner',
    email: 'owner@acme.test',
    displayName: 'Olivia Owner',
    label: 'Owner',
    description: 'Full workspace administration, including who else is an owner.',
    memberships: [{ organisationSlug: 'acme', roleKey: 'owner' }],
  },
  {
    key: 'admin',
    email: 'admin@acme.test',
    displayName: 'Adam Admin',
    label: 'Administrator',
    description: 'Configuration and member management, but cannot touch owners.',
    memberships: [{ organisationSlug: 'acme', roleKey: 'admin' }],
  },
  {
    key: 'developer',
    email: 'developer@acme.test',
    displayName: 'Dana Developer',
    label: 'Developer',
    description: 'Ticket work, branches and commits. Also a read-only member of Northwind.',
    memberships: [
      { organisationSlug: 'acme', roleKey: 'developer' },
      { organisationSlug: 'northwind', roleKey: 'readonly' },
    ],
  },
  {
    key: 'reviewer',
    email: 'reviewer@acme.test',
    displayName: 'Riley Reviewer',
    label: 'Reviewer',
    description: 'Code review and approval.',
    memberships: [{ organisationSlug: 'acme', roleKey: 'reviewer' }],
  },
  {
    key: 'readonly',
    email: 'readonly@acme.test',
    displayName: 'Remy Read-only',
    label: 'Read-only user',
    description: 'Permission and visibility testing: can look, cannot change.',
    memberships: [{ organisationSlug: 'acme', roleKey: 'readonly' }],
  },
  {
    key: 'restricted',
    email: 'restricted@acme.test',
    displayName: 'Casey Restricted',
    label: 'Restricted user',
    description: 'A member with no permissions, for testing denied actions.',
    memberships: [{ organisationSlug: 'acme', roleKey: 'restricted' }],
  },
  {
    key: 'other-owner',
    email: 'owner@northwind.test',
    displayName: 'Nora Northwind',
    label: 'Second organisation owner',
    description: 'Owns a different workspace, for testing tenant isolation.',
    memberships: [{ organisationSlug: 'northwind', roleKey: 'owner' }],
  },
];

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to touch development data when NODE_ENV=production.');
  }
}

async function insertDevelopmentData(tx: Executor): Promise<void> {
  const roleIdsByOrganisation = new Map<string, Map<string, string>>();

  for (const { slug, name } of DEV_ORGANISATIONS) {
    const { organisationId, roleIds } = await createOrganisationWithSystemRoles(tx, { slug, name });
    const byKey = new Map<string, string>(Object.entries(roleIds));
    if (slug === 'acme') {
      const [restricted] = await tx
        .insert(roles)
        .values({ organisationId, ...RESTRICTED_ROLE, permissions: [], isSystem: false })
        .returning({ id: roles.id });
      byKey.set(RESTRICTED_ROLE.key, restricted!.id);
    }
    roleIdsByOrganisation.set(slug, byKey);
    // organisation ids are looked up again below by slug, keeping this loop about roles only
  }

  const organisationIds = new Map(
    (await tx.select({ id: organisations.id, slug: organisations.slug }).from(organisations)).map(
      (row) => [row.slug, row.id] as const,
    ),
  );

  const userIds = new Map<string, string>();
  for (const [index, identity] of DEV_IDENTITIES.entries()) {
    const [user] = await tx
      .insert(users)
      .values({ email: identity.email, displayName: identity.displayName })
      .returning({ id: users.id });
    userIds.set(identity.key, user!.id);

    for (const { organisationSlug, roleKey } of identity.memberships) {
      const organisationId = organisationIds.get(organisationSlug);
      const roleId = roleIdsByOrganisation.get(organisationSlug)?.get(roleKey);
      if (!organisationId || !roleId) {
        throw new Error(`Seed bug: unknown ${organisationSlug}/${roleKey} for ${identity.key}`);
      }
      await tx.insert(organisationMemberships).values({ organisationId, userId: user!.id, roleId });
    }

    await tx.insert(developmentFixtures).values({
      key: identity.key,
      userId: user!.id,
      label: identity.label,
      description: identity.description,
      sortOrder: index,
    });
  }

  await insertDemoTickets(tx, { organisationIds, userIds });
}

/** Wipes every table, then recreates the demo organisations and test identities. */
export async function reseedDevelopmentData(db: Db): Promise<void> {
  assertNotProduction();
  await db.transaction(async (tx) => {
    await truncateAllTables(tx);
    await insertDevelopmentData(tx);
  });
}

/** Seeds only when there are no organisations yet. Returns whether it seeded. */
export async function seedDevelopmentDataIfEmpty(db: Db): Promise<boolean> {
  assertNotProduction();
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(organisations);
    if ((row?.n ?? 0) > 0) return false;
    await insertDevelopmentData(tx);
    return true;
  });
}
