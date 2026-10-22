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
    ...overrides,
  };
}
