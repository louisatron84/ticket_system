import { createdTokenSchema, ticketDetailSchema } from '@forge/shared';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFacts, type Facts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';

// Runs the real `forge` command against a listening API, as a person would.

const BIN = path.resolve(import.meta.dirname, '../../../cli/bin/forge.mjs');

let ctx: Integration;
let f: Facts;
let server: string;
let home: string;

beforeAll(async () => {
  ctx = await startIntegration();
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const address = ctx.app.server.address();
  server = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

beforeEach(async () => {
  await ctx.reseed();
  f = await loadFacts(ctx.db);
  home = await mkdtemp(path.join(tmpdir(), 'forge-cli-'));
});

afterAll(async () => {
  await ctx.close();
});

type Run = { code: number | null; out: string; err: string };

/** Starts `forge`; `onOut` sees standard output as it arrives. */
function forge(args: string[], options: { input?: string; onOut?: (text: string) => void } = {}) {
  return new Promise<Run>((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, FORGE_CONFIG_DIR: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      options.onOut?.(out);
    });
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(options.input ?? '');
  });
}

async function tokenFor(as: string, scope: 'read' | 'write' = 'write') {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/me/tokens',
    headers: { cookie: await ctx.cookieFor(as) },
    payload: { name: 'cli test', organisationId: f.acmeId, scope, expiresInDays: 1 },
  });
  return createdTokenSchema.parse(response.json()).token;
}

const statusOf = async (key: string) => {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/orgs/${f.acmeId}/tickets/${key}`,
    headers: { cookie: await ctx.cookieFor('owner') },
  });
  return ticketDetailSchema.parse(response.json()).status.name;
};

describe('the forge command', () => {
  it('signs in with a pasted token, moves a ticket, and signs out', async () => {
    const token = await tokenFor('developer');
    const login = await forge(['login', '--token', '--server', server], { input: `${token}\n` });
    expect(login.code, login.err).toBe(0);
    expect(login.out).toContain('Signed in to Acme');
    expect(login.out).not.toContain(token);

    const config = path.join(home, 'config.json');
    expect(JSON.parse(await readFile(config, 'utf8')).token).toBe(token);
    if (process.platform !== 'win32') expect((await stat(config)).mode & 0o077).toBe(0);

    expect((await forge(['whoami'])).out).toContain('Dana Developer');

    // WEB-2 is in Warming; In the Forge is the next step.
    const moved = await forge(['hammer', 'web-2']);
    expect(moved.code, moved.err).toBe(0);
    expect(moved.out).toBe('WEB-2 moved from Warming to In the Forge.\n');
    expect(await statusOf('WEB-2')).toBe('In the Forge');

    expect((await forge(['hammer', 'WEB-2'])).out).toBe('WEB-2 is already in In the Forge.\n');

    const out = await forge(['logout']);
    expect(out.out).toBe('Signed out.\n');
    await expect(stat(config)).rejects.toThrow();
    // The token was revoked on the server, not only forgotten here.
    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/cli/whoami',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('a refused move says why, as the board does, and exits 1', async () => {
    await forge(['login', '--token', '--server', server], {
      input: `${await tokenFor('developer')}\n`,
    });
    // API-3 blocks WEB-7.
    const quench = await forge(['quench', 'WEB-7']);
    expect(quench.code).toBe(1);
    expect(quench.err).toMatch(/WEB-7 can't be quenched while API-3 is open\.|isn't allowed/);
    const missing = await forge(['warm', 'WEB-999']);
    expect(missing.code).toBe(1);
    expect(missing.err).toBe("WEB-999 doesn't exist in Acme Robotics.\n");
    // A refused move says where the ticket can go instead.
    const cold = await forge(['cold', 'WEB-12']);
    expect(cold.code).toBe(1);
    expect(cold.err).toContain('From Quenched it can go to');
  });

  it('reads the inbox and marks it read', async () => {
    await forge(['login', '--token', '--server', server], {
      input: `${await tokenFor('developer')}\n`,
    });
    expect((await forge(['inbox'])).out).toBe('Nothing unread.\n');
    const owner = await ctx.cookieFor('owner');
    const ticket = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-4`,
      headers: { cookie: owner },
    });
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-4`,
      headers: { cookie: owner },
      payload: {
        version: ticketDetailSchema.parse(ticket.json()).version,
        assigneeId: f.userId('developer'),
      },
    });
    const unread = await forge(['inbox']);
    expect(unread.out).toContain('Olivia Owner assigned WEB-4 to you');
    expect(unread.out).toContain('1 unread');
    expect((await forge(['inbox', 'read'])).out).toBe('All read.\n');
    expect((await forge(['inbox'])).out).toBe('Nothing unread.\n');
    expect((await forge(['inbox', '--all'])).out).toContain('WEB-4');
  });

  it('lists and shows tickets, as text or JSON', async () => {
    await forge(['login', '--token', '--server', server], {
      input: `${await tokenFor('developer')}\n`,
    });
    const mine = await forge(['cat', '--mine', '--status', 'hammer']);
    expect(mine.code, mine.err).toBe(0);
    expect(mine.out).toMatch(/^KEY\s+STATUS\s+HEAT\s+WHO\s+TITLE/);
    expect(mine.out).toContain('WEB-1 ');
    expect(mine.out).toContain('In the Forge');

    const json = await forge(['catalogue', '--project', 'api', '--json', '--limit', '3']);
    const list = JSON.parse(json.out) as { items: { key: string }[]; total: number };
    expect(list.items).toHaveLength(3);
    expect(list.items.every((item) => item.key.startsWith('API-'))).toBe(true);

    const shown = await forge(['inspect', 'web-1']);
    expect(shown.code, shown.err).toBe(0);
    expect(shown.out).toContain('Acceptance criteria (1 of 3 met)');
    expect(shown.out).toContain('[x] Signing in after expiry returns to the page you were on');
    expect(shown.out).toContain('Next moves');
    expect(shown.out).toContain(`/w/acme/tickets/WEB-1`);
    const asJson = JSON.parse((await forge(['inspect', 'WEB-1', '--json'])).out) as { key: string };
    expect(asJson.key).toBe('WEB-1');
  });

  it('a read-only token reads but cannot move', async () => {
    await forge(['login', '--token', '--server', server], {
      input: `${await tokenFor('developer', 'read')}\n`,
    });
    const moved = await forge(['hammer', 'WEB-2']);
    expect(moved.code).toBe(1);
    expect(moved.err).toContain('This token is read-only.');
    expect(await statusOf('WEB-2')).toBe('Warming');
  });

  it('signs in by approval in the browser', async () => {
    let approving: Promise<unknown> | null = null;
    const login = await forge(['login', '--no-browser', '--server', server], {
      onOut: (text) => {
        const code = /Your code: ([A-Z2-9]{4}-[A-Z2-9]{4})/.exec(text)?.[1];
        if (code && !approving) {
          approving = ctx.cookieFor('developer').then((cookie) =>
            ctx.app.inject({
              method: 'POST',
              url: '/api/v1/cli/login/decision',
              headers: { cookie },
              payload: {
                decision: 'allow',
                userCode: code,
                organisationId: f.acmeId,
                scope: 'write',
              },
            }),
          );
        }
      },
    });
    expect(login.code, login.err).toBe(0);
    expect(login.out).toContain('Signed in to Acme Robotics as Dana Developer');
    expect((await forge(['whoami'])).code).toBe(0);
  }, 30_000);

  it('refuses plain http to another machine and a pasted non-token', async () => {
    const remote = await forge(['login', '--token', '--server', 'http://forge.example.com']);
    expect(remote.code).toBe(2);
    expect(remote.err).toContain('Refusing plain http://');
    const junk = await forge(['login', '--token', '--server', server], { input: 'hunter2\n' });
    expect(junk.code).toBe(2);
    await rm(home, { recursive: true, force: true });
  });
});
