// CLI: `npm run db:migrate` applies pending migrations to DATABASE_URL.
import { createPool } from './client';
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
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
