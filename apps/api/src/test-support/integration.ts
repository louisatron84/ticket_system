import {
  createDb,
  createPool,
  developmentFixtures,
  loadDotEnv,
  reseedDevelopmentData,
  resetDatabaseForTests,
  runMigrations,
  type Db,
} from '@forge/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../app';
import { SESSION_COOKIE, createSession } from '../auth/sessions';
import type { AppConfig } from '../config';
import { testConfig } from '../test-utils';

export type Integration = {
  app: FastifyInstance;
  db: Db;
  pool: Pool;
  config: AppConfig;
  /** A `cookie` header value for a fresh session of the seeded identity with this key. */
  cookieFor(identityKey: string): Promise<string>;
  /** Wipes and reseeds the test database. */
  reseed(): Promise<void>;
  close(): Promise<void>;
};

/**
 * A real app on a real, freshly migrated and seeded test database. Sessions are created through
 * the session service directly, so tests of other routes do not depend on the dev sign-in route.
 */
export async function startIntegration(overrides: Partial<AppConfig> = {}): Promise<Integration> {
  loadDotEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env and run npm run db:start.',
    );
  }
  const pool = createPool(url);
  const db = createDb(pool);
  await resetDatabaseForTests(pool);
  await runMigrations(pool);
  await reseedDevelopmentData(db);

  const config = testConfig({ databaseUrl: url, ...overrides });
  const app = await buildApp({ config, readinessChecks: [], db });

  return {
    app,
    db,
    pool,
    config,
    async cookieFor(identityKey) {
      const [fixture] = await db
        .select({ userId: developmentFixtures.userId })
        .from(developmentFixtures)
        .where(eq(developmentFixtures.key, identityKey));
      if (!fixture) throw new Error(`No seeded identity with key "${identityKey}"`);
      const { token } = await createSession(db, {
        userId: fixture.userId,
        ttlHours: 1,
        createdVia: 'dev',
      });
      return `${SESSION_COOKIE}=${token}`;
    },
    reseed: () => reseedDevelopmentData(db),
    async close() {
      await app.close();
      await pool.end();
    },
  };
}
