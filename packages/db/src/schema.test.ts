import { SYSTEM_ROLES, SYSTEM_ROLE_KEYS } from '@forge/shared';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditEvents,
  createDb,
  createOrganisationWithSystemRoles,
  createPool,
  loadDotEnv,
  organisationMemberships,
  organisations,
  resetDatabaseForTests,
  roles,
  runMigrations,
  sessions,
  userPreferences,
  users,
  type Db,
} from './index';

let pool: Pool;
let db: Db;

// Drizzle wraps driver errors; the Postgres error code lives on `cause`.
async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const source = (error as { cause?: { code?: string } }).cause ?? error;
    return (source as { code?: string }).code;
  }
}

const UNIQUE = '23505';
const FOREIGN_KEY = '23503';
// ON DELETE RESTRICT reports restrict_violation rather than foreign_key_violation.
const RESTRICT = '23001';
const CHECK = '23514';

beforeAll(async () => {
  loadDotEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env.');
  pool = createPool(url);
  db = createDb(pool);
  await resetDatabaseForTests(pool);
  await runMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE audit_events, development_fixtures, user_preferences, sessions,
       organisation_memberships, roles, organisations, users CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

async function newUser(email: string) {
  const [row] = await db.insert(users).values({ email, displayName: email }).returning();
  return row!;
}

describe('users', () => {
  it('rejects an email that differs only by case', async () => {
    await newUser('Olivia@Acme.test');
    expect(await pgCode(newUser('olivia@acme.test'))).toBe(UNIQUE);
  });

  it('uses time-ordered v7 uuids for ids', async () => {
    const user = await newUser('a@acme.test');
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it('cannot be deleted while they have a session', async () => {
    const user = await newUser('a@acme.test');
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: 'hash-1',
      expiresAt: new Date(Date.now() + 60_000),
      createdVia: 'dev',
    });
    expect(await pgCode(db.delete(users).where(eq(users.id, user.id)))).toBe(RESTRICT);
  });
});

describe('organisations', () => {
  it.each(['Bad Slug!', 'a', 'acme-', '-acme', 'ACME'])('rejects the slug %j', async (slug) => {
    expect(await pgCode(createOrganisationWithSystemRoles(db, { slug, name: 'X' }))).toBe(CHECK);
  });

  it('accepts a normal slug and rejects a duplicate', async () => {
    await createOrganisationWithSystemRoles(db, { slug: 'acme', name: 'Acme' });
    expect(
      await pgCode(createOrganisationWithSystemRoles(db, { slug: 'acme', name: 'Again' })),
    ).toBe(UNIQUE);
  });

  it('creates every system role with the permissions defined in code', async () => {
    const { organisationId, roleIds } = await createOrganisationWithSystemRoles(db, {
      slug: 'acme',
      name: 'Acme',
    });
    const rows = await db.select().from(roles).where(eq(roles.organisationId, organisationId));
    expect(rows.map((row) => row.key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
    for (const row of rows) {
      expect(row.isSystem).toBe(true);
      expect(row.permissions).toEqual([
        ...SYSTEM_ROLES[row.key as keyof typeof SYSTEM_ROLES].permissions,
      ]);
      expect(roleIds[row.key as keyof typeof roleIds]).toBe(row.id);
    }
  });
});

describe('memberships', () => {
  it('cannot point at a role that belongs to another organisation', async () => {
    const acme = await createOrganisationWithSystemRoles(db, { slug: 'acme', name: 'Acme' });
    const northwind = await createOrganisationWithSystemRoles(db, { slug: 'northwind', name: 'N' });
    const user = await newUser('a@acme.test');

    const crossTenant = db.insert(organisationMemberships).values({
      organisationId: acme.organisationId,
      userId: user.id,
      roleId: northwind.roleIds.owner,
    });
    expect(await pgCode(crossTenant)).toBe(FOREIGN_KEY);
  });

  it('accepts a role from the same organisation', async () => {
    const acme = await createOrganisationWithSystemRoles(db, { slug: 'acme', name: 'Acme' });
    const user = await newUser('a@acme.test');
    await db.insert(organisationMemberships).values({
      organisationId: acme.organisationId,
      userId: user.id,
      roleId: acme.roleIds.developer,
    });
    const rows = await db.select().from(organisationMemberships);
    expect(rows).toHaveLength(1);
  });

  it('allows one membership per user per organisation', async () => {
    const acme = await createOrganisationWithSystemRoles(db, { slug: 'acme', name: 'Acme' });
    const user = await newUser('a@acme.test');
    const membership = {
      organisationId: acme.organisationId,
      userId: user.id,
      roleId: acme.roleIds.developer,
    };
    await db.insert(organisationMemberships).values(membership);
    expect(await pgCode(db.insert(organisationMemberships).values(membership))).toBe(UNIQUE);
  });

  it('blocks deleting a user, organisation or role that a membership still uses', async () => {
    const acme = await createOrganisationWithSystemRoles(db, { slug: 'acme', name: 'Acme' });
    const user = await newUser('a@acme.test');
    await db.insert(organisationMemberships).values({
      organisationId: acme.organisationId,
      userId: user.id,
      roleId: acme.roleIds.developer,
    });
    expect(await pgCode(db.delete(users).where(eq(users.id, user.id)))).toBe(RESTRICT);
    expect(await pgCode(db.delete(roles).where(eq(roles.id, acme.roleIds.developer)))).toBe(
      RESTRICT,
    );
    expect(
      await pgCode(db.delete(organisations).where(eq(organisations.id, acme.organisationId))),
    ).toBe(RESTRICT);
  });
});

describe('sessions', () => {
  it('requires a unique token hash', async () => {
    const user = await newUser('a@acme.test');
    const session = {
      userId: user.id,
      tokenHash: 'same-hash',
      expiresAt: new Date(Date.now() + 60_000),
      createdVia: 'dev',
    };
    await db.insert(sessions).values(session);
    expect(await pgCode(db.insert(sessions).values(session))).toBe(UNIQUE);
  });
});

describe('user preferences', () => {
  it('default to an empty object', async () => {
    const user = await newUser('a@acme.test');
    await db.insert(userPreferences).values({ userId: user.id });
    const [row] = await db.select().from(userPreferences);
    expect(row?.data).toEqual({});
  });
});

describe('audit events', () => {
  const base = { action: 'x', targetType: 'y', requestId: 'req-12345678' };

  it('accepts known sources and outcomes', async () => {
    await db.insert(auditEvents).values({ ...base, source: 'user', outcome: 'success' });
    expect(await db.select().from(auditEvents)).toHaveLength(1);
  });

  it('rejects an unknown source or outcome', async () => {
    expect(
      await pgCode(db.insert(auditEvents).values({ ...base, source: 'robot', outcome: 'success' })),
    ).toBe(CHECK);
    expect(
      await pgCode(db.insert(auditEvents).values({ ...base, source: 'user', outcome: 'maybe' })),
    ).toBe(CHECK);
  });
});
