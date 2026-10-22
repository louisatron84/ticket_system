import type { CookieSerializeOptions } from '@fastify/cookie';
import type { AppConfig } from '../config';

export function sessionCookieOptions(
  config: Pick<AppConfig, 'nodeEnv' | 'sessionTtlHours'>,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlHours * 3600,
    secure: config.nodeEnv === 'production',
  };
}
