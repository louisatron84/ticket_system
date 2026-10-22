import { describe, expect, it } from 'vitest';
import { assertAllowedOrigin } from './origin';

const allowed = ['http://localhost:3000', 'http://127.0.0.1:3000'];

describe('assertAllowedOrigin', () => {
  it('allows requests with no Origin header (non-browser clients)', () => {
    expect(assertAllowedOrigin(undefined, allowed)).toBe(true);
  });

  it.each(allowed)('allows the configured origin %s', (origin) => {
    expect(assertAllowedOrigin(origin, allowed)).toBe(true);
  });

  it.each([
    'http://evil.test',
    'http://localhost:3000.evil.test',
    'http://localhost:3001',
    'https://localhost:3000',
    'http://localhost:3000/',
    'http://localhost:3000 ',
    'null',
    '',
  ])('refuses the origin %j', (origin) => {
    expect(assertAllowedOrigin(origin, allowed)).toBe(false);
  });
});
