import { createPool, loadDotEnv, runMigrations } from '@forge/db';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { databaseCheck, migrationsCheck } from './checks';
import { CheckFailure } from './readiness';

let pool: Pool;
const signal = () => new AbortController().signal;

beforeAll(() => {
  loadDotEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env and run npm run db:start.',
    );
  }
  pool = createPool(url);
});

beforeEach(async () => {
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await pool.query('DROP TABLE IF EXISTS system_metadata');
});

afterAll(async () => {
  await pool.end();
});

describe('databaseCheck', () => {
  it('passes against a reachable database', async () => {
    await expect(databaseCheck(pool).run(signal())).resolves.toBeUndefined();
  });

  it('fails promptly against a closed port instead of hanging', async () => {
    const dead = createPool('postgres://forge:forge@127.0.0.1:1/forge');
    const started = Date.now();
    try {
      await expect(databaseCheck(dead).run(signal())).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await dead.end();
    }
  });
});

describe('migrationsCheck', () => {
  it('fails with a safe reason while migrations are pending', async () => {
    const error = await migrationsCheck(pool)
      .run(signal())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CheckFailure);
    expect((error as CheckFailure).message).toBe('migrations pending');
  });

  it('passes once every migration is applied', async () => {
    await runMigrations(pool);
    await expect(migrationsCheck(pool).run(signal())).resolves.toBeUndefined();
  });
});
