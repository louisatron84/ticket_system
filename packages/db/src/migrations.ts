import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { createDb } from './client';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(pool: Pool): Promise<void> {
  await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_DIR });
}

// Postgres error codes for "table does not exist" and "schema does not exist".
const MISSING_RELATION = new Set(['42P01', '3F000']);

/** How many migrations ship with this build versus how many the database has applied. */
export async function migrationStatus(pool: Pool): Promise<{ expected: number; applied: number }> {
  const journal = JSON.parse(
    await readFile(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: unknown[] };

  try {
    const { rows } = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
    );
    return { expected: journal.entries.length, applied: rows[0]?.count ?? 0 };
  } catch (error) {
    if (MISSING_RELATION.has((error as { code?: string }).code ?? '')) {
      return { expected: journal.entries.length, applied: 0 };
    }
    throw error;
  }
}
