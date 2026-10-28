import { and, eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEV_IDENTITIES,
  createDb,
  createPool,
  developmentFixtures,
  loadDotEnv,
  organisationMemberships,
  organisations,
  reseedDevelopmentData,
  resetDatabaseForTests,
  roles,
  runMigrations,
  seedDevelopmentDataIfEmpty,
  users,
  type Db,
} from './index';

let pool: Pool;
let db: Db;

const count = async (table: PgTable) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

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
  await pool.query('TRUNCATE users, organisations CASCADE');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await pool.end();
});

describe('DEV_IDENTITIES', () => {
  it('lists the eight test identities in display order', () => {
    expect(DEV_IDENTITIES.map((identity) => identity.key)).toEqual([
      'owner',
      'admin',
      'developer',
      'reviewer',
      'readonly',
      'restricted',
      'reporter',
      'other-owner',
    ]);
  });

  it('uses the reserved .test domain for every email', () => {
    for (const identity of DEV_IDENTITIES) expect(identity.email).toMatch(/@[a-z]+\.test$/);
  });
});

describe('reseedDevelopmentData', () => {
  it('creates two organisations, eight users and eight fixtures', async () => {
    await reseedDevelopmentData(db);
    expect(await count(organisations)).toBe(2);
    expect(await count(users)).toBe(8);
    expect(await count(developmentFixtures)).toBe(8);
  });

  it('gives every identity exactly the memberships it declares', async () => {
    await reseedDevelopmentData(db);
    for (const identity of DEV_IDENTITIES) {
      const rows = await db
        .select({ slug: organisations.slug, roleKey: roles.key })
        .from(organisationMemberships)
        .innerJoin(users, eq(users.id, organisationMemberships.userId))
        .innerJoin(organisations, eq(organisations.id, organisationMemberships.organisationId))
        .innerJoin(roles, eq(roles.id, organisationMemberships.roleId))
        .where(eq(users.email, identity.email));
      const actual = rows.map((row) => `${row.slug}:${row.roleKey}`).sort();
      const expected = identity.memberships.map((m) => `${m.organisationSlug}:${m.roleKey}`).sort();
      expect(actual).toEqual(expected);
    }
  });

  it('makes the developer a member of both organisations', async () => {
    await reseedDevelopmentData(db);
    const developer = DEV_IDENTITIES.find((identity) => identity.key === 'developer')!;
    expect(developer.memberships).toEqual([
      { organisationSlug: 'acme', roleKey: 'developer' },
      { organisationSlug: 'northwind', roleKey: 'readonly' },
    ]);
  });

  it('adds a permissionless custom restricted role to acme only', async () => {
    await reseedDevelopmentData(db);
    const restricted = await db
      .select({
        slug: organisations.slug,
        isSystem: roles.isSystem,
        permissions: roles.permissions,
      })
      .from(roles)
      .innerJoin(organisations, eq(organisations.id, roles.organisationId))
      .where(eq(roles.key, 'restricted'));
    expect(restricted).toEqual([{ slug: 'acme', isSystem: false, permissions: [] }]);
  });

  it('links each fixture key to its user in display order', async () => {
    await reseedDevelopmentData(db);
    const rows = await db
      .select({
        key: developmentFixtures.key,
        email: users.email,
        sortOrder: developmentFixtures.sortOrder,
      })
      .from(developmentFixtures)
      .innerJoin(users, eq(users.id, developmentFixtures.userId))
      .orderBy(developmentFixtures.sortOrder);
    expect(rows.map((row) => [row.key, row.email])).toEqual(
      DEV_IDENTITIES.map((identity) => [identity.key, identity.email]),
    );
  });

  it('is repeatable: running twice gives the same data', async () => {
    await reseedDevelopmentData(db);
    await reseedDevelopmentData(db);
    expect(await count(organisations)).toBe(2);
    expect(await count(users)).toBe(8);
    expect(await count(organisationMemberships)).toBe(9);
  });

  it('wipes anything that was not part of the seed', async () => {
    await db.insert(users).values({ email: 'stranger@example.test', displayName: 'Stranger' });
    await db.insert(organisations).values({ slug: 'stray', name: 'Stray' });
    await reseedDevelopmentData(db);
    expect(await db.select().from(users).where(eq(users.email, 'stranger@example.test'))).toEqual(
      [],
    );
    expect(await db.select().from(organisations).where(eq(organisations.slug, 'stray'))).toEqual(
      [],
    );
  });

  it('empties every table in the public schema, not just a known list', async () => {
    await pool.query('CREATE TABLE zz_adhoc (id int)');
    try {
      await pool.query('INSERT INTO zz_adhoc VALUES (1)');
      await reseedDevelopmentData(db);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM zz_adhoc');
      expect(rows[0].n).toBe(0);
    } finally {
      await pool.query('DROP TABLE zz_adhoc');
    }
  });

  it('refuses under NODE_ENV=production and changes nothing', async () => {
    await db.insert(users).values({ email: 'keep@example.test', displayName: 'Keep' });
    vi.stubEnv('NODE_ENV', 'production');
    await expect(reseedDevelopmentData(db)).rejects.toThrow(/production/);
    vi.unstubAllEnvs();
    expect(
      await db
        .select()
        .from(users)
        .where(and(eq(users.email, 'keep@example.test'))),
    ).toHaveLength(1);
  });
});

describe('seedDevelopmentDataIfEmpty', () => {
  it('seeds an empty database once and then leaves it alone', async () => {
    expect(await seedDevelopmentDataIfEmpty(db)).toBe(true);
    expect(await seedDevelopmentDataIfEmpty(db)).toBe(false);
    expect(await count(users)).toBe(8);
  });

  it('does not touch a database that already has organisations', async () => {
    await db.insert(organisations).values({ slug: 'existing', name: 'Existing' });
    expect(await seedDevelopmentDataIfEmpty(db)).toBe(false);
    expect(await count(users)).toBe(0);
  });

  it('refuses under NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(seedDevelopmentDataIfEmpty(db)).rejects.toThrow(/production/);
  });
});
