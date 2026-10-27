import { describe, expect, it } from 'vitest';
import { rankCommands, type Command } from './commands';

const command = (id: string, label: string, hint?: string): Command => ({
  id,
  group: 'Tickets',
  label,
  ...(hint ? { hint } : {}),
  href: `/${id}`,
});

const all = [
  command('a', 'Fix web login', 'API-4'),
  command('b', 'Checkout page is slow on mobile', 'WEB-3'),
  command('c', 'Webhooks for builds', 'API-7'),
  command('d', 'Add a cobweb test', 'API-9'),
];

const ids = (commands: Command[]) => commands.map((item) => item.id);

describe('rankCommands', () => {
  it('keeps every command, in order, for an empty query', () => {
    expect(ids(rankCommands('', all))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(rankCommands('   ', all))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('puts a key that starts with the query first, then a word that starts with it, then the rest', () => {
    // WEB-3's key starts with "web"; "Webhooks" and "web login" start a word; "cobweb" only contains it.
    expect(ids(rankCommands('web', all))).toEqual(['b', 'a', 'c', 'd']);
  });

  it('ignores case, and matches a whole key', () => {
    expect(ids(rankCommands('web-3', all))).toEqual(['b']);
    expect(ids(rankCommands('WEB-3', all))).toEqual(['b']);
  });

  it('leaves out what does not match at all', () => {
    expect(rankCommands('zzz', all)).toEqual([]);
  });

  it('keeps the original order between equally good matches', () => {
    expect(ids(rankCommands('api', all))).toEqual(['a', 'c', 'd']);
  });
});
