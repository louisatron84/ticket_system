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
});
