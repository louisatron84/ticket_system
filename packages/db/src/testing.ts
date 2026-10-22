import type { Pool } from 'pg';

const DISPOSABLE_DATABASE = /_(test|e2e)$/;

/**
 * Wipes every table so a test starts from an empty schema. It refuses to run unless the
 * connected database is named like a throw-away one, so a wrong DATABASE_URL cannot erase
 * development data.
 */
export async function resetDatabaseForTests(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ current_database: string }>('SELECT current_database()');
  const name = rows[0]?.current_database ?? '';
  if (!DISPOSABLE_DATABASE.test(name)) {
    throw new Error(
      `Refusing to reset database "${name}": only databases whose names end in _test or _e2e may be wiped.`,
    );
  }
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
}
