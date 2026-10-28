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
  /** Development-only sign-in and account switcher. Can never be on in production. */
  devAuth: boolean;
  /** Lets the development switcher wipe and reseed the database. Off unless asked for. */
  devReset: boolean;
  /** Origins allowed to make state-changing requests with a session cookie. */
  webOrigins: string[];
  sessionTtlHours: number;
  /** The folder attachment files are stored in. */
  attachmentsDir: string;
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

/** A bare origin such as http://localhost:3000: no path, no trailing slash. */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
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
  FORGE_DEV_AUTH: z
    .enum(['1', 'true', '0', 'false'])
    .default('0')
    .transform((value) => value === '1' || value === 'true'),
  FORGE_DEV_RESET: z
    .enum(['1', 'true', '0', 'false'])
    .default('0')
    .transform((value) => value === '1' || value === 'true'),
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:3000,http://127.0.0.1:3000')
    .transform((value) => value.split(',').map((origin) => origin.trim()))
    .refine((origins) => origins.length > 0 && origins.every(isOrigin)),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  ATTACHMENTS_DIR: z.string().min(1).default('data/attachments'),
});

// Fixed text per variable: zod's own messages can include the offending value.
const PROBLEMS: Record<string, string> = {
  NODE_ENV: 'must be one of development, test, production',
  API_HOST: 'must be a host name or address',
  API_PORT: 'must be an integer between 1 and 65535',
  LOG_LEVEL: `must be one of ${LOG_LEVELS.join(', ')}`,
  DATABASE_URL: 'is required and must be a postgres:// or postgresql:// URL',
  APP_VERSION: 'must be a string',
  FORGE_DEV_AUTH: 'must be 1, true, 0 or false',
  FORGE_DEV_RESET: 'must be 1, true, 0 or false',
  WEB_ORIGIN: 'must be a comma-separated list of http(s) origins without paths',
  SESSION_TTL_HOURS: 'must be an integer between 1 and 720',
  ATTACHMENTS_DIR: 'must be a folder path',
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

  // The account switcher lets anyone become any seeded user, so it must never reach production.
  if (values.NODE_ENV === 'production' && values.FORGE_DEV_AUTH) {
    throw new ConfigError(
      'Invalid configuration: FORGE_DEV_AUTH must not be enabled when NODE_ENV=production',
    );
  }

  // In production the session cookie is Secure, so a plain-HTTP site could never sign anyone in;
  // worse, it would send everything else in clear text. Only this machine may be reached by HTTP.
  if (values.NODE_ENV === 'production') {
    const insecure = values.WEB_ORIGIN.filter(
      (origin) =>
        origin.startsWith('http://') &&
        !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin),
    );
    if (insecure.length > 0) {
      throw new ConfigError(
        `Invalid configuration: WEB_ORIGIN must use https:// in production (${insecure.join(', ')})`,
      );
    }
  }

  return {
    nodeEnv: values.NODE_ENV,
    host: values.API_HOST,
    port: values.API_PORT,
    databaseUrl: values.DATABASE_URL,
    logLevel: values.LOG_LEVEL ?? (values.NODE_ENV === 'test' ? 'silent' : 'info'),
    version: values.APP_VERSION ?? pkg.version,
    devAuth: values.FORGE_DEV_AUTH,
    devReset: values.FORGE_DEV_AUTH && values.FORGE_DEV_RESET,
    webOrigins: values.WEB_ORIGIN,
    sessionTtlHours: values.SESSION_TTL_HOURS,
    attachmentsDir: values.ATTACHMENTS_DIR,
  };
}
