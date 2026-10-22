import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPool,
  loadDotEnv,
  migrationStatus,
  resetDatabaseForTests,
  runMigrations,
} from './index';

let pool: Pool;

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
  await resetDatabaseForTests(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('migrations', () => {
  it('reports every shipped migration as pending on an empty database', async () => {
    const { expected, applied } = await migrationStatus(pool);
    expect(expected).toBeGreaterThan(0);
    expect(applied).toBe(0);
  });

  it('applies every migration', async () => {
    await runMigrations(pool);
    const { expected, applied } = await migrationStatus(pool);
    expect(applied).toBe(expected);
  });

  it('is idempotent when run twice', async () => {
    await runMigrations(pool);
    const first = await migrationStatus(pool);
    await runMigrations(pool);
    expect(await migrationStatus(pool)).toEqual(first);
  });

  it('creates system_metadata that accepts rows and rejects a null value', async () => {
    await runMigrations(pool);
    await pool.query("INSERT INTO system_metadata (key, value) VALUES ('probe', 'ok')");
    const { rows } = await pool.query(
      'SELECT value, updated_at FROM system_metadata WHERE key = $1',
      ['probe'],
    );
    expect(rows[0].value).toBe('ok');
    expect(rows[0].updated_at).toBeInstanceOf(Date);
    await expect(
      pool.query("INSERT INTO system_metadata (key, value) VALUES ('bad', NULL)"),
    ).rejects.toThrow(/null value/i);
  });
});
