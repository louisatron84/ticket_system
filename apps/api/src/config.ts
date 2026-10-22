import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: (typeof LOG_LEVELS)[number];
  version: string;
};

/** Thrown for invalid environment variables. The message names variables, never their values. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'postgres:' || protocol === 'postgresql:';
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  DATABASE_URL: z.string().refine(isPostgresUrl),
  APP_VERSION: z.string().optional(),
});

// Fixed text per variable: zod's own messages can include the offending value.
const PROBLEMS: Record<string, string> = {
  NODE_ENV: 'must be one of development, test, production',
  API_HOST: 'must be a host name or address',
  API_PORT: 'must be an integer between 1 and 65535',
  LOG_LEVEL: `must be one of ${LOG_LEVELS.join(', ')}`,
  DATABASE_URL: 'is required and must be a postgres:// or postgresql:// URL',
  APP_VERSION: 'must be a string',
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  // `KEY=` in a .env file yields an empty string; treat it as unset.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value));
  const parsed = envSchema.safeParse(present);

  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    const problems = names.map((name) => `${name} ${PROBLEMS[name] ?? 'is invalid'}`);
    throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`);
  }

  const values = parsed.data;
  return {
    nodeEnv: values.NODE_ENV,
    host: values.API_HOST,
    port: values.API_PORT,
    databaseUrl: values.DATABASE_URL,
    logLevel: values.LOG_LEVEL ?? (values.NODE_ENV === 'test' ? 'silent' : 'info'),
    version: values.APP_VERSION ?? pkg.version,
  };
}
