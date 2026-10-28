import { createDb, createPool, type Db } from '@forge/db';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppConfig } from './config';

/** A valid config that points at nothing and logs nothing; override per test. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: 'postgres://forge:forge@127.0.0.1:1/unused',
    logLevel: 'silent',
    version: '0.0.0-test',
    devAuth: false,
    devReset: false,
    webOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    sessionTtlHours: 168,
    attachmentsDir: path.join(tmpdir(), 'forge-test-attachments'),
    ...overrides,
  };
}

/**
 * A database handle for tests that never query. The pool connects lazily, so nothing is opened
 * unless a test actually reaches the database.
 */
export function testDb(): Db {
  return createDb(createPool(testConfig().databaseUrl));
}
