# Install and run Forge

From a fresh machine to a running Forge and a working `forge` command. For everyday commands and
the Docker alternative see [setup](setup.md).

## 1. Prerequisites

- **Git**: <https://git-scm.com/downloads>
- **Node.js 22.12 or newer**: <https://nodejs.org> (LTS is fine). Check with `node --version`.
- **Windows only**: PowerShell blocks npm's scripts by default. Allow scripts you install yourself
  (this affects only your own account):

  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

  Or use Command Prompt, or call `npm.cmd` and `forge.cmd` instead.

No Docker and no separate database install are needed.

## 2. Get the code

```bash
git clone https://github.com/louisatron84/ticket_system.git
cd ticket_system
```

## 3. Install

```bash
npm install
```

This also downloads an embedded PostgreSQL, so the first run takes a few minutes.

## 4. Settings

```bash
cp .env.example .env              # macOS, Linux, Git Bash
Copy-Item .env.example .env       # Windows PowerShell
```

The defaults work as they are.

## 5. Start the database (terminal 1)

```bash
npm run db:start
```

Leave it running. It serves PostgreSQL on port 54329 from this folder's `.data/postgres`, with the
databases `forge`, `forge_test` and `forge_e2e`.

## 6. Create the tables and the demo data (terminal 2)

```bash
npm run db:migrate     # ends with "N/N applied"
npm run db:seed        # demo people, two workspaces, demo tickets
```

## 7. Start Forge (terminal 2)

```bash
npm run dev            # API on :4000, web on :3000
```

## 8. Open it

Go to <http://localhost:3000> and pick a demo person: **Dana Developer** (a team member),
**Olivia Owner** (manages everything) or **Remy Read-only** (looks, cannot change). Who each one is:
[development accounts](development-accounts.md).

## 9. The `forge` command (terminal 3, in the `ticket_system` folder)

```bash
npm link -w @forge/cli
forge help
```

If `forge` is not found, npm's global folder is not on your `PATH`. `npm prefix -g` prints it: on
Windows add that folder itself, on macOS and Linux add its `bin` folder, then open a new terminal.
Then:

```bash
forge login            # approve in the browser
forge hammer WEB-2     # move WEB-2 to In the Forge
forge catalogue        # list tickets
forge inspect WEB-2    # show one
```

Remove it again with `npm unlink -g @forge/cli`.

## 10. Check everything (optional)

```bash
npm run check          # typecheck, lint, format, unit and integration tests
npm run test:e2e       # browser tests on their own databases and ports (3100, 4100)
```

On macOS and Linux run `npx playwright install chromium` once before the browser tests.

## When something goes wrong

- **"Port 54329 is already in use"**: if it is this folder's database, use it as it is. Otherwise
  another copy of Forge or Docker Compose holds the port. `npm run db:stop` stops only the database
  in this folder's `.data` directory.
- **Port 3000 or 4000 in use**: stop whatever uses it, or move Forge (below).

- **`db:migrate` says the database is not UTF-8**: only an old local database; see
  [setup](setup.md#the-database-must-be-utf-8).
- **Start the demo data again**: `npm run db:reseed` (wipes every table). The "Reset demo data"
  button in the account menu appears only with `FORGE_DEV_RESET=1` in `.env`, and never works on
  the `forge` database.

## Changing the ports

Every port is set in `.env` (a variable set in the shell wins), and whatever points at it must
follow:

| What         | Default | Set it with     | Then also change                                                       |
| ------------ | ------- | --------------- | ---------------------------------------------------------------------- |
| Web app      | 3000    | `WEB_PORT`      | `WEB_ORIGIN`; `forge login --server`                                   |
| API          | 4000    | `API_PORT`      | `API_INTERNAL_URL`                                                     |
| Dev database | 54329   | `FORGE_DB_PORT` | the port in `DATABASE_URL`, `TEST_DATABASE_URL` and `E2E_DATABASE_URL` |

`npm run db:start`, `npm run dev` and `docker compose up` all read them. For example, to move the
web app to 3001: `WEB_PORT=3001` and `WEB_ORIGIN=http://localhost:3001,http://127.0.0.1:3001`.
The browser tests always use 3100 and 4100, and refuse to start if something else holds those
ports (`E2E_REUSE_SERVERS=1` uses servers you started for them yourself).
