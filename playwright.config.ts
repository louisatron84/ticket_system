import { defineConfig } from '@playwright/test';

// Windows ships Edge, so no browser download is needed there. Elsewhere run
// `npx playwright install chromium` once, or set E2E_CHANNEL to an installed channel.
const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);

// The repository's .env, as the API and web app read it, so E2E_DATABASE_URL set there is used.
// Variables already in the environment win.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env: the defaults below apply.
}

// The end-to-end stack is isolated from the development stack: its own database, ports and
// Next.js build folder, so tests can run while `npm run dev` is up and never touch dev data.
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://forge:forge@localhost:54329/forge_e2e';
const API_PORT = 4100;
const REUSE_SERVERS = process.env.E2E_REUSE_SERVERS === '1';
const WEB_PORT = 3100;

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  // Tests share one seeded database, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`,
    ...(channel ? { channel } : {}),
  },
  // Starts its own API and web app; PostgreSQL must be up (npm run db:start). Something already
  // on 3100 or 4100 is an error rather than used, since it may be another copy of Forge with its
  // own data. E2E_REUSE_SERVERS=1 uses servers you started yourself for these tests.
  webServer: [
    {
      command: 'npm run dev:api',
      url: `http://127.0.0.1:${API_PORT}/health/live`,
      reuseExistingServer: REUSE_SERVERS,
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        API_PORT: String(API_PORT),
        FORGE_DEV_AUTH: '1',
        FORGE_DEV_RESET: '1',
        // Kept apart from a developer's own uploads.
        ATTACHMENTS_DIR: 'data/attachments-e2e',
        WEB_ORIGIN: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `npm exec -w @forge/web -- next dev -H 127.0.0.1 -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: REUSE_SERVERS,
      timeout: 120_000,
      env: {
        API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`,
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
});
