# Forge

Forge is a developer workspace where tickets, GitHub branches and pull requests, code review and
deterministic workflow automation are one connected product. Automation is rule-based and
explainable; Forge makes no AI-driven decisions.

**Current stage: 1 (accounts and workspaces).** You can sign in as one of seven seeded test
accounts, switch between them instantly, and see how roles and permissions change what each can see
and do. Everything is enforced by the API, and workspaces are isolated from each other. There are
no projects or tickets yet. See [docs/known-limitations.md](docs/known-limitations.md) for exactly
what is and is not built.

## Quick start

Requires Node.js 22.9 or newer. No Docker needed.

```bash
npm install
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
npm run db:start              # PostgreSQL in its own terminal; leave it running
npm run db:migrate            # in a second terminal
npm run db:seed               # seven test accounts in two demo workspaces
npm run dev                   # API on :4000, web on :3000
```

Open <http://localhost:3000> and pick an account. Details, the Docker alternative and
troubleshooting: [docs/setup.md](docs/setup.md). Who each test account is:
[docs/development-accounts.md](docs/development-accounts.md).

## Everyday commands

| Command                        | What it does                                                           |
| ------------------------------ | ---------------------------------------------------------------------- |
| `npm run dev`                  | Start the API and the web app together                                 |
| `npm run db:start` / `db:stop` | Run / stop the local PostgreSQL (data in `.data/postgres`)             |
| `npm run db:migrate`           | Apply pending database migrations                                      |
| `npm run db:seed`              | Seed the test accounts if the database is empty                        |
| `npm run db:reseed`            | **Wipe every table**, then seed again                                  |
| `npm run db:generate`          | Generate a migration after editing `packages/db/src/schema.ts`         |
| `npm run db:reset`             | Delete the local database files (only while it is stopped)             |
| `npm run check`                | Typecheck, lint, format check and all unit/integration tests           |
| `npm run test:e2e`             | Browser tests on their own isolated stack ([testing](docs/testing.md)) |

## Repository map

```text
apps/api         Fastify HTTP API (sessions, authorisation, workspaces, members, health)
apps/web         Next.js application shell and pages
packages/shared  Zod schemas, permissions and role rules used by both apps
packages/db      Drizzle schema, migrations, seed and reset, connection pool
scripts/         Local database launcher
tests/e2e        Playwright browser tests
docs/            Setup, architecture, data model, security, testing, known limitations
```

## Documentation

- [Setup and troubleshooting](docs/setup.md)
- [Development accounts](docs/development-accounts.md)
- [Architecture and decisions](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Security](docs/security.md)
- [Testing](docs/testing.md)
- [Known limitations](docs/known-limitations.md)
- Implementation plans live in `docs/superpowers/plans/`.
