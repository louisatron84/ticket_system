import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createOrganisationWithSystemRoles,
  createPool,
  createProject,
  loadDotEnv,
  projectStatuses,
  resetDatabaseForTests,
  runMigrations,
  users,
  type Db,
} from './index';

// The rename migration is plain SQL, so the test runs the file itself against rows that look the
// way they did before it existed.
const MIGRATION = new URL('../migrations/0003_forge_status_names.sql', import.meta.url);
const OLD_NAMES: Record<string, string> = {
  backlog: 'Backlog',
  open: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};
const NEW_NAMES: Record<string, string> = {
  backlog: 'Cold Steel',
  open: 'Warming',
  in_progress: 'In the Forge',
  in_review: 'Tempering',
  blocked: 'Blocked',
  done: 'Quenched',
  cancelled: 'Scrapped',
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

/** A project whose statuses carry the names they had before the rename. */
async function projectWithOldNames(slug: string, key: string, userId: string) {
  const { organisationId } = await createOrganisationWithSystemRoles(db, { slug, name: slug });
  const { projectId } = await createProject(db, {
    organisationId,
    key,
    name: key,
    createdBy: userId,
  });
  for (const [statusKey, name] of Object.entries(OLD_NAMES)) {
    await pool.query('UPDATE project_statuses SET name = $1 WHERE project_id = $2 AND key = $3', [
      name,
      projectId,
      statusKey,
    ]);
  }
  return projectId;
}

async function namesOf(projectId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(projectStatuses)
    .where(eq(projectStatuses.projectId, projectId));
  return Object.fromEntries(rows.map((row) => [row.key, row.name]));
}

async function someone() {
  const [user] = await db
    .insert(users)
    .values({ email: 'a@acme.test', displayName: 'A' })
    .returning();
  return user!.id;
}

describe('the forge status names migration', () => {
  it('renames every default status of an existing project', async () => {
    const projectId = await projectWithOldNames('acme', 'WEB', await someone());
    expect(await namesOf(projectId)).toEqual(OLD_NAMES);

    await runMigration();

    expect(await namesOf(projectId)).toEqual(NEW_NAMES);
  });

  it('leaves a status that someone renamed alone', async () => {
    const projectId = await projectWithOldNames('acme', 'WEB', await someone());
    await pool.query(
      `UPDATE project_statuses SET name = 'Shipped' WHERE project_id = $1 AND key = 'done'`,
      [projectId],
    );

    await runMigration();

    expect(await namesOf(projectId)).toEqual({ ...NEW_NAMES, done: 'Shipped' });
  });

  it('changes nothing the second time it runs', async () => {
    const projectId = await projectWithOldNames('acme', 'WEB', await someone());
    await runMigration();
    await runMigration();
    expect(await namesOf(projectId)).toEqual(NEW_NAMES);
  });

  it('renames the projects of every workspace', async () => {
    const userId = await someone();
    const first = await projectWithOldNames('acme', 'WEB', userId);
    const second = await projectWithOldNames('northwind', 'OPS', userId);

    await runMigration();

    expect(await namesOf(first)).toEqual(NEW_NAMES);
    expect(await namesOf(second)).toEqual(NEW_NAMES);
  });
});
