import { defineConfig } from '@playwright/test';

// Windows ships Edge, so no browser download is needed there. Elsewhere run
// `npx playwright install chromium` once, or set E2E_CHANNEL to an installed channel.
const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  fullyParallel: true,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    ...(channel ? { channel } : {}),
  },
  // Starts the apps when they are not already running. PostgreSQL must be up (npm run db:start).
  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://127.0.0.1:4000/health/live',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
