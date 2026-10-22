# Testing

## Commands

| Command                  | Needs the database | What it runs                                                        |
| ------------------------ | ------------------ | ------------------------------------------------------------------- |
| `npm run check`          | yes                | typecheck, ESLint, Prettier check, then every workspace's tests     |
| `npm test`               | yes                | unit and integration tests only (Vitest)                            |
| `npm test -w @forge/api` | yes                | one workspace; swap in `@forge/web`, `@forge/db`, `@forge/shared`   |
| `npm run test:e2e`       | yes                | Playwright browser tests; starts the API and web app if not running |

Start the database first with `npm run db:start`, and apply migrations once with
`npm run db:migrate`.

## What is covered

- **Unit tests** are pure and need nothing running: config validation, request-id sanitising, error
  mapping, health route behaviour (with fake checks), the shared schemas, and the web app's
  navigation registry, preference storage, API client and status mapping.
- **Integration tests** (`*.integration.test.ts`, and `packages/db`) run against the real
  PostgreSQL named by `TEST_DATABASE_URL`: migrations apply and are idempotent, and the readiness
  checks pass or fail correctly, including against a closed port.
- **End-to-end tests** (`tests/e2e`) drive the real stack in a browser: the status page, sidebar
  collapse and persistence (including corrupt and blocked browser storage), keyboard skip link,
  phone-width drawer with no horizontal scroll, and the 404 page.

Integration tests **drop** `system_metadata` and the `drizzle` schema in the test database. They use
`forge_test`, never `forge`. Test files run one at a time because they share that database.

## End-to-end specifics

- Windows uses the Edge that ships with the OS, so no browser download is needed. On macOS or Linux
  run `npx playwright install chromium` once, or set `E2E_CHANNEL` to an installed channel.
- Set `E2E_SHOTS_DIR` to a folder to have the tests save screenshots there.
- Set `E2E_BASE_URL` to test a different origin.

## Not covered yet

Component-level tests for the React shell (there is no jsdom setup; the shell is checked by the
end-to-end tests instead), a database-down end-to-end test (the API-unreachable and
database-unreachable states were verified by hand and by unit tests, not by an automated browser
test), and any authenticated flow (authentication arrives in Stage 1).
