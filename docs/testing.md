# Testing

## Commands

| Command                  | Needs the database | What it runs                                                        |
| ------------------------ | ------------------ | ------------------------------------------------------------------- |
| `npm run check`          | yes                | typecheck, ESLint, Prettier check, then every workspace's tests     |
| `npm test`               | yes                | unit and integration tests only (Vitest)                            |
| `npm test -w @forge/api` | yes                | one workspace; swap in `@forge/web`, `@forge/db`, `@forge/shared`   |
| `npm run test:e2e`       | yes                | Playwright browser tests on an isolated stack that it starts itself |

Start the database first with `npm run db:start`. Integration and browser tests migrate and seed
their own databases, so no manual `db:migrate` is needed for them.

## What is covered

- **Unit tests** are pure and need nothing running: config validation, request-id sanitising, error
  mapping, health route behaviour (with fake checks), the shared schemas, permissions and the
  role-change rules, and the web app's navigation, workspace selection, role-option, API-client and
  status logic.
- **Integration tests** (`*.test.ts` in `apps/api` and `packages/db`) run against the real
  PostgreSQL named by `TEST_DATABASE_URL`:
  - the schema's constraints, including the composite foreign key that stops a membership using
    another organisation's role
  - migrations apply and are idempotent
  - the seed and the full reset
  - sessions: tampered, expired and revoked tokens, hashing at rest, `last seen` throttling
  - the account switcher routes: absent when disabled, key-only sign-in, foreign `Host` and
    `Origin` refused, one live session per switch, audit rows
  - a permission matrix of every identity against every organisation endpoint, plus escalation,
    mass-assignment, cross-tenant role ids, and a concurrency test (two owners demoting each other)
- **End-to-end tests** (`tests/e2e`) drive the real stack in a browser:
  - signing in and out, switching accounts, the back button after sign-out, replaying a cookie
  - what each role sees, and **crafted API calls that bypass the page** (the server must refuse)
  - a foreign workspace being indistinguishable from a missing one, and no data leaking after a
    switch
  - the shell: system status, sidebar (stored on the server, rendered collapsed on first paint),
    keyboard skip link, phone-width drawer, 404 page
  - the switcher refusing a foreign `Host` through the web proxy (DNS rebinding)

## Databases and isolation

Three databases, so nothing a test does can touch your development data:

| Database     | Used by                  | Wiped by                                     |
| ------------ | ------------------------ | -------------------------------------------- |
| `forge`      | `npm run dev`            | `npm run db:reseed` only                     |
| `forge_test` | Vitest integration tests | every test file, via `resetDatabaseForTests` |
| `forge_e2e`  | Playwright               | the e2e global setup and the dev-reset route |

`resetDatabaseForTests` **refuses to run** unless the connected database name ends in `_test` or
`_e2e`, and that guard has its own test using a fake connection. Test files that share a database
run one at a time.

## End-to-end specifics

- The browser tests start their own API (port 4100) and web app (port 3100, build folder
  `.next-e2e`) against `forge_e2e`, so they can run while `npm run dev` is up.
- Windows uses the Edge that ships with the OS, so no browser download is needed. On macOS or Linux
  run `npx playwright install chromium` once, or set `E2E_CHANNEL` to an installed channel.
- Tests wait until the page has hydrated before clicking (`hydrated()` in `tests/e2e/helpers.ts`);
  a click that lands earlier is silently lost.
- Set `E2E_SHOTS_DIR` to a folder to have the tests save screenshots there.

## Not covered yet

- React components have no unit tests (there is no jsdom setup); they are exercised by the browser
  tests instead.
- Browsers other than Edge (Chromium).
- A production sign-in flow, because none exists yet.
- Tenant isolation for entities that do not exist yet; each new entity must add its own.
