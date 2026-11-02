import { execSync } from 'node:child_process';
import { E2E_DATABASE_URL } from '../../playwright.config';

/** Brings the end-to-end database to a known state: migrated, then wiped and seeded. */
export default function globalSetup(): void {
  // reseed deletes every row, so make absolutely sure this is the throw-away database.
  if (!/_e2e(\?|$)/.test(E2E_DATABASE_URL)) {
    throw new Error('E2E_DATABASE_URL must point at a database whose name ends in _e2e.');
  }
  // Nor the development database, whatever it is called: same server, same name means same data.
  const where = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}/${parsed.pathname.slice(1)}`;
  };
  if (process.env.DATABASE_URL && where(process.env.DATABASE_URL) === where(E2E_DATABASE_URL)) {
    throw new Error(
      'E2E_DATABASE_URL is the same database as DATABASE_URL. Give the tests their own.',
    );
  }
  execSync('npm run db:migrate && npm run db:reseed', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, NODE_ENV: 'development' },
  });
}
