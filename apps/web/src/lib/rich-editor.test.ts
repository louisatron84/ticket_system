import { describe, expect, it } from 'vitest';
import { formatBytes, matchMembers, mentionQuery, onOwnLine, replaceRange } from './rich-editor';

describe('mentionQuery', () => {
  it.each([
    ['@', { start: 0, query: '' }],
    ['hi @da', { start: 3, query: 'da' }],
    ['(@Zoë', { start: 1, query: 'Zoë' }],
    ['line\n@r', { start: 5, query: 'r' }],
  ])('%j', (input, expected) => {
    expect(mentionQuery(input)).toEqual(expected);
  });

  it.each(['mail@forge.dev', 'hi @da ', 'no at here', '@' + 'x'.repeat(31)])(
    'is not a mention: %j',
    (input) => {
      expect(mentionQuery(input)).toBeNull();
    },
  );
});

describe('replaceRange', () => {
  it('replaces and puts the caret after the insertion', () => {
    expect(replaceRange('hi @da!', 3, 6, '@[Dana](user:x) ')).toEqual({
      value: 'hi @[Dana](user:x) !',
      caret: 19,
    });
  });
});

describe('matchMembers', () => {
  const people = [
    { displayName: 'Dana Developer', email: 'dana@acme.test' },
    { displayName: 'Adam Admin', email: 'adam@acme.test' },
    { displayName: 'Riley Reviewer', email: 'dev-riley@acme.test' },
  ];

  it('ranks a name start, then a word start, then an email start', () => {
    expect(matchMembers(people, 'd').map((p) => p.displayName)).toEqual([
      'Dana Developer',
      'Riley Reviewer',
    ]);
    expect(matchMembers(people, 'adm').map((p) => p.displayName)).toEqual(['Adam Admin']);
    expect(matchMembers(people, '').length).toBe(3);
    expect(matchMembers(people, 'zz')).toEqual([]);
  });
});

describe('onOwnLine', () => {
  it('adds line breaks only where the block would touch other text', () => {
    expect(onOwnLine('ab', 1, 'X')).toBe('\nX\n');
    expect(onOwnLine('a\n', 2, 'X')).toBe('X');
    expect(onOwnLine('', 0, 'X')).toBe('X');
  });
});

describe('formatBytes', () => {
  it.each([
    [820, '820 B'],
    [14_336, '14 KB'],
    [2_516_582, '2.4 MB'],
  ])('%d', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
