import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call } from './client';
import { checkServer, writeConfig, type CliConfig } from './config';
import { flameLines, wantsColour } from './flame';
import { checkStarted } from './login';
import { closestCommand, helpFor, main } from './main';
import { MOVE_WORDS, findStatus, isMoveWord, moveTicket, ticketKey } from './moves';
import { formatTicket, listTickets } from './tickets';

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

describe('what a server sends at sign-in', () => {
  const good = {
    deviceCode: 'secret',
    userCode: 'ABCD-1234',
    verificationUrl: 'http://localhost:3000/cli/approve?code=ABCD-1234',
    expiresIn: 600,
    interval: 3,
  };

  it('is opened only as a web page on the server it came from', () => {
    expect(checkStarted('http://localhost:3000', good).verificationUrl).toBe(good.verificationUrl);
    for (const verificationUrl of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'ms-settings:',
      'https://evil.test/cli/approve',
      'http://user:pass@localhost:3000/',
      'not a url',
    ]) {
      expect(() => checkStarted('http://localhost:3000', { ...good, verificationUrl })).toThrow(
        /Nothing was opened/,
      );
    }
  });

  it('counts every name for this machine as the same host', () => {
    expect(checkStarted('http://127.0.0.1:3000', good).verificationUrl).toBe(good.verificationUrl);
  });

  it('never prints a code that is not a code', () => {
    expect(() =>
      checkStarted('http://localhost:3000', { ...good, userCode: '\u001b]0;pwned\u0007' }),
    ).toThrow(/Nothing was opened/);
  });
});

describe('inspect lists only moves that would go through', () => {
  const ticket = {
    key: 'WEB-4',
    title: 'Fix it',
    version: 1,
    status: { id: 's1', key: 'open', name: 'Warming', category: 'not_started' },
    priority: { key: 'normal', name: 'Flame' },
    assignee: null,
    parentKey: null,
    openBlockerKeys: ['API-9'],
    criteria: { done: 0, total: 0 },
    type: { key: 'task', name: 'Task' },
    project: { key: 'WEB', name: 'Web' },
    goal: '',
    description: '',
    criteriaItems: [],
    dueDate: null,
    archivedAt: null,
    allowedTransitions: [
      { key: 'in_progress', name: 'In the Forge', rules: [], refusal: null },
      {
        key: 'done',
        name: 'Quenched',
        rules: [],
        refusal: "WEB-4 can't be quenched while API-9 is open.",
      },
      { key: 'cancelled', name: 'Scrapped', rules: ['needs_comment'], refusal: null },
      { key: 'qa_check', name: 'QA check', rules: [], refusal: null },
    ],
  };

  it('says why a move is not possible now, and what a move needs', () => {
    const text = formatTicket(ticket, 'http://localhost:3000', 'acme').join('\n');
    expect(text).toContain('forge hammer WEB-4  # In the Forge');
    expect(text).toContain("Quenched: not now. WEB-4 can't be quenched while API-9 is open.");
    expect(text).not.toContain('forge quench WEB-4');
    expect(text).toContain('forge scrap WEB-4 -m "why"  # Scrapped');
    expect(text).toContain('forge move WEB-4 "QA check"  # QA check');
  });

  it('never puts a name that could run a command into a line to paste', () => {
    const hostile = {
      ...ticket,
      allowedTransitions: [
        { key: 'qa', name: 'QA $(id)', rules: [], refusal: null },
        { key: 'x-y', name: 'Ship `calc` & go', rules: [], refusal: null },
      ],
    };
    const lines = formatTicket(hostile, 'http://localhost:3000', 'acme');
    const text = lines.join('\n');
    expect(lines).toContain('  forge move WEB-4 qa');
    expect(text).toContain('One more status, whose name is not safe to paste');
    expect(text).not.toMatch(/\$\(|`|&/);
  });

  it('offers no moves to a read-only token', () => {
    const text = formatTicket(ticket, 'http://localhost:3000', 'acme', { readOnly: true }).join(
      '\n',
    );
    expect(text).toContain('None with this token: it is read only.');
    expect(text).not.toContain('forge hammer');
  });
});

describe('talking to the server', () => {
  const config: CliConfig = {
    server: 'http://localhost:3001',
    token: 'forge_test',
    user: { displayName: 'Dana', email: 'dana@acme.test' },
    workspace: { id: 'org-1', slug: 'acme', name: 'Acme' },
    scope: 'write',
    expiresAt: '2099-01-01T00:00:00Z',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FORGE_CONFIG_DIR;
  });

  it('gives up on a server that does not answer, instead of hanging', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    await expect(call(config.server, '/api/v1/cli/whoami')).rejects.toThrow(
      /did not answer within 30 seconds/,
    );
  });

  it('does not call a move that changes nothing a success', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      Response.json(
        url.includes('/tickets/')
          ? {
              key: 'WEB-1',
              version: 3,
              status: { id: 's1', key: 'open', name: 'Warming' },
              project: { key: 'WEB' },
            }
          : { statuses: [{ id: 's1', key: 'open', name: 'Warming' }] },
      ),
    );
    const result = await moveTicket(config, { word: 'warm' }, 'WEB-1');
    expect(result).toEqual({ ok: false, message: 'WEB-1 is already in Warming. Nothing changed.' });
  });

  it('names an unknown project instead of finding no tickets', async () => {
    process.env.FORGE_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'forge-cli-'));
    await writeConfig(config);
    vi.stubGlobal('fetch', async () => Response.json([{ key: 'WEB' }, { key: 'API' }]));
    const err: string[] = [];
    const code = await main(['cat', '--project', 'nope'], {
      out: () => {},
      err: (line) => err.push(line),
    });
    expect(code).toBe(2);
    expect(err.join('\n')).toBe('Acme has no project NOPE. Its projects: WEB, API.');
  });
});

describe('help and typos', () => {
  it('helps with one command, aliases included', () => {
    expect(helpFor('move')).toContain('forge move <KEY> <STATUS>');
    expect(helpFor('cat')).toContain('forge catalogue');
    expect(helpFor('hammer')).toContain('-m "text"');
    expect(helpFor('nope')).toBeNull();
  });

  it('suggests the command a typo meant, and nothing for a far-off word', () => {
    expect(closestCommand('hamer')).toBe('hammer');
    expect(closestCommand('inspct')).toBe('inspect');
    expect(closestCommand('Login')).toBe('login');
    expect(closestCommand('deploy')).toBeNull();
  });
});

describe('a server with no API behind it', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says the API did not answer, not just a status number', async () => {
    vi.stubGlobal('fetch', async () => new Response('Internal Server Error', { status: 500 }));
    await expect(call('http://localhost:3000', '/api/v1/cli/whoami')).rejects.toThrow(
      "http://localhost:3000 answered, but Forge's API behind it did not (500). Is the API running?",
    );
  });
});
