import { ServerError, call } from './client';
import { checkServer, readConfig, removeConfig, writeConfig, type CliConfig } from './config';
import { browserLogin, readSecret, whoAmI } from './login';
import { MOVE_WORDS, isMoveWord, moveTicket, ticketKey } from './moves';

const DEFAULT_SERVER = 'http://localhost:3000';

const USAGE = `forge: work with Forge tickets from a terminal

  forge login [--server URL] [--token] [--no-browser]
                         sign in (approve in the browser, or paste a token with --token)
  forge logout           sign out and revoke this machine's token
  forge whoami           who you are signed in as, and where

  forge cold <KEY>       move a ticket to Cold Steel
  forge warm <KEY>       ... to Warming
  forge hammer <KEY>     ... to In the Forge
  forge temper <KEY>     ... to Tempering
  forge jammed <KEY>     ... to Jammed (also: forge jam)
  forge quench <KEY>     ... to Quenched
  forge scrap <KEY>      ... to Scrapped

Keys are not case-sensitive: forge warm web-1 works.`;

/** Exit codes: 0 done, 1 refused or failed, 2 the command itself was wrong. */
const OK = 0;
const FAILED = 1;
const USAGE_ERROR = 2;

type Io = { out: (line: string) => void; err: (line: string) => void };
const defaultIo: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

function flag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

async function signedIn(io: Io): Promise<CliConfig | null> {
  const config = await readConfig();
  if (!config) io.err('Not signed in. Run `forge login` first.');
  return config;
}

async function login(args: string[], io: Io): Promise<number> {
  const useToken = flag(args, '--token');
  const noBrowser = flag(args, '--no-browser');
  const previous = await readConfig();
  const checked = checkServer(option(args, '--server') ?? previous?.server ?? DEFAULT_SERVER);
  if (!checked.ok) {
    io.err(checked.message);
    return USAGE_ERROR;
  }
  const { server } = checked;

  const token = useToken
    ? await readSecret('Paste your token (it will not be shown): ')
    : await browserLogin(server, { openBrowser: !noBrowser, say: io.out });
  if (!/^forge_pat_[A-Za-z0-9_-]{43}$/.test(token)) {
    io.err('That is not a Forge token. Tokens start with forge_pat_.');
    return USAGE_ERROR;
  }
  const me = await whoAmI(server, token);
  await writeConfig({ server, token, ...me });
  io.out(
    `Signed in to ${me.workspace.name} as ${me.user.displayName} (${me.scope === 'write' ? 'read and change' : 'read only'}, until ${me.expiresAt.slice(0, 10)}).`,
  );
  return OK;
}

async function logout(io: Io): Promise<number> {
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

export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  const args = [...argv];
  const command = args.shift();
  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      io.out(USAGE);
      return command ? OK : USAGE_ERROR;
    }
    if (command === 'login') return await login(args, io);
    if (command === 'logout') return await logout(io);
    if (command === 'whoami') {
      const config = await signedIn(io);
      if (!config) return FAILED;
      const me = await whoAmI(config.server, config.token);
      io.out(
        `${me.user.displayName} <${me.user.email}> in ${me.workspace.name} on ${config.server}`,
      );
      return OK;
    }
    if (isMoveWord(command)) {
      const key = args[0] ? ticketKey(args[0]) : null;
      if (!key || args.length !== 1) {
        io.err(`Usage: forge ${command} <KEY>   e.g. forge ${command} WEB-1`);
        return USAGE_ERROR;
      }
      const config = await signedIn(io);
      if (!config) return FAILED;
      const result = await moveTicket(config, command, key);
      (result.ok ? io.out : io.err)(result.message);
      return result.ok ? OK : FAILED;
    }
    const words = Object.keys(MOVE_WORDS).join(', ');
    io.err(`Unknown command "${command}". Moves: ${words}. Run \`forge help\` for more.`);
    return USAGE_ERROR;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return FAILED;
  }
}
