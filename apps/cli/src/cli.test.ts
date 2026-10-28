import { describe, expect, it } from 'vitest';
import { checkServer } from './config';
import { main } from './main';
import { MOVE_WORDS, isMoveWord, ticketKey } from './moves';

describe('move words', () => {
  it('map the owner’s words to status keys', () => {
    expect(
      Object.fromEntries(Object.entries(MOVE_WORDS).map(([word, { key }]) => [word, key])),
    ).toEqual({
      cold: 'backlog',
      warm: 'open',
      hammer: 'in_progress',
      temper: 'in_review',
      jammed: 'blocked',
      jam: 'blocked',
      quench: 'done',
      scrap: 'cancelled',
    });
    expect(isMoveWord('hammer')).toBe(true);
    expect(isMoveWord('toString')).toBe(false);
    expect(isMoveWord('forge')).toBe(false);
  });

  it('read keys in any case', () => {
    expect(ticketKey('web-12')).toBe('WEB-12');
    expect(ticketKey(' API-3 ')).toBe('API-3');
    for (const bad of ['WEB', 'WEB-0', '12', 'WEB-1-2', '../WEB-1', 'W-1']) {
      expect(ticketKey(bad), bad).toBeNull();
    }
  });
});

describe('server addresses', () => {
  it('allow https anywhere and http only to this machine', () => {
    expect(checkServer('https://forge.example.com/x')).toEqual({
      ok: true,
      server: 'https://forge.example.com',
    });
    expect(checkServer('http://localhost:3000')).toEqual({
      ok: true,
      server: 'http://localhost:3000',
    });
    expect(checkServer('http://127.0.0.1:3000').ok).toBe(true);
    expect(checkServer('http://forge.example.com').ok).toBe(false);
    expect(checkServer('ftp://forge.example.com').ok).toBe(false);
    expect(checkServer('not a url').ok).toBe(false);
  });
});

describe('usage', () => {
  const run = async (...args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  it('explains itself, and a wrong command is a usage error', async () => {
    expect((await run('help')).out).toContain('forge hammer <KEY>');
    expect((await run()).code).toBe(2);
    const unknown = await run('forge');
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('Unknown command "forge"');
  });

  it('a move needs exactly one valid key', async () => {
    expect(await run('warm')).toMatchObject({
      code: 2,
      err: expect.stringContaining('forge warm <KEY>'),
    });
    expect((await run('warm', 'nope')).code).toBe(2);
    expect((await run('warm', 'WEB-1', 'WEB-2')).code).toBe(2);
  });
});

describe('strict arguments', () => {
  const run = async (...args: string[]) => {
    const err: string[] = [];
    const out: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  it('refuses options a command does not know, and options missing a value', async () => {
    expect(await run('login', '--tokn')).toMatchObject({
      code: 2,
      err: 'forge login does not take --tokn. Run `forge help`.',
    });
    expect((await run('login', '--server')).code).toBe(2);
    expect((await run('hammer', 'WEB-1', '--force')).code).toBe(2);
    expect((await run('cat', '--limit', '0')).code).toBe(2);
    expect((await run('cat', 'WEB')).code).toBe(2);
    expect((await run('inspect')).code).toBe(2);
  });

  it('prints its version', async () => {
    expect((await run('--version')).out).toMatch(/^forge \d+\.\d+\.\d+$/);
  });
});
