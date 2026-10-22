import { createPool, loadDotEnv } from '@forge/db';
import { buildApp } from './app';
import { databaseCheck, migrationsCheck } from './checks';
import { ConfigError, loadConfig } from './config';

loadDotEnv();

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

// The pool exists before the app does; its error handler only runs after startup, when `app` is set.
const pool = createPool(config.databaseUrl, (error) =>
  app.log.error({ err: error }, 'idle database client error'),
);

const app = await buildApp({
  config,
  readinessChecks: [databaseCheck(pool), migrationsCheck(pool)],
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, 'failed to start (is the port already in use?)');
  await pool.end();
  process.exit(1);
}
