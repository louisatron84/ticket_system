#!/usr/bin/env node
// Starts the Next.js web app (`dev` or `start`) on the port in WEB_PORT, read from the shell or the
// repository's .env (the shell wins), 3000 if neither says. Next itself reads .env only after it
// has chosen its port, so the port has to be settled here.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // No .env: defaults apply.
}

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const port = process.env.WEB_PORT ?? '3000';
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error('[web] WEB_PORT must be a port number.');
  process.exit(1);
}

const child = spawn('next', [mode, '-H', '127.0.0.1', '-p', port], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
