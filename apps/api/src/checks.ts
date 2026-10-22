import { migrationStatus } from '@forge/db';
import type { Pool } from 'pg';
import { CheckFailure, type ReadinessCheck } from './readiness';

// The pool bounds these calls itself (connection and statement timeouts), and the health route
// races every check against its own deadline, so neither check needs to watch the abort signal.

export function databaseCheck(pool: Pool): ReadinessCheck {
  return {
    name: 'database',
    run: async () => {
      await pool.query('SELECT 1');
    },
  };
}

export function migrationsCheck(pool: Pool): ReadinessCheck {
  return {
    name: 'migrations',
    run: async () => {
      const { expected, applied } = await migrationStatus(pool);
      if (applied < expected) throw new CheckFailure('migrations pending');
    },
  };
}
