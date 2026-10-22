# Forge

Forge is a developer workspace where tickets, GitHub branches and pull requests, code review and
deterministic workflow automation are one connected product. Automation is rule-based and
explainable; Forge makes no AI-driven decisions.

**Current stage: 0 (foundation).** Nothing product-facing exists yet beyond the application shell and
a live system-status page. See [docs/known-limitations.md](docs/known-limitations.md) for exactly
what is and is not built.

## Quick start

Requires Node.js 22.9 or newer. No Docker needed.

```bash
npm install
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
npm run db:start              # PostgreSQL in its own terminal; leave it running
npm run db:migrate            # in a second terminal
npm run dev                   # API on :4000, web on :3000
```

Open <http://localhost:3000>. The Overview page shows the API, database and migration status.

Details, the Docker alternative and troubleshooting: [docs/setup.md](docs/setup.md).

## Everyday commands

| Command                        | What it does                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| `npm run dev`                  | Start the API and the web app together                               |
| `npm run db:start` / `db:stop` | Run / stop the local PostgreSQL (data in `.data/postgres`)           |
| `npm run db:migrate`           | Apply pending database migrations                                    |
| `npm run db:generate`          | Generate a migration after editing `packages/db/src/schema.ts`       |
| `npm run db:reset`             | Delete the local database files (only while it is stopped)           |
| `npm run check`                | Typecheck, lint, format check and all unit/integration tests         |
| `npm run test:e2e`             | Browser tests against the running stack ([testing](docs/testing.md)) |

## Repository map

```text
apps/api         Fastify HTTP API (config, errors, request ids, health checks)
apps/web         Next.js application shell and pages
packages/shared  Zod schemas and constants used by both apps (error shape, health reports)
packages/db      Drizzle schema, migrations, connection pool, migrate CLI
scripts/         Local database launcher
tests/e2e        Playwright browser tests
docs/            Setup, architecture, testing, known limitations
```

## Documentation

- [Setup and troubleshooting](docs/setup.md)
- [Architecture and decisions](docs/architecture.md)
- [Testing](docs/testing.md)
- [Known limitations](docs/known-limitations.md)
- Implementation plans live in `docs/superpowers/plans/`.
