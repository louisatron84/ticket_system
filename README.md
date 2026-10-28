# Forge

Forge is a developer workspace where tickets, GitHub branches and pull requests, code review and
deterministic workflow automation are one connected product. Automation is rule-based and
explainable; Forge makes no AI-driven decisions.

**Current stage: 2, the ticket system (phases P0 to P3 and P5 of the [ticket roadmap](docs/superpowers/specs/2026-10-23-ticket-system-roadmap.md)).** You can sign in as one of eight seeded test
accounts and switch between them instantly. Each workspace has projects with tickets that you can
create, edit, comment on, filter, save as views, and move between statuses on a Kanban board or the
ticket page, following each project's workflow. The Tickets page has Board and List tabs, so every
project's tickets can be seen and moved on one board. Common work is quick: archive and duplicate,
create straight into a board column, change status, priority and assignee from a card or a list row,
change many tickets at once, and press Ctrl+K for the command menu or `?` for the keyboard shortcuts. Tickets can be split into parts (epic, ticket, sub-task, with progress shown on the parent), linked to each other, and blocked: a ticket held up by an unfinished one cannot be marked done, though it can always be scrapped. Statuses are named after the heat of the work (Cold
Steel, Warming, In the Forge, Tempering, Jammed, Quenched, Scrapped) and coloured to match, the
priorities run from Heatless through Ember, Flame and Blaze to Inferno, and each person can arrange their own board from its Display menu: which card details show, how tightly
cards pack, and which columns appear and in what order. Tickets have a goal, acceptance criteria, a formatted description, mentions, attachments and reactions. People watch tickets and get live notifications (a bell, an inbox, due-date reminders), see their own work on My Work, and can triage incoming tickets with a second person approving each decision. Roles decide what each account can see and
do, everything is enforced by the API, and workspaces are isolated from each other.

Not built yet: custom fields and the workflow editor (P4), planning (P6), search and import (P7),
real sign-in with MFA (only the development account switcher exists), Forge's own repositories,
code review and workflow automation. See
[docs/known-limitations.md](docs/known-limitations.md) for exactly what is and is not built.

## Quick start

Requires Node.js 22.12 or newer. No Docker needed.

```bash
npm install
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
npm run db:start              # PostgreSQL in its own terminal; leave it running
npm run db:migrate            # in a second terminal
npm run db:seed               # eight test accounts, two demo workspaces, demo tickets
npm run dev                   # API on :4000, web on :3000
```

Open <http://localhost:3000> and pick an account. A fuller step-by-step guide, from a fresh
machine: [docs/install.md](docs/install.md). If `db:migrate` says the database is not UTF-8,
your local database was created before Stage 2 on Windows; the fix is in
[docs/setup.md](docs/setup.md#the-database-must-be-utf-8). Details, the Docker alternative and
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

## The forge command

`apps/cli` is a small command line for reading and moving tickets. Install it once with
`npm link -w @forge/cli`, then:

```sh
forge login                 # approve in the browser (or: forge login --token)
forge hammer WEB-1          # move WEB-1 to In the Forge
forge cold|warm|hammer|temper|jammed|quench|scrap <KEY>
forge catalogue [--mine]    # list tickets (alias: forge cat; --json for scripts)
forge inspect WEB-1         # one ticket, and the moves it allows
forge inbox [--all]         # your notifications; forge inbox read marks them read
forge whoami
forge logout                # also revokes the token on the server
```

Moves follow the ticket's workflow and the blocker rule exactly as the board does. Tokens are
managed under the account menu, **CLI tokens**; see [security](docs/security.md#command-line-tokens).

## Repository map

```text
apps/api         Fastify HTTP API (sessions, authorisation, workspaces, members, projects, tickets, health)
apps/web         Next.js application shell and pages (projects, ticket list, ticket page, board)
apps/cli         The forge command: sign in and move tickets from a terminal
packages/shared  Zod schemas, permissions, role rules, ticket rules and list filters used by both apps
packages/db      Drizzle schema, migrations, seed and reset, connection pool
scripts/         Local database launcher
tests/e2e        Playwright browser tests
docs/            Setup, architecture, data model, workflows, security, testing, known limitations
```

## Documentation

- [Setup and troubleshooting](docs/setup.md)
- [Development accounts](docs/development-accounts.md)
- [Architecture and decisions](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Ticket workflows](docs/workflows.md)
- [Security](docs/security.md)
- [Testing](docs/testing.md)
- [Known limitations](docs/known-limitations.md)
- Implementation plans live in `docs/superpowers/plans/`.
