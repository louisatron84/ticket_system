import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';

/** What `forge login` remembers. The token is a secret: the file is readable by its owner only. */
export type CliConfig = {
  server: string;
  token: string;
  user: { displayName: string; email: string };
  workspace: { id: string; slug: string; name: string };
  scope: 'read' | 'write';
  expiresAt: string;
};

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.FORGE_CONFIG_DIR ?? path.join(homedir(), '.forge');
}

export const configPath = (env?: NodeJS.ProcessEnv) => path.join(configDir(env), 'config.json');

export async function readConfig(env?: NodeJS.ProcessEnv): Promise<CliConfig | null> {
  try {
    return JSON.parse(await readFile(configPath(env), 'utf8')) as CliConfig;
  } catch {
    return null;
  }
}

/** Windows: only the current user (and what they create inside) may use this path. */
function ownerOnlyOnWindows(target: string, inherit: boolean) {
  const user = `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ''}${userInfo().username}`;
  execFileSync(
    'icacls',
    [target, '/inheritance:r', '/grant:r', `${user}:${inherit ? '(OI)(CI)F' : 'F'}`],
    { stdio: 'ignore', windowsHide: true },
  );
}

/**
 * Writes the config so only the current user can read it: mode 0600 on Unix. On Windows the folder
 * is locked down first, so the token is never on disk with wider permissions, even briefly; if
 * that fails, nothing is written.
 */
export async function writeConfig(config: CliConfig, env?: NodeJS.ProcessEnv): Promise<void> {
  const dir = configDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') ownerOnlyOnWindows(dir, true);
  const file = configPath(env);
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  if (process.platform === 'win32') ownerOnlyOnWindows(file, false);
}

export async function removeConfig(env?: NodeJS.ProcessEnv): Promise<void> {
  await rm(configPath(env), { force: true });
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The server address as typed, checked: https anywhere, plain http only to this machine, so a
 * token is never sent across a network unencrypted.
 */
export function checkServer(
  input: string,
): { ok: true; server: string } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return {
      ok: false,
      message: `"${input}" is not a web address, e.g. https://forge.example.com`,
    };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, message: 'The server address must start with https://' };
  }
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
    return {
      ok: false,
      message:
        'Refusing plain http:// to another machine: the token would travel unencrypted. Use https://',
    };
  }
  return { ok: true, server: url.origin };
}
