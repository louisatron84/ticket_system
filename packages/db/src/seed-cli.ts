// CLI: `npm run db:seed` seeds an empty database; `npm run db:reseed` wipes and reseeds it.
import { createDb, createPool } from './client';
import { loadDotEnv } from './env';
import { DEV_IDENTITIES, reseedDevelopmentData, seedDevelopmentDataIfEmpty } from './seed';

loadDotEnv();

const command = process.argv[2];
const url = process.env.DATABASE_URL;
if (command !== 'seed' && command !== 'reseed') {
  console.error('Usage: tsx src/seed-cli.ts <seed|reseed>');
  process.exit(1);
}
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.');
  process.exit(1);
}

const pool = createPool(url);
try {
  const db = createDb(pool);
  if (command === 'reseed') {
    await reseedDevelopmentData(db);
    console.log(`Reseeded: wiped all data and created ${DEV_IDENTITIES.length} test identities.`);
  } else if (await seedDevelopmentDataIfEmpty(db)) {
    console.log(`Seeded ${DEV_IDENTITIES.length} test identities.`);
  } else {
    console.log('Skipped: the database already has data. Use `npm run db:reseed` to start over.');
  }
} catch (error) {
  console.error('Seeding failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
