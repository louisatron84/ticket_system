import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertUtf8Database,
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

describe('database encoding', () => {
  /** A pool that only knows how to say which encoding its database has. */
  const poolWith = (name: string, encoding: string) => {
    const query = vi.fn().mockResolvedValue({ rows: [{ name, encoding }] });
    return { pool: { query } as unknown as Pool, query };
  };

  it('accepts a UTF8 database and stores text from any script in it', async () => {
    const text = 'مرحبا 👋 世界 — naïve café';
    await expect(assertUtf8Database(pool)).resolves.toBeUndefined();
    await runMigrations(pool);
    await pool.query("INSERT INTO system_metadata (key, value) VALUES ('probe', $1)", [text]);
    const { rows } = await pool.query("SELECT value FROM system_metadata WHERE key = 'probe'");
    expect(rows[0].value).toBe(text);
  });

  it('refuses a database that cannot hold all of Unicode, and says how to fix it', async () => {
    const { pool: legacy } = poolWith('forge', 'WIN1252');
    await expect(assertUtf8Database(legacy)).rejects.toThrow(
      /Database "forge" uses the WIN1252 encoding.*UTF8.*npm run db:reset.*ENCODING 'UTF8'/s,
    );
  });

  it('checks before applying anything', async () => {
    const { pool: legacy, query } = poolWith('forge', 'SQL_ASCII');
    await expect(runMigrations(legacy)).rejects.toThrow(/SQL_ASCII.*UTF8/s);
    expect(query).toHaveBeenCalledTimes(1);
  });

  // Creating and dropping a database makes Postgres force checkpoints, which is slow on a busy
  // Windows disk, so there is exactly one real one, to prove the check sees a genuine encoding.
  it('recognises a real LATIN1 database and leaves it empty', { timeout: 60_000 }, async () => {
    const name = 'forge_encoding_probe_test';
    // The app's pool cuts statements off after 5 seconds, which a forced checkpoint can exceed,
    // so database administration uses a plain client.
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.connect();
    let latin1: Pool | undefined;
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      // The C locale is allowed with every encoding, so this works on any platform.
      await admin.query(
        `CREATE DATABASE ${name} ENCODING 'LATIN1' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`,
      );
      const url = new URL(process.env.TEST_DATABASE_URL!);
      url.pathname = `/${name}`;
      latin1 = createPool(url.toString());
      await expect(runMigrations(latin1)).rejects.toThrow(/forge_encoding_probe_test.*LATIN1/s);
      const { rows } = await latin1.query(
        "SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema IN ('public', 'drizzle')",
      );
      expect(rows[0].tables).toBe(0);
    } finally {
      await latin1?.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin.end();
    }
  });
});
