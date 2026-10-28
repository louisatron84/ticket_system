import { describe, expect, it } from 'vitest';
import { sessionCookieOptions } from './cookies';

describe('sessionCookieOptions', () => {
  it('is HttpOnly, SameSite=Lax, site-wide and as long-lived as the session', () => {
    expect(sessionCookieOptions({ nodeEnv: 'development', sessionTtlHours: 2 })).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7200,
      secure: false,
    });
  });

  it('is Secure only in production', () => {
    expect(sessionCookieOptions({ nodeEnv: 'production', sessionTtlHours: 1 }).secure).toBe(true);
    expect(sessionCookieOptions({ nodeEnv: 'test', sessionTtlHours: 1 }).secure).toBe(false);
  });

  it('is Secure whenever every web origin is HTTPS, whatever NODE_ENV says', () => {
    const https = ['https://forge.example.com'];
    expect(
      sessionCookieOptions({ nodeEnv: 'development', sessionTtlHours: 1, webOrigins: https })
        .secure,
    ).toBe(true);
    expect(
      sessionCookieOptions({
        nodeEnv: 'development',
        sessionTtlHours: 1,
        webOrigins: [...https, 'http://localhost:3000'],
      }).secure,
    ).toBe(false);
  });
});
