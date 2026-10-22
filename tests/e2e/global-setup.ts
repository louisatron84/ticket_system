import { execSync } from 'node:child_process';
import { E2E_DATABASE_URL } from '../../playwright.config';

/** Brings the end-to-end database to a known state: migrated, then wiped and seeded. */
export default function globalSetup(): void {
  // reseed deletes every row, so make absolutely sure this is the throw-away database.
  if (!/_e2e(\?|$)/.test(E2E_DATABASE_URL)) {
    throw new Error('E2E_DATABASE_URL must point at a database whose name ends in _e2e.');
  }
  execSync('npm run db:migrate && npm run db:reseed', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, NODE_ENV: 'development' },
  });
}
