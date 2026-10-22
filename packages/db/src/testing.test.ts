import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { resetDatabaseForTests } from './index';

// A stand-in pool that records statements. These tests must never touch a real database:
// they exist to prove the guard stops before anything destructive is sent.
function fakePool(databaseName: string) {
  const statements: string[] = [];
  const pool = {
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [{ current_database: databaseName }] };
    },
  } as unknown as Pool;
  return { pool, statements };
}

describe('resetDatabaseForTests', () => {
  it.each(['forge', 'forge_dev', 'production', 'test_forge', 'forge_testing'])(
    'refuses to run against the database %j and sends nothing destructive',
    async (name) => {
      const { pool, statements } = fakePool(name);
      await expect(resetDatabaseForTests(pool)).rejects.toThrow(/refus/i);
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/current_database/i);
    },
  );

  it.each(['forge_test', 'forge_e2e'])('runs against the disposable database %j', async (name) => {
    const { pool, statements } = fakePool(name);
    await resetDatabaseForTests(pool);
    expect(statements.some((sql) => /drop schema/i.test(sql))).toBe(true);
  });
});
