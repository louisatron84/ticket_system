import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from './host';

describe('isLoopbackHost', () => {
  it.each([
    'localhost',
    'localhost:3000',
    '127.0.0.1',
    '127.0.0.1:4000',
    '[::1]',
    '[::1]:3000',
    'LOCALHOST:3000',
    ' localhost:3000 ',
  ])('accepts %j', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    ['an absent header', undefined],
    ['an empty header', ''],
    ['a public name', 'evil.test'],
    ['a look-alike suffix', 'localhost.evil.test'],
    ['a look-alike prefix', 'evil-localhost'],
    ['an address with a suffix', '127.0.0.1.evil.test'],
    ['another loopback address', '127.0.0.2'],
    ['a LAN address', '192.168.1.20:3000'],
    ['credentials trick', 'localhost@evil.test'],
    ['a path', 'localhost/evil'],
    ['a port that is not numeric', 'localhost:abc'],
    ['two hosts', 'localhost, evil.test'],
  ])('refuses %s', (_label, host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
