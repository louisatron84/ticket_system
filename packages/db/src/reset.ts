import { sql } from 'drizzle-orm';
import type { Executor } from './organisations';

const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * Empties every table in the public schema. Tables are discovered from the catalogue rather than
 * listed by hand, so a table added in a later stage cannot be forgotten. Migration bookkeeping
 * lives in the separate `drizzle` schema and is untouched.
 */
export async function truncateAllTables(executor: Executor): Promise<void> {
  const { rows } = await executor.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const names = rows.map((row) => quoteIdentifier(row.tablename)).join(', ');
  await executor.execute(sql.raw(`TRUNCATE TABLE ${names} CASCADE`));
}
