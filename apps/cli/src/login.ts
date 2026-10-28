import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { ServerError, call } from './client';
import type { CliConfig } from './config';

/** What the server says about the token in use. */
export type WhoAmI = Omit<CliConfig, 'server' | 'token'>;

export const whoAmI = (server: string, token: string) =>
  call<WhoAmI>(server, '/api/v1/cli/whoami', { token });

type Started = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
};

type Poll =
  | { status: 'pending' | 'slow_down' | 'denied' | 'expired' }
  | { status: 'approved'; token: string };

/** Opens the address in the person's browser; quietly does nothing if that is not possible. */
function openBrowser(url: string) {
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true })
      .on('error', () => {})
      .unref();
  } catch {
    // The address is printed too, so the person can open it by hand.
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Signs in by approval in the browser: the server gives a short code, the person checks it on the
 * approval page and allows it, and the token comes back here. Only the secret device code is sent
 * while waiting; the token never appears in an address.
 */
export async function browserLogin(
  server: string,
  options: { openBrowser: boolean; say: (line: string) => void },
): Promise<string> {
  const started = await call<Started>(server, '/api/v1/cli/login', {
    method: 'POST',
    json: { machine: hostname().slice(0, 100) },
  });
  options.say(`Your code: ${started.userCode}`);
  options.say(`Approve it at ${started.verificationUrl}`);
  options.say('Check the code on that page matches before you click Allow.');
  if (options.openBrowser) openBrowser(started.verificationUrl);

  let interval = started.interval * 1000;
  const deadline = Date.now() + started.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    let poll: Poll;
    try {
      poll = await call<Poll>(server, '/api/v1/cli/token', {
        method: 'POST',
        json: { deviceCode: started.deviceCode },
      });
    } catch (error) {
      // Asked too often: wait longer and try again rather than give up.
      if (error instanceof ServerError && error.status === 429) {
        interval += 5000;
        continue;
      }
      throw error;
    }
    if (poll.status === 'approved') return poll.token;
    if (poll.status === 'denied') throw new Error('The sign-in was denied in the browser.');
    if (poll.status === 'expired') break;
    if (poll.status === 'slow_down') interval += 2000;
  }
  throw new Error('The code expired before it was approved. Run `forge login` again.');
}

/** Reads a pasted token without showing it on screen. */
export async function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  process.stderr.write(prompt);
  if (!input.isTTY) {
    // Piped in (e.g. from a secret store): read the first line.
    let text = '';
    for await (const chunk of input) {
      text += chunk;
      if (text.includes('\n')) break;
    }
    process.stderr.write('\n');
    return text.split(/\r?\n/)[0]!.trim();
  }
  return new Promise((resolve, reject) => {
    let text = '';
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(text.trim());
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new Error('Cancelled.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') text = text.slice(0, -1);
        else text += ch;
      }
    };
    const finish = () => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stderr.write('\n');
    };
    input.on('data', onData);
  });
}
