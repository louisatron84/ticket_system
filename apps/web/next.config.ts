import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

const repoRoot = path.resolve(import.meta.dirname, '../..');

// Next.js only reads .env files from this app's folder. Forge keeps one .env at the repo root
// (shared with the API), so load that instead. Next has already loaded (and cached) this app's
// own folder by now, so the reload must be forced. Variables already in the environment still win.
loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production', console, true);

const config: NextConfig = {
  // Internal packages ship as TypeScript source.
  transpilePackages: ['@forge/shared'],
  // This is an npm-workspaces monorepo: tell Turbopack where the real root is.
  turbopack: { root: repoRoot },
  poweredByHeader: false,
};

export default config;
