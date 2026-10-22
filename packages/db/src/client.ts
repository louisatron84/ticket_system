import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/**
 * An idle client can error when Postgres restarts or the network drops. Without a
 * listener, pg's Pool re-emits that as an uncaught exception and kills the process.
 */
export function createPool(
  databaseUrl: string,
  onError: (error: Error) => void = () => {},
): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  });
  pool.on('error', onError);
  return pool;
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}
