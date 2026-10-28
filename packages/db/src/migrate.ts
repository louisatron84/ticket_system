// CLI: `npm run db:migrate` applies pending migrations to DATABASE_URL.
import { createDb, createPool } from './client';
import { syncOrganisationDefaults, syncSystemRoles } from './defaults';
import { loadDotEnv } from './env';
import { migrationStatus, runMigrations } from './migrations';

loadDotEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.');
  process.exit(1);
}

const pool = createPool(url);
try {
  await runMigrations(pool);
  const { expected, applied } = await migrationStatus(pool);
  console.log(`Migrations up to date: ${applied}/${expected} applied.`);

  // Data that lives in rows but is defined in code must follow the code: system roles keep a copy
  // of their permissions, and every workspace needs the standard ticket types and priorities.
  const db = createDb(pool);
  const rolesUpdated = await syncSystemRoles(db);
  await syncOrganisationDefaults(db);
  if (rolesUpdated > 0) {
    console.log(`Updated ${rolesUpdated} system role(s) to the current permission lists.`);
  }
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
