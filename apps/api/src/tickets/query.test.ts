import { TICKET_SORTS } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import { keyPrefixPattern, orderFor, titleContainsPattern } from './query';

describe('LIKE patterns', () => {
  it('escapes the characters LIKE treats as wildcards, so they are matched literally', () => {
    expect(titleContainsPattern('100%')).toBe('%100\\%%');
    expect(titleContainsPattern('a_b')).toBe('%a\\_b%');
    expect(titleContainsPattern('c:\\dir')).toBe('%c:\\\\dir%');
    expect(titleContainsPattern('%_\\')).toBe('%\\%\\_\\\\%');
  });

  it('compares titles in lower case', () => {
    expect(titleContainsPattern('Login BUG')).toBe('%login bug%');
  });

  it('turns a typed key into an upper-case prefix', () => {
    expect(keyPrefixPattern('web-1')).toBe('WEB-1%');
    expect(keyPrefixPattern('we%')).toBe('WE\\%%');
  });

  it('leaves ordinary text, quotes and SQL fragments as plain text', () => {
    expect(titleContainsPattern("x'; DROP TABLE tickets; --")).toBe("%x'; drop table tickets; --%");
  });
});

describe('sorting', () => {
  it.each(TICKET_SORTS)(
    'knows how to order by %s, in both directions, ending on a tie-breaker',
    (sort) => {
      for (const dir of ['asc', 'desc'] as const) {
        // At least the chosen order plus the id that settles ties.
        expect(orderFor(sort, dir).length).toBeGreaterThanOrEqual(2);
      }
    },
  );

  it('refuses a sort it does not know instead of building anything from it', () => {
    expect(() => orderFor('password; drop table x' as never, 'asc')).toThrow(/unknown sort/i);
  });
});
