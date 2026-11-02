import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkServer, type CliConfig } from './config';
import { flameLines, wantsColour } from './flame';
import { main } from './main';
import { MOVE_WORDS, findStatus, isMoveWord, ticketKey } from './moves';
import { listTickets } from './tickets';

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
    for (const notPlain of ['1e1', '0x5', ' 7', '5.0', '101']) {
      expect((await run('cat', '--limit', notPlain)).code, notPlain).toBe(2);
    }
    // Extra words are a mistake, never a quiet sign-out.
    expect((await run('logout', 'extra')).code).toBe(2);
    expect((await run('whoami', 'extra', 'words')).code).toBe(2);
    expect((await run('cat', 'WEB')).code).toBe(2);
    expect((await run('inspect')).code).toBe(2);
  });

  it('prints its version', async () => {
    expect((await run('--version')).out).toMatch(/^forge \d+\.\d+\.\d+$/);
  });
});

describe('the login flame', () => {
  it('fits a small terminal and stays plain ASCII', () => {
    const plain = flameLines(false);
    expect(plain.length).toBeLessThanOrEqual(20);
    expect(Math.max(...plain.map((line) => line.length))).toBeLessThanOrEqual(40);
    expect(plain.join('')).toMatch(/^[\x20-\x7e]*$/);
  });

  it('colours only when asked, and every coloured line resets', () => {
    expect(flameLines(false).join('')).not.toContain('\x1b[');
    for (const line of flameLines(true).filter((l) => l.trim()))
      expect(line.endsWith('\x1b[0m')).toBe(true);
    expect(wantsColour({ NO_COLOR: '1' })).toBe(false);
    expect(wantsColour({})).toBe(true);
  });
});

describe('finding a status by what people type', () => {
  const statuses = [
    { id: '1', key: 'open', name: 'Warming' },
    { id: '2', key: 'in_progress', name: 'In the Forge' },
    { id: '3', key: 'qa', name: 'QA' },
    { id: '4', key: 'old', name: 'Old', active: false },
  ];

  it('takes the name in any case, the key, or a move word', () => {
    expect(findStatus(statuses, 'warming')?.key).toBe('open');
    expect(findStatus(statuses, 'In The Forge')?.key).toBe('in_progress');
    expect(findStatus(statuses, 'qa')?.key).toBe('qa');
    expect(findStatus(statuses, 'in_progress')?.key).toBe('in_progress');
    expect(findStatus(statuses, 'hammer')?.key).toBe('in_progress');
  });

  it('never means an inactive status or something else', () => {
    expect(findStatus(statuses, 'Old')).toBeUndefined();
    expect(findStatus(statuses, 'toString')).toBeUndefined();
    expect(findStatus(statuses, 'nothing')).toBeUndefined();
  });

  it('needs a key and a status for forge move', async () => {
    const run = (...args: string[]) =>
      main(args, { out: () => {}, err: () => {} }).then((code) => ({ code }));
    expect((await run('move')).code).toBe(2);
    expect((await run('move', 'WEB-1')).code).toBe(2);
    expect((await run('move', 'nope', 'QA')).code).toBe(2);
    expect((await run('hammer', 'WEB-1', '-m')).code).toBe(2);
  });
});

describe('catalogue with a query', () => {
  const config: CliConfig = {
    server: 'http://localhost:3001',
    token: 'forge_test',
    user: { displayName: 'Dana', email: 'dana@acme.test' },
    workspace: { id: 'org-1', slug: 'acme', name: 'Acme' },
    scope: 'read',
    expiresAt: '2099-01-01T00:00:00Z',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the query for the server to read', async () => {
    const fetch = vi.fn(async () => Response.json({ items: [], total: 0 }));
    vi.stubGlobal('fetch', fetch);
    await listTickets(config, { mine: false, limit: 25, query: 'assignee:me is:open' });
    const url = new URL(String((fetch.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe('/api/v1/orgs/org-1/tickets');
    expect(url.searchParams.get('query')).toBe('assignee:me is:open');
  });

  it('shows every problem the server finds in it', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json(
        {
          error: {
            code: 'validation_failed',
            message: 'The query has problems.',
            details: [
              { path: 'query', message: 'There is no filter called statsu.' },
              { path: 'query', message: 'due: is one of overdue, today, week, none.' },
            ],
          },
        },
        { status: 422 },
      ),
    );
    await expect(
      listTickets(config, { mine: false, limit: 25, query: 'statsu:x due:soon' }),
    ).rejects.toThrow(
      'There is no filter called statsu.\ndue: is one of overdue, today, week, none.',
    );
  });
});
