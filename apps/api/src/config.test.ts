import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const validEnv = { DATABASE_URL: 'postgres://forge:forge@localhost:54329/forge' };

describe('loadConfig', () => {
  it('applies defaults for everything except DATABASE_URL', () => {
    const config = loadConfig(validEnv);
    expect(config).toMatchObject({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 4000,
      databaseUrl: validEnv.DATABASE_URL,
      logLevel: 'info',
    });
    expect(config.version).toEqual(expect.any(String));
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: 'production',
      API_HOST: '0.0.0.0',
      API_PORT: '8080',
      LOG_LEVEL: 'warn',
    });
    expect(config).toMatchObject({
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'warn',
    });
  });

  it('defaults the log level to silent under NODE_ENV=test', () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: 'test' }).logLevel).toBe('silent');
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig({ ...validEnv, API_PORT: '' }).port).toBe(4000);
  });

  it('fails fast naming DATABASE_URL when it is missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('names DATABASE_URL but never echoes its value when the scheme is wrong', () => {
    let message = '';
    try {
      loadConfig({ DATABASE_URL: 'mysql://u:secret-pw@h/db' });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain('secret-pw');
  });

  it('names DATABASE_URL but never echoes its value when it is not a URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'hunter2-not-a-url' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'hunter2-not-a-url' })).not.toThrow(/hunter2/);
  });

  it('rejects a non-numeric API_PORT by name', () => {
    expect(() => loadConfig({ ...validEnv, API_PORT: 'abc' })).toThrow(/API_PORT/);
  });

  it('rejects an out-of-range API_PORT by name', () => {
    expect(() => loadConfig({ ...validEnv, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('rejects an unknown NODE_ENV and LOG_LEVEL by name', () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ ...validEnv, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  it('reports every invalid variable in one error', () => {
    let message = '';
    try {
      loadConfig({ API_PORT: 'abc' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/API_PORT/);
  });
});
