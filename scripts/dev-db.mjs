#!/usr/bin/env node
// Local PostgreSQL for development without Docker, using real Postgres binaries
// from the `embedded-postgres` package. Data lives in .data/postgres (git-ignored).
//
//   node scripts/dev-db.mjs start   run Postgres in the foreground (Ctrl+C stops it)
//   node scripts/dev-db.mjs stop    stop a database running elsewhere (e.g. in the background)
//   node scripts/dev-db.mjs reset   delete the data directory (only while stopped)
//
// Connection details match .env.example: forge/forge on localhost:54329.
import EmbeddedPostgres from 'embedded-postgres';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PORT = 54329;
const USER = 'forge';
const PASSWORD = 'forge';
const DATABASES = ['forge', 'forge_test', 'forge_e2e'];
const DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.data',
  'postgres',
);

const log = (message) => console.log(`[dev-db] ${message}`);
const fail = (message) => {
  console.error(`[dev-db] ${message}`);
  process.exit(1);
};

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function start() {
  if (await isPortInUse(PORT)) {
    fail(
      `Port ${PORT} is already in use. Is the dev database already running (try \`npm run db:stop\`) or Docker Compose?`,
    );
  }

  const verbose = process.env.DEV_DB_VERBOSE === '1';
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: USER,
    password: PASSWORD,
    persistent: true,
    // initdb otherwise follows the operating system's locale; on Windows that is WIN1252, which
    // cannot store emoji or most non-Latin scripts.
    initdbFlags: ['--encoding=UTF8'],
    onLog: (message) => verbose && console.log(`[postgres] ${String(message).trimEnd()}`),
    onError: (message) => verbose && console.error(`[postgres] ${String(message).trimEnd()}`),
  });

  // initdb must run only for a brand-new data directory; it never touches existing data.
  if (existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    log(`Using existing data directory ${DATA_DIR}`);
  } else {
    log(`Initialising new data directory ${DATA_DIR}`);
    await pg.initialise();
  }

  await pg.start();

  const client = pg.getPgClient('postgres');
  await client.connect();
  try {
    for (const name of DATABASES) {
      const { rows } = await client.query(
        'SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = $1',
        [name],
      );
      if (rows.length === 0) {
        // Names come from the constant above, never from input. TEMPLATE template0 is what
        // allows an encoding other than the template's.
        await client.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
        log(`Created database "${name}"`);
      } else if (rows[0].encoding !== 'UTF8') {
        // Encoding is fixed when a database is created, so this cannot be repaired in place.
        console.warn(
          `[dev-db] WARNING: database "${name}" uses ${rows[0].encoding}, not UTF8, so emoji and ` +
            'non-Latin text will be rejected. This data directory predates the UTF8 setup. ' +
            'To recreate it (deletes local data): npm run db:stop, npm run db:reset, ' +
            'npm run db:start, npm run db:migrate, npm run db:seed.',
        );
      }
    }
  } finally {
    await client.end();
  }

  log(`PostgreSQL is accepting connections on 127.0.0.1:${PORT} (user ${USER}). Ctrl+C to stop.`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log('Stopping PostgreSQL...');
    await pg.stop();
    log('Stopped. Data kept in .data/postgres.');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keeps the event loop alive, and exits when Postgres is stopped from elsewhere
  // (`npm run db:stop`) instead of lingering as an idle process.
  let misses = 0;
  setInterval(async () => {
    if (stopping) return;
    misses = (await isPortInUse(PORT)) ? 0 : misses + 1;
    if (misses >= 2) {
      log('PostgreSQL is no longer running. Exiting.');
      process.exit(0);
    }
  }, 2000);
}

/** Stops a dev database that is running in the background (or whose terminal was closed). */
async function stop() {
  if (!existsSync(path.join(DATA_DIR, 'postmaster.pid'))) {
    log('The dev database is not running.');
    return;
  }
  const pgCtl = findPgCtl();
  log('Stopping PostgreSQL...');
  try {
    await execFileAsync(pgCtl, ['stop', '-D', DATA_DIR, '-m', 'fast', '-w']);
  } catch (error) {
    fail(`pg_ctl could not stop the server: ${error instanceof Error ? error.message : error}`);
  }
  log('Stopped. Data kept in .data/postgres.');
}

function findPgCtl() {
  const platform = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
  const entry = createRequire(import.meta.url).resolve(
    `@embedded-postgres/${platform}-${process.arch}`,
  );
  const binary = process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl';
  return path.join(path.dirname(entry), '..', 'native', 'bin', binary);
}

async function reset() {
  if (process.env.NODE_ENV === 'production') {
    fail('Refusing to reset the database when NODE_ENV=production.');
  }
  if (await isPortInUse(PORT)) {
    fail(
      `Port ${PORT} is in use. Stop the dev database (Ctrl+C in its terminal) before resetting.`,
    );
  }
  if (!existsSync(DATA_DIR)) {
    log('Nothing to reset: no data directory.');
    return;
  }
  await rm(DATA_DIR, { recursive: true, force: true });
  log('Deleted .data/postgres. Run `npm run db:start` then `npm run db:migrate` to recreate it.');
}

const command = process.argv[2];
try {
  if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else if (command === 'reset') await reset();
  else fail('Usage: node scripts/dev-db.mjs <start|stop|reset>');
} catch (error) {
  fail(`${command} failed: ${error instanceof Error ? error.message : String(error)}`);
}
