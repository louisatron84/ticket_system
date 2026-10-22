# Setup

## Prerequisites

- **Node.js 22.9 or newer** (the scripts use `process.loadEnvFile`). Check with `node --version`.
- **npm 10 or newer** (ships with Node 22).
- Optional: Docker, if you prefer it for PostgreSQL.

Nothing else is required. PostgreSQL itself is provided by an npm package (see below).

## First-time setup

```bash
npm install
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
```

`.env` is git-ignored. The defaults work as-is. Variables:

| Variable            | Default                                             | Used by                                  |
| ------------------- | --------------------------------------------------- | ---------------------------------------- |
| `DATABASE_URL`      | `postgres://forge:forge@localhost:54329/forge`      | API, `db:migrate`, `db:seed`             |
| `TEST_DATABASE_URL` | `postgres://forge:forge@localhost:54329/forge_test` | integration tests (they wipe it)         |
| `E2E_DATABASE_URL`  | `postgres://forge:forge@localhost:54329/forge_e2e`  | browser tests (they wipe it)             |
| `API_HOST`          | `127.0.0.1`                                         | API                                      |
| `API_PORT`          | `4000`                                              | API                                      |
| `LOG_LEVEL`         | `info`                                              | API                                      |
| `FORGE_DEV_AUTH`    | `1` in `.env.example`, off if unset                 | API: development account switcher        |
| `WEB_ORIGIN`        | `http://localhost:3000,http://127.0.0.1:3000`       | API: origins allowed to make writes      |
| `SESSION_TTL_HOURS` | `168`                                               | API: how long a sign-in lasts (1 to 720) |
| `API_INTERNAL_URL`  | `http://127.0.0.1:4000`                             | web server, to reach the API             |

The API refuses to start on an invalid value and names the variable (never the value). It also
refuses `FORGE_DEV_AUTH=1` together with `NODE_ENV=production`.

## Start PostgreSQL

Pick one. Both use the same credentials and port `54329`, so `DATABASE_URL` does not change.

### Option A: `npm run db:start` (no Docker)

Runs real PostgreSQL 18 binaries from the `embedded-postgres` package. Data lives in
`.data/postgres`. The first run creates the cluster and three databases: `forge` (development),
`forge_test` (integration tests) and `forge_e2e` (browser tests).

```bash
npm run db:start      # keep this terminal open; Ctrl+C stops the database
```

Stop it from another terminal (or if its terminal was closed) with `npm run db:stop`. Restarting
reuses the existing data directory and never re-initialises it, and creates any missing database.
It listens on loopback only.

This is for local development. It is not a production database.

### Option B: Docker Compose

```bash
docker compose up -d db
```

> Not verified: Docker is not installed on the machine this was developed on, so
> `docker-compose.yml` has not been run. If it misbehaves, use Option A and please fix the file.

## Create the schema, seed it and run

In a second terminal:

```bash
npm run db:migrate    # expect: "Migrations up to date: 2/2 applied." (the number grows over time)
npm run db:seed       # seven test accounts in two demo workspaces; skips if data already exists
npm run dev           # API on http://127.0.0.1:4000, web on http://localhost:3000
```

Open <http://localhost:3000>. You are sent to a sign-in page listing the test accounts; pick one.
See [development accounts](development-accounts.md) for who is who.

You can also probe the API directly:

```bash
curl http://127.0.0.1:4000/health/live     # process is up
curl http://127.0.0.1:4000/health/ready    # database + migrations; 503 if either fails
```

To run the pieces separately: `npm run dev:api` and `npm run dev:web`.

If you pulled Stage 1 into a database you created earlier, restart the database once
(`npm run db:stop`, then `npm run db:start`) so it creates `forge_e2e`, then run `npm run db:migrate`.

## Troubleshooting

**PowerShell says "running scripts is disabled on this system"** when you run `npm`. Windows blocks
`npm.ps1` by default. Any one of these fixes it:

- Use `npm.cmd` instead of `npm` (for example `npm.cmd run db:start`).
- Open a Command Prompt or Git Bash terminal instead of PowerShell. In VS Code, use the `+` dropdown
  next to the terminal tabs.
- Allow your own user to run local scripts, once:
  `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

**"Port 54329 is already in use"** when starting the database. Either it is already running
(`npm run db:stop`, then start again), or Docker Compose holds the port (`docker compose down`).

**The sign-in page says "Sign-in isn't configured for this environment yet".** The API was started
without `FORGE_DEV_AUTH=1`. Add it to `.env` and restart `npm run dev`.

**The sign-in page lists accounts but signing in does nothing, or you land back on sign-in.** The
database has no seed data or is out of date: run `npm run db:migrate` and `npm run db:seed`.

**A page says "This page failed to load".** The API is not running or crashed. Start it with
`npm run dev`, and read the API terminal for the reason. If it exited immediately, the message
names the invalid environment variable.

**A status row says "Pending migrations".** Run `npm run db:migrate`.

**A status row says "Cannot connect to PostgreSQL".** The database is stopped. Run
`npm run db:start`. The API recovers on its own once the database is back; no restart is needed.

**`db:start` fails after the machine crashed or the terminal was killed.** A leftover
`.data/postgres/postmaster.pid` can confuse the next start. Run `npm run db:stop` first. If that
does not help and you do not need the data, run `npm run db:reset` (deletes `.data/postgres`).

**Start over from nothing.** `npm run db:stop`, `npm run db:reset`, then `npm run db:start`,
`npm run db:migrate` and `npm run db:seed`. To keep the database but wipe its contents and
reseed, use `npm run db:reseed`.

**Integration tests say `TEST_DATABASE_URL is not set`.** Create `.env` from `.env.example` and make
sure the database is running.

**Next.js telemetry.** Next.js collects anonymous usage data. Opt out by setting
`NEXT_TELEMETRY_DISABLED=1` in your shell.

**`npm audit` reports 4 moderate issues.** They come from an old `esbuild` inside `drizzle-kit`, a
development-only migration generator that never runs as a server here. The suggested "fix" is a
major downgrade, so it is deliberately not applied. See
[known limitations](known-limitations.md).
