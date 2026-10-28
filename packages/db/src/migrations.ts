import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { createDb } from './client';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Everything people type is stored as text, so the database has to be able to hold all of
 * Unicode. A Postgres created on Windows can silently default to WIN1252, which accepts
 * ordinary accented text but fails on the first emoji, Arabic or CJK character, as a 500 long
 * after setup. Better to refuse up front, with the way out.
 */
export async function assertUtf8Database(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ name: string; encoding: string }>(
    `SELECT current_database() AS name, pg_encoding_to_char(encoding) AS encoding
       FROM pg_database WHERE datname = current_database()`,
  );
  const { name, encoding } = rows[0] ?? { name: 'unknown', encoding: 'unknown' };
  if (encoding !== 'UTF8') {
    throw new Error(
      `Database "${name}" uses the ${encoding} encoding, but Forge stores text in UTF8 (it cannot ` +
        `hold emoji or non-Latin scripts otherwise). With the local database from npm run db:start, ` +
        `recreate it: npm run db:stop, npm run db:reset, npm run db:start, then npm run db:migrate ` +
        `and npm run db:seed. With your own Postgres, create the database with ENCODING 'UTF8'.`,
    );
  }
}

export async function runMigrations(pool: Pool): Promise<void> {
  await assertUtf8Database(pool);
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
