import type { CookieSerializeOptions } from '@fastify/cookie';
import type { AppConfig } from '../config';

export function sessionCookieOptions(
  config: Pick<AppConfig, 'nodeEnv' | 'sessionTtlHours'> & { webOrigins?: readonly string[] },
): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlHours * 3600,
    // Secure in production, and whenever the site is only ever reached over HTTPS, so the cookie
    // never travels in clear text there even if NODE_ENV was left unset.
    secure:
      config.nodeEnv === 'production' ||
      (config.webOrigins !== undefined &&
        config.webOrigins.length > 0 &&
        config.webOrigins.every((origin) => origin.startsWith('https://'))),
  };
}
