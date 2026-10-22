import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './request-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('passes through a well-formed client id', () => {
    expect(resolveRequestId('client-req_0001.v2')).toBe('client-req_0001.v2');
  });

  it.each([
    ['a newline (log injection)', 'abc\nINFO forged-log-line'],
    ['a carriage return', 'abcdefgh\r'],
    ['10 KB of text', 'a'.repeat(10_000)],
    ['129 characters', 'a'.repeat(129)],
    ['non-ASCII letters', 'ünïcode-12345678'],
    ['spaces', 'has spaces in it'],
    ['too short', 'abc'],
    ['an empty string', ''],
  ])('replaces an id containing %s with a generated UUID', (_label, hostile) => {
    expect(resolveRequestId(hostile)).toMatch(UUID);
  });

  it('generates a UUID when the header is absent', () => {
    expect(resolveRequestId(undefined)).toMatch(UUID);
  });

  it('generates different ids on different calls', () => {
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });

  it('uses the first element of a repeated header when valid', () => {
    expect(resolveRequestId(['first-valid-id', 'second-valid-id'])).toBe('first-valid-id');
  });

  it('generates a UUID when the first element of a repeated header is invalid', () => {
    expect(resolveRequestId(['bad\nid', 'second-valid-id'])).toMatch(UUID);
  });
});
