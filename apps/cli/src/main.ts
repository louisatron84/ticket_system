import pkg from '../package.json' with { type: 'json' };
import { ServerError, call } from './client';
import { checkServer, readConfig, removeConfig, writeConfig, type CliConfig } from './config';
import { browserLogin, readSecret, whoAmI } from './login';
import { MOVE_WORDS, isMoveWord, moveTicket, ticketKey } from './moves';
import { formatCatalogue, formatTicket, listTickets, readTicket } from './tickets';

const DEFAULT_SERVER = 'http://localhost:3000';

const USAGE = `forge ${pkg.version}: work with Forge tickets from a terminal

Signing in
  forge login [--server URL] [--token] [--no-browser]
                           approve in the browser, or paste a token with --token
  forge logout             sign out and revoke this machine's token
  forge whoami             who you are signed in as, and where

Reading
  forge catalogue [--mine] [--status KEY] [--project KEY] [--search TEXT] [--limit N] [--json]
                           list tickets (short: forge cat)
  forge inspect <KEY> [--json]
                           show one ticket, and the moves it can make next

Moving
  forge cold <KEY>         to Cold Steel
  forge warm <KEY>         to Warming
  forge hammer <KEY>       to In the Forge
  forge temper <KEY>       to Tempering
  forge jammed <KEY>       to Jammed (also: forge jam)
  forge quench <KEY>       to Quenched
  forge scrap <KEY>        to Scrapped

  forge --version          the version

Keys are not case-sensitive: forge warm web-1 works.
Exit codes: 0 done, 1 refused or failed, 2 the command was wrong.`;

/** Exit codes: 0 done, 1 refused or failed, 2 the command itself was wrong. */
const OK = 0;
const FAILED = 1;
const USAGE_ERROR = 2;

type Io = { out: (line: string) => void; err: (line: string) => void };
const defaultIo: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

class UsageError extends Error {}

/**
 * Reads a command's arguments strictly: an option the command does not know, or one missing its
 * value, is a usage error rather than something quietly ignored.
 */
function parse(
  command: string,
  args: string[],
  spec: { flags?: string[]; options?: string[] },
): { positional: string[]; flags: Set<string>; options: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Set<string>();
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }
    if (spec.flags?.includes(arg)) {
      flags.add(arg);
    } else if (spec.options?.includes(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`${arg} needs a value. Run \`forge help\`.`);
      }
      options.set(arg, value);
      i += 1;
    } else {
      throw new UsageError(`forge ${command} does not take ${arg}. Run \`forge help\`.`);
    }
  }
  return { positional, flags, options };
}

async function signedIn(): Promise<CliConfig> {
  const config = await readConfig();
  if (!config) throw new ServerError(401, 'Not signed in. Run `forge login` first.');
  return config;
}

function oneKey(command: string, positional: string[]): string {
  const key = positional.length === 1 ? ticketKey(positional[0]!) : null;
  if (!key) throw new UsageError(`Usage: forge ${command} <KEY>   e.g. forge ${command} WEB-1`);
  return key;
}

async function login(args: string[], io: Io): Promise<number> {
  const parsed = parse('login', args, {
    flags: ['--token', '--no-browser'],
    options: ['--server'],
  });
  if (parsed.positional.length > 0) throw new UsageError('forge login takes no other words.');
  const previous = await readConfig();
  const checked = checkServer(parsed.options.get('--server') ?? previous?.server ?? DEFAULT_SERVER);
  if (!checked.ok) throw new UsageError(checked.message);
  const { server } = checked;

  const token = parsed.flags.has('--token')
    ? await readSecret('Paste your token (it will not be shown): ')
    : await browserLogin(server, { openBrowser: !parsed.flags.has('--no-browser'), say: io.out });
  if (!/^forge_pat_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new UsageError('That is not a Forge token. Tokens start with forge_pat_.');
  }
  const me = await whoAmI(server, token);
  await writeConfig({ server, token, ...me });
  io.out(
    `Signed in to ${me.workspace.name} as ${me.user.displayName} (${me.scope === 'write' ? 'read and change' : 'read only'}, until ${me.expiresAt.slice(0, 10)}).`,
  );
  return OK;
}

async function logout(args: string[], io: Io): Promise<number> {
  parse('logout', args, {});
  const config = await readConfig();
  if (!config) {
    io.out('Not signed in.');
    return OK;
  }
  try {
    await call(config.server, '/api/v1/cli/logout', { method: 'POST', token: config.token });
  } catch (error) {
    // Already revoked or expired: nothing left to revoke, but say if the server was unreachable.
    if (error instanceof ServerError && error.status === 0) {
      io.err(`${error.message} The token was not revoked; revoke it on the CLI tokens page.`);
    }
  }
  await removeConfig();
  io.out('Signed out.');
  return OK;
}

async function catalogue(args: string[], io: Io): Promise<number> {
  const parsed = parse('catalogue', args, {
    flags: ['--mine', '--json'],
    options: ['--status', '--project', '--search', '--limit'],
  });
  if (parsed.positional.length > 0) {
    throw new UsageError('forge catalogue takes options only, e.g. forge cat --mine');
  }
  const limitText = parsed.options.get('--limit') ?? '25';
  const limit = Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new UsageError('--limit must be a whole number from 1 to 100.');
  }
  // A move word is accepted for --status too: --status hammer means In the Forge.
  const statusText = parsed.options.get('--status');
  const status =
    statusText && isMoveWord(statusText) ? MOVE_WORDS[statusText].key : statusText?.toLowerCase();
  const config = await signedIn();
  const list = await listTickets(config, {
    mine: parsed.flags.has('--mine'),
    limit,
    ...(parsed.options.has('--project') ? { project: parsed.options.get('--project')! } : {}),
    ...(status ? { status } : {}),
    ...(parsed.options.has('--search') ? { search: parsed.options.get('--search')! } : {}),
  });
  if (parsed.flags.has('--json')) io.out(JSON.stringify(list, null, 2));
  else for (const line of formatCatalogue(list)) io.out(line);
  return OK;
}

async function inspect(args: string[], io: Io): Promise<number> {
  const parsed = parse('inspect', args, { flags: ['--json'] });
  const key = oneKey('inspect', parsed.positional);
  const config = await signedIn();
  const ticket = await readTicket(config, key);
  if (parsed.flags.has('--json')) io.out(JSON.stringify(ticket, null, 2));
  else for (const line of formatTicket(ticket, config.server, config.workspace.slug)) io.out(line);
  return OK;
}

export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  const args = [...argv];
  const command = args.shift();
  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      io.out(USAGE);
      return command ? OK : USAGE_ERROR;
    }
    if (command === '--version' || command === '-v' || command === 'version') {
      io.out(`forge ${pkg.version}`);
      return OK;
    }
    if (command === 'login') return await login(args, io);
    if (command === 'logout') return await logout(args, io);
    if (command === 'whoami') {
      parse('whoami', args, {});
      const config = await signedIn();
      const me = await whoAmI(config.server, config.token);
      io.out(
        `${me.user.displayName} <${me.user.email}> in ${me.workspace.name} on ${config.server}`,
      );
      return OK;
    }
    if (command === 'catalogue' || command === 'cat') return await catalogue(args, io);
    if (command === 'inspect') return await inspect(args, io);
    if (isMoveWord(command)) {
      const key = oneKey(command, parse(command, args, {}).positional);
      const result = await moveTicket(await signedIn(), command, key);
      (result.ok ? io.out : io.err)(result.message);
      return result.ok ? OK : FAILED;
    }
    const words = Object.keys(MOVE_WORDS).join(', ');
    throw new UsageError(
      `Unknown command "${command}". Moves: ${words}. Run \`forge help\` for the rest.`,
    );
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return error instanceof UsageError ? USAGE_ERROR : FAILED;
  }
}
