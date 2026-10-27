import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createOrganisationWithSystemRoles,
  createPool,
  createProject,
  ensureOrganisationDefaults,
  loadDotEnv,
  priorities,
  projectStatuses,
  resetDatabaseForTests,
  runMigrations,
  users,
  type Db,
} from './index';

// Like the status rename before it, this migration is plain SQL, so the test runs the file itself
// against rows that carry the names they had before it existed.
const MIGRATION = new URL('../migrations/0004_forge_heat_names.sql', import.meta.url);
const OLD_PRIORITIES: Record<string, string> = {
  lowest: 'Lowest',
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
};
const NEW_PRIORITIES: Record<string, string> = {
  lowest: 'Heatless',
  low: 'Ember',
  normal: 'Flame',
  high: 'Blaze',
  critical: 'Inferno',
};

let pool: Pool;
let db: Db;

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
  await pool.query(`TRUNCATE users, organisations CASCADE`);
});

afterAll(async () => {
  await pool.end();
});

async function runMigration() {
  const statements = readFileSync(MIGRATION, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await pool.query(statement);
}

/** A workspace and project whose priorities and Blocked status carry their old names. */
async function workspaceWithOldNames(slug: string, key: string, userId: string) {
  const { organisationId } = await createOrganisationWithSystemRoles(db, { slug, name: slug });
  await ensureOrganisationDefaults(db, organisationId);
  const { projectId } = await createProject(db, {
    organisationId,
    key,
    name: key,
    createdBy: userId,
  });
  for (const [priorityKey, name] of Object.entries(OLD_PRIORITIES)) {
    await pool.query('UPDATE priorities SET name = $1 WHERE organisation_id = $2 AND key = $3', [
      name,
      organisationId,
      priorityKey,
    ]);
  }
  await pool.query(
    `UPDATE project_statuses SET name = 'Blocked' WHERE project_id = $1 AND key = 'blocked'`,
    [projectId],
  );
  return { organisationId, projectId };
}

async function prioritiesOf(organisationId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(priorities)
    .where(eq(priorities.organisationId, organisationId));
  return Object.fromEntries(rows.map((row) => [row.key, row.name]));
}

async function blockedNameOf(projectId: string): Promise<string | undefined> {
  const rows = await db
    .select()
    .from(projectStatuses)
    .where(eq(projectStatuses.projectId, projectId));
  return rows.find((row) => row.key === 'blocked')?.name;
}

async function someone() {
  const [user] = await db
    .insert(users)
    .values({ email: 'a@acme.test', displayName: 'A' })
    .returning();
  return user!.id;
}

describe('the forge heat names migration', () => {
  it('renames the default priorities and Blocked to Jammed', async () => {
    const { organisationId, projectId } = await workspaceWithOldNames(
      'acme',
      'WEB',
      await someone(),
    );
    expect(await prioritiesOf(organisationId)).toEqual(OLD_PRIORITIES);
    expect(await blockedNameOf(projectId)).toBe('Blocked');

    await runMigration();

    expect(await prioritiesOf(organisationId)).toEqual(NEW_PRIORITIES);
    expect(await blockedNameOf(projectId)).toBe('Jammed');
  });

  it('leaves a priority or status that someone renamed alone', async () => {
    const { organisationId, projectId } = await workspaceWithOldNames(
      'acme',
      'WEB',
      await someone(),
    );
    await pool.query(
      `UPDATE priorities SET name = 'Drop everything' WHERE organisation_id = $1 AND key = 'critical'`,
      [organisationId],
    );
    await pool.query(
      `UPDATE project_statuses SET name = 'Waiting' WHERE project_id = $1 AND key = 'blocked'`,
      [projectId],
    );

    await runMigration();

    expect(await prioritiesOf(organisationId)).toEqual({
      ...NEW_PRIORITIES,
      critical: 'Drop everything',
    });
    expect(await blockedNameOf(projectId)).toBe('Waiting');
  });

  it('changes nothing the second time it runs', async () => {
    const { organisationId, projectId } = await workspaceWithOldNames(
      'acme',
      'WEB',
      await someone(),
    );
    await runMigration();
    await runMigration();
    expect(await prioritiesOf(organisationId)).toEqual(NEW_PRIORITIES);
    expect(await blockedNameOf(projectId)).toBe('Jammed');
  });

  it('renames every workspace', async () => {
    const userId = await someone();
    const first = await workspaceWithOldNames('acme', 'WEB', userId);
    const second = await workspaceWithOldNames('northwind', 'OPS', userId);

    await runMigration();

    expect(await prioritiesOf(first.organisationId)).toEqual(NEW_PRIORITIES);
    expect(await prioritiesOf(second.organisationId)).toEqual(NEW_PRIORITIES);
    expect(await blockedNameOf(second.projectId)).toBe('Jammed');
  });

  it('gives a new workspace and project the new names from the start', async () => {
    const userId = await someone();
    const { organisationId } = await createOrganisationWithSystemRoles(db, {
      slug: 'fresh',
      name: 'fresh',
    });
    await ensureOrganisationDefaults(db, organisationId);
    const { projectId } = await createProject(db, {
      organisationId,
      key: 'NEW',
      name: 'NEW',
      createdBy: userId,
    });
    expect(await prioritiesOf(organisationId)).toEqual(NEW_PRIORITIES);
    expect(await blockedNameOf(projectId)).toBe('Jammed');
  });
});
