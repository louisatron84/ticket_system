# Forge Stage 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reproducible monorepo in which a Next.js shell, a Fastify API and a local PostgreSQL talk to each other, with health checks, structured logging, migrations, tests and docs — the base every later Forge stage builds on.

**Architecture:** npm-workspaces monorepo. `apps/api` (Fastify) and `apps/web` (Next.js App Router) consume internal TypeScript packages (`@forge/shared`, `@forge/db`) as source — no per-package build step in dev. PostgreSQL runs from `docker-compose.yml` where Docker exists, or from `scripts/dev-db.mjs` (real Postgres binaries via `embedded-postgres`) where it does not (this machine). The web app calls the API server-side; no browser→API traffic exists yet.

**Tech Stack:** Node 22, npm workspaces, TypeScript 5.9 (strict), Fastify 5, zod 4, pino 10, Drizzle ORM 0.45 + drizzle-kit 0.31 + `pg` 8, Next.js 16 + React 19, Tailwind 4, lucide-react, sonner, Vitest 5, ESLint 10 + typescript-eslint 8, Prettier 3.

**Spec:** The Forge product specification was supplied in the conversation and is not stored in the repo. This plan covers its Stage 0 (Part XI) plus the cross-cutting requirements in Parts VII, VIII, IX and X that Stage 0 must not violate. Later stages are summarised in the roadmap at the end and planned in detail when they start.

## Global Constraints

- Strict TypeScript everywhere; TypeScript pinned to `~5.9.3` because typescript-eslint 8.72 requires `<6.1.0`.
- PostgreSQL is the only datastore. No Redis.
- No AI-powered decisions anywhere in the product.
- "Never represent a mocked, simulated or unimplemented feature as functional." Navigation shows only routes that exist; planned routes are listed in the nav registry but not rendered.
- "Do not expose internal database errors, stack traces, credentials or private implementation details to clients." Errors share one JSON shape (`apiErrorSchema`).
- Structured logs with correlation identifiers; never log secrets, cookies, or authorization headers.
- Dark theme first; colours defined as CSS tokens so a light theme can be added later.
- Do not create empty packages or placeholder docs. Docs describe only what exists.
- Windows 11 + PowerShell is the primary dev platform: npm scripts must be cross-platform (no POSIX-only syntax).
- Ports: API `4000`, web `3000`, dev Postgres `54329` (avoids clashing with a system Postgres on 5432).
- No git commits are made without the user asking; each task ends with a verification checkpoint instead.

## Review Focus

Inputs and failure modes the spec implies but no feature task would otherwise exercise, most likely first. Each has a pinning test in the owning task.

1. **Postgres down or hung when `/health/ready` is called** — must return `503` with a structured body within the per-check timeout (2 s), never hang or leak the connection string. (Task 4)
2. **`DATABASE_URL` missing or malformed at startup** — must fail fast naming the variable, never echoing its value. (Task 3)
3. **Malformed JSON, oversized body, unknown route** — must produce the shared error shape, not Fastify's default body or a stack trace. (Task 3)
4. **Hostile `x-request-id` header** (newlines, 10 KB, non-ASCII) — must be replaced by a generated id, so it cannot forge or inject log lines. (Task 3)
5. **Corrupt or unavailable `localStorage` for the sidebar preference** — must fall back to the default and not crash rendering. (Task 5)

Also pinned: migrations are idempotent when run twice (Task 2); `dev-db` re-runs without wiping existing data (Task 2).

---

## File Structure

```
package.json                  workspaces + scripts (dev, check, db:*)
tsconfig.base.json            strict compiler options shared by all packages
eslint.config.mjs             flat config: typescript-eslint, react-hooks for apps/web
.prettierrc.json  .prettierignore  .gitignore  .env.example
docker-compose.yml            db service on host port 54329
scripts/dev-db.mjs            start/stop/reset local Postgres via embedded-postgres
packages/shared/              zod schemas + constants shared by API and web
packages/db/                  Drizzle schema, pool/db factories, migrations, migrate CLI
apps/api/                     Fastify app (config, logger, request-id, errors, health, main)
apps/web/                     Next.js shell (nav registry, preferences, shell components, Overview)
docs/                         README + setup, architecture, testing, known-limitations
```

---

### Task 1: Workspace scaffold, quality tooling and shared contracts

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.env.example`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/errors.ts`, `packages/shared/src/health.ts`, `packages/shared/src/http.ts`
- Test: `packages/shared/src/errors.test.ts`, `packages/shared/src/health.test.ts`

**Interfaces:**
- Produces (`@forge/shared`, all re-exported from `src/index.ts`):
  - `ERROR_CODES` (`as const` tuple): `validation_failed | not_found | unauthenticated | forbidden | conflict | payload_too_large | rate_limited | dependency_unavailable | internal_error`; `type ErrorCode`
  - `apiErrorSchema`: `{ error: { code: ErrorCode, message: string, requestId: string, details?: { path: string, message: string }[] } }`; `type ApiError`
  - `healthLiveSchema`: `{ status: 'ok', version: string, uptimeSeconds: number >= 0 }`
  - `checkResultSchema`: `{ status: 'ok' | 'failed', latencyMs?: number >= 0, detail?: string }`
  - `healthReadySchema`: `{ status: 'ok' | 'degraded', checks: Record<string, CheckResult> }`; types `HealthLive`, `CheckResult`, `HealthReady`
  - `REQUEST_ID_HEADER = 'x-request-id'`

- [ ] **Step 1: Write the failing tests.** `errors.test.ts`: `apiErrorSchema` accepts `{error:{code:'not_found',message:'x',requestId:'abc'}}`, accepts `details`, rejects an unknown `code`, rejects a missing `requestId`. `health.test.ts`: `healthReadySchema` accepts `{status:'degraded',checks:{database:{status:'failed',detail:'timeout'}}}`; rejects `status:'ok'` with a check whose status is `'maybe'`; `healthLiveSchema` rejects negative `uptimeSeconds`.
- [ ] **Step 2: Scaffold the workspace.** Root `package.json` (`private`, `"workspaces": ["apps/*","packages/*"]`, `"engines": {"node": ">=22.9"}`) with scripts `typecheck` (`npm run typecheck --workspaces --if-present`), `lint` (`eslint .`), `format` / `format:check` (Prettier), `test` (`npm run test --workspaces --if-present`), `check` (typecheck + lint + format:check + test, run in that order). Root devDependencies: `typescript@~5.9.3`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`, `vitest`, `@types/node`, `tsx`, `concurrently`. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes: false`, `target ES2023`, `module ESNext`, `moduleResolution Bundler`, `verbatimModuleSyntax`, `skipLibCheck`, `noEmit`. `.gitignore`: `node_modules`, `.next`, `.env`, `.data/`, `dist`, `coverage`, `*.tsbuildinfo`. `.env.example` documents `DATABASE_URL=postgres://forge:forge@localhost:54329/forge`, `TEST_DATABASE_URL=…/forge_test`, `API_HOST`, `API_PORT`, `LOG_LEVEL`, `API_INTERNAL_URL`.
- [ ] **Step 3: Implement the schemas in `packages/shared/src/{errors,health,http}.ts`** to the signatures above using zod 4; `package.json` of the package sets `"main"`/`"types"` to `src/index.ts` and has a `test` script (`vitest run`).
- [ ] **Step 4: Run** `npm install` then `npm run check`. Expected: install succeeds; typecheck, lint, format:check, and the shared tests all pass.

---

### Task 2: Local database, `@forge/db` package and first migration

**Files:**
- Create: `docker-compose.yml`, `scripts/dev-db.mjs`
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/src/index.ts`, `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/migrate.ts`, `packages/db/src/status.ts`, `packages/db/src/env.ts`, `packages/db/migrations/` (generated)
- Test: `packages/db/src/migrate.test.ts`

**Interfaces:**
- Consumes: `.env` values from Task 1.
- Produces (`@forge/db`):
  - `systemMetadata` — `pgTable('system_metadata', { key: text pk, value: text notNull, updatedAt: timestamptz notNull default now })`
  - `createPool(databaseUrl: string): Pool` — `pg.Pool`, `max: 10`, `connectionTimeoutMillis: 2000`, `statement_timeout` 5000 ms
  - `createDb(pool: Pool): Db` where `Db = NodePgDatabase<typeof schema>`
  - `runMigrations(pool: Pool): Promise<void>`
  - `migrationStatus(pool: Pool): Promise<{ expected: number; applied: number }>` — `expected` counted from `migrations/meta/_journal.json`, `applied` from `drizzle.__drizzle_migrations` (0 if the table does not exist yet)
  - `loadDotEnv(): void` — `process.loadEnvFile` on the repo-root `.env`, ignoring a missing file
  - CLI: `npm run db:migrate` runs `src/migrate.ts` against `DATABASE_URL`
- `scripts/dev-db.mjs` commands: `start` (foreground; initialises `.data/postgres` only if absent, never wipes; ensures databases `forge` and `forge_test` and role `forge`/`forge`; listens on 54329; stops cleanly on SIGINT/SIGTERM), `reset` (refuses when `NODE_ENV=production`; stops nothing — deletes `.data/postgres` only if no server is listening on 54329).

- [ ] **Step 1: Write the failing integration test** `migrate.test.ts` (uses `TEST_DATABASE_URL`; each test works in a throw-away schema-free database by dropping `drizzle` schema and `system_metadata` first): `migrationStatus` on an empty database returns `{expected: 1, applied: 0}`; after `runMigrations` returns `{expected: 1, applied: 1}`; running `runMigrations` a second time does not throw and leaves `applied: 1`; `system_metadata` accepts an insert and rejects a null `value`.
- [ ] **Step 2: Run it** — `npm test -w @forge/db`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `scripts/dev-db.mjs`** with `embedded-postgres` (install as a root devDependency; its Windows binary package is pulled automatically). Reads the package's README after install for the exact constructor options. Write `docker-compose.yml` with a `postgres:18` service, user/password/db `forge`, host port `54329`, a named volume, and a `pg_isready` healthcheck.
- [ ] **Step 4: Start the database** — `npm run db:start` in a background terminal. Expected: log line stating it is accepting connections on 54329; re-running the command with the data directory present does not re-initialise it.
- [ ] **Step 5: Implement schema, client, status, migrate CLI**; generate the migration with `drizzle-kit generate` (config points at `src/schema.ts`, output `migrations/`); commit-ready SQL is reviewed by eye for the `system_metadata` table only.
- [ ] **Step 6: Run** `npm run db:migrate` then `npm test -w @forge/db`. Expected: migration applies; all tests PASS.

---

### Task 3: API foundation — config, logging, request ids, error handling

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/config.ts`, `apps/api/src/request-id.ts`, `apps/api/src/errors.ts`, `apps/api/src/app.ts`
- Test: `apps/api/src/config.test.ts`, `apps/api/src/request-id.test.ts`, `apps/api/src/errors.test.ts`

**Interfaces:**
- Consumes: `ApiError`, `ErrorCode`, `REQUEST_ID_HEADER` from `@forge/shared`.
- Produces:
  - `type AppConfig = { nodeEnv: 'development'|'test'|'production'; host: string; port: number; databaseUrl: string; logLevel: 'fatal'|'error'|'warn'|'info'|'debug'|'trace'|'silent'; version: string }`
  - `class ConfigError extends Error` — message lists invalid variable names only, never values
  - `loadConfig(env: NodeJS.ProcessEnv): AppConfig` — defaults: `NODE_ENV=development`, `API_HOST=127.0.0.1`, `API_PORT=4000`, `LOG_LEVEL=info` (`silent` when `NODE_ENV=test` unless set); `DATABASE_URL` required and must parse as a `postgres://` or `postgresql://` URL
  - `resolveRequestId(header: string | string[] | undefined): string` — accepts only `/^[A-Za-z0-9._-]{8,128}$/`; otherwise `crypto.randomUUID()`
  - `class AppError extends Error { code: ErrorCode; statusCode: number; details?: ApiError['error']['details'] }` constructed `new AppError(code, message, statusCode, details?)`
  - `registerErrorHandling(app: FastifyInstance): void` — sets error and not-found handlers
  - `AppDeps = { config: AppConfig; readinessChecks: ReadinessCheck[] }` and `buildApp(deps: AppDeps): Promise<FastifyInstance>` (does not call `ready()` or `listen()`; `bodyLimit: 1_048_576`; pino logger with `redact` for `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`; `genReqId` uses `resolveRequestId`; every response carries the `x-request-id` header)
  - `ReadinessCheck = { name: 'database' | 'migrations'; run(signal: AbortSignal): Promise<{ detail?: string } | void> }` (defined here, used in Task 4)

- [ ] **Step 1: Write the failing tests.**
  - `config.test.ts`: valid env → typed config with the defaults above; missing `DATABASE_URL` → `ConfigError` whose message contains `DATABASE_URL`; `DATABASE_URL=mysql://u:secret-pw@h/db` → `ConfigError` whose message contains `DATABASE_URL` and does **not** contain `secret-pw`; `API_PORT=abc` → `ConfigError` naming `API_PORT`; `NODE_ENV=test` defaults `logLevel` to `silent`.
  - `request-id.test.ts`: a valid id passes through; `"a\nb-12345678"`, a 10 KB string, `"ünïcode-12345678"`, an empty string and `undefined` each yield a UUID-shaped replacement; an array header uses only a valid first element, else a replacement.
  - `errors.test.ts` (via `app.inject`, routes registered on a built app before the first request): unknown route → `404` + `apiErrorSchema`-valid body with `code: 'not_found'`; `POST` with body `{bad json` and `content-type: application/json` → `400` `validation_failed`; a body over 1 MiB → `413` `payload_too_large`; a route that throws `new Error('SELECT secret FROM x')` → `500` `internal_error`, body does not contain `SELECT`, `stack` or `secret`; a route throwing `AppError('forbidden','nope',403)` → `403` with that code; every response includes an `x-request-id` header and the body's `requestId` equals it; a hostile `x-request-id` request header is not echoed back.
- [ ] **Step 2: Run** `npm test -w @forge/api`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement the units above.** `loadConfig` validates with a zod schema and maps issues to variable names. The error handler maps Fastify's own error codes (invalid JSON, payload too large) to the shared codes, logs unexpected errors at `error` with the request id, and returns a generic message for 5xx.
- [ ] **Step 4: Run** `npm test -w @forge/api` and `npm run typecheck -w @forge/api`. Expected: PASS.

---

### Task 4: Health endpoints and API entrypoint

**Files:**
- Create: `apps/api/src/routes/health.ts`, `apps/api/src/checks.ts`, `apps/api/src/main.ts`
- Test: `apps/api/src/routes/health.test.ts`, `apps/api/src/checks.integration.test.ts`

**Interfaces:**
- Consumes: `buildApp`, `ReadinessCheck` (Task 3); `createPool`, `migrationStatus`, `loadDotEnv` (Task 2); `healthLiveSchema`, `healthReadySchema` (Task 1).
- Produces:
  - `registerHealthRoutes(app: FastifyInstance, opts: { checks: ReadinessCheck[]; version: string; checkTimeoutMs?: number }): void` — `GET /health/live` → `200` `HealthLive`; `GET /health/ready` → runs every check concurrently, each bounded by `checkTimeoutMs` (default 2000) via `AbortSignal`; `200` with `status:'ok'` if all pass, else `503` with `status:'degraded'` and each failed check `{status:'failed', detail}` where `detail` is a fixed safe string (`timeout`, `unreachable`, `migrations pending`), never the raw error message
  - `databaseCheck(pool: Pool): ReadinessCheck` — `SELECT 1`
  - `migrationsCheck(pool: Pool): ReadinessCheck` — fails with detail `migrations pending` when `applied < expected`
  - `main.ts`: `loadDotEnv()`, `loadConfig`, pool, `buildApp`, `listen`, SIGINT/SIGTERM close the app and end the pool; a `ConfigError` prints its message to stderr and exits `1`

- [ ] **Step 1: Write the failing tests.** `health.test.ts` (fake checks, no DB): live returns `200` matching `healthLiveSchema`; ready with all checks passing → `200`, each check `ok` with `latencyMs`; one failing check → `503`, `status:'degraded'`, that check `failed` with a safe `detail`, others still `ok`; **a check that never resolves → `503` within the timeout** (use `checkTimeoutMs: 50`), `detail: 'timeout'`; a check that throws an error containing a connection string → response body does not contain the string. `checks.integration.test.ts` (uses `TEST_DATABASE_URL`): `databaseCheck` passes against the real DB; `migrationsCheck` fails before `runMigrations` and passes after; `databaseCheck` against a pool pointed at a closed port (`postgres://forge:forge@127.0.0.1:1/forge`) fails without hanging past the pool's connection timeout.
- [ ] **Step 2: Run** `npm test -w @forge/api`. Expected: new tests FAIL.
- [ ] **Step 3: Implement health routes, checks and `main.ts`.** `npm run dev -w @forge/api` runs `tsx watch src/main.ts`.
- [ ] **Step 4: Run** `npm test -w @forge/api`. Expected: PASS.
- [ ] **Step 5: Verify against the running stack.** With `db:start` and `db:migrate` done, start the API; `curl http://127.0.0.1:4000/health/ready` returns `200` with `database` and `migrations` both `ok`. Stop the database and call it again: expect `503` `degraded` returned promptly and a structured log line for the failure.

---

### Task 5: Web application shell and Overview

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/src/app/{layout,page,loading,error,not-found}.tsx`, `apps/web/src/app/globals.css`
- Create: `apps/web/src/lib/{nav,preferences,api}.ts`, `apps/web/src/components/shell/{app-shell,sidebar,topbar,breadcrumbs}.tsx`, `apps/web/src/components/status/{system-status,refresh-button}.tsx`
- Test: `apps/web/src/lib/nav.test.ts`, `apps/web/src/lib/preferences.test.ts`, `apps/web/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `healthReadySchema`, `HealthReady` from `@forge/shared`.
- Produces:
  - `NAV_ITEMS: NavItem[]` with `NavItem = { id: string; label: string; href: string; icon: LucideIcon; availability: 'available' | 'planned' }` containing the ten spec items (Overview, My Work, Projects, Tickets, Repositories, Code Reviews, Workflows, Activity, Notifications, Search); only Overview is `available`
  - `visibleNavItems(items?: NavItem[]): NavItem[]` — returns only `available` items
  - `readSidebarCollapsed(storage?: Pick<Storage,'getItem'>): boolean` and `writeSidebarCollapsed(value: boolean, storage?: Pick<Storage,'setItem'>): void` — key `forge.sidebar.collapsed`; reads treat anything other than the exact strings `"true"`/`"false"` as the default (`false`); both swallow storage exceptions
  - `fetchReadiness(baseUrl: string, fetchImpl?: typeof fetch): Promise<{ kind: 'ok'|'degraded'; body: HealthReady } | { kind: 'unreachable'; reason: string }>` — validates the body with `healthReadySchema`; a non-JSON or schema-invalid body, a network error or a 5s timeout yields `unreachable`, never throws
  - `<AppShell>` — collapsible sidebar (button with `aria-expanded`, keyboard operable, state persisted via preferences), top bar with a clearly labelled environment badge (`DEV` when `NODE_ENV!=='production'`), breadcrumbs, `<main>` landmark, skip-to-content link, `sonner` `<Toaster>`
  - Overview page: server component calling `fetchReadiness(process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000')`; renders a "System status" table (API, Database, Migrations) with status words plus icons (not colour alone), latency, and a Retry button (`router.refresh()` in a transition, success/failure toast) in the unreachable and degraded states

- [ ] **Step 1: Write the failing tests.**
  - `nav.test.ts`: `visibleNavItems()` returns exactly `[Overview]`; every visible item has an `href` starting with `/` and none is `#`; `NAV_ITEMS` contains all ten spec labels.
  - `preferences.test.ts`: reads `"true"` → `true`; `null`, `"yes"`, `"{"` and `""` → `false`; a storage whose `getItem` throws → `false`; `writeSidebarCollapsed` with a throwing `setItem` does not throw; write then read round-trips.
  - `api.test.ts` (fake `fetchImpl`): `200` valid body → `ok`; `503` valid degraded body → `degraded`; `200` with `{foo:1}` → `unreachable`; non-JSON body → `unreachable`; rejecting fetch → `unreachable`; a fetch that never resolves → `unreachable` after the timeout (use a short override).
- [ ] **Step 2: Run** `npm test -w @forge/web`. Expected: FAIL.
- [ ] **Step 3: Scaffold the app by hand** (not `create-next-app`, to keep the file set minimal): `next`, `react`, `react-dom`, `tailwindcss`, `@tailwindcss/postcss`, `lucide-react`, `sonner`; `transpilePackages: ['@forge/shared']`; scripts `dev` (`next dev -p 3000`), `build`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`). Implement the libs to the signatures above.
- [ ] **Step 4: Build the shell and Overview.** Invoke the `frontend-design` skill first and follow it: deep neutral dark palette as CSS variables under `:root` with `color-scheme: dark`; one restrained accent; compact information-dense layout; monospace for identifiers; visible focus rings; `prefers-reduced-motion` respected; works at 375 px width (sidebar becomes an overlay under 768 px). `loading.tsx` renders a skeleton of the status table; `error.tsx` offers a Retry button; `not-found.tsx` links back to Overview.
- [ ] **Step 5: Run** `npm test -w @forge/web`, `npm run typecheck -w @forge/web`, `npm run build -w @forge/web`. Expected: all succeed.
- [ ] **Step 6: Verify in a browser.** With db + API running, start the web app and use the Playwright browser tools to load `http://localhost:3000`: Overview shows API/Database/Migrations as OK; collapse the sidebar, reload, and confirm the collapsed state persisted; stop the API, reload, and confirm the unreachable state with a working Retry; take screenshots at desktop and 375 px width.

---

### Task 6: Orchestration, documentation and Stage 0 verification

**Files:**
- Modify: `package.json` (scripts `dev`, `db:start`, `db:migrate`, `db:reset`)
- Create: `README.md`, `docs/setup.md`, `docs/architecture.md`, `docs/testing.md`, `docs/known-limitations.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `npm run dev` starts API and web together (via `concurrently`, prefixed and coloured output); the database is started separately with `npm run db:start` because it is a long-lived process with its own data directory.

- [ ] **Step 1: Wire the root scripts** and confirm `npm run dev` starts both apps and stops both on Ctrl+C.
- [ ] **Step 2: Write the docs, each only describing what exists.** `README.md`: what Forge is, current stage, quick start (5 commands), repo map. `docs/setup.md`: prerequisites; the two Postgres paths (Docker Compose, `embedded-postgres`); `.env` setup; migrate; run; troubleshooting (port in use, stale `postmaster.pid` after a crash, `db:reset`, Windows firewall prompt, corrupted `.data`). `docs/architecture.md`: module boundaries, package consumption-as-source decision, the error contract, request-id policy, health semantics (liveness vs readiness), why embedded Postgres, why no browser→API path yet. `docs/testing.md`: commands, which tests need a database, how `TEST_DATABASE_URL` is used. `docs/known-limitations.md`: no auth yet, no worker, internal packages not pre-built (no production build for the API), embedded Postgres is dev-only, only Overview is routable, no CI.
- [ ] **Step 3: Clean-room reproduction.** From a fresh clone (copy of the working tree without `node_modules`, `.data`, `.env`, `.next`) follow `docs/setup.md` literally. Expected: install, `db:start`, `db:migrate`, `dev` all work with no undocumented step; fix the docs (or code) wherever they do not.
- [ ] **Step 4: Run the full gate** — `npm run check`. Expected: typecheck, lint, format:check and all test suites pass. Record the exact counts.
- [ ] **Step 5: Write the Stage 0 delivery report** (Part XIII §33 format) as the final message; list anything not verified.

---

## Roadmap (not planned in detail yet)

| Stage | Headline deliverable | Key decisions already made |
|---|---|---|
| 1 | Dev auth + account switcher, orgs, roles, tenant isolation | Server-side dev sessions behind `FORGE_DEV_AUTH=1`; refuses to boot with it when `NODE_ENV=production`; every tenant-owned table carries `organisation_id`; one authorization module, called from every route. Adds web→API `/api` rewrite so cookies are same-origin. |
| 2 | Projects, tickets, statuses, custom fields (JSONB validated against definitions), relationships, attachments, Kanban/list | Ticket numbering via per-project counter row locked in the creating transaction. |
| 3 | GitHub App integration, webhooks, repo/branch/commit sync, code viewer | Introduces `apps/worker` and the Postgres job table (`FOR UPDATE SKIP LOCKED`). Webhook deliveries stored before ack. |
| 4 | PRs, reviews, merge policy evaluation | Merge policy is a pure function over a synchronised snapshot; GitHub is authoritative for the merge outcome. |
| 5 | Workflow engine: model, planner/executor split, versioning, form + canvas editors, test mode | Planner returns intended actions without side effects; executor persists step state per action. |
| 6 | Search, command palette, notifications, audit log, templates | Audit events written in the same transaction as the change. |
| 7 | Commercial readiness: deployment, backup docs, rate limiting, retention | API gets a bundled production build. |

## Self-Review

- **Spec coverage (Stage 0):** structure/tooling (T1), database + migrations (T2), strict TS/lint/format/tests (T1), env validation (T3), structured logging (T3), centralised errors (T3), health checks (T4), app shell with collapsible nav, breadcrumbs, toasts, skeleton, error state (T5), setup docs and clean-room reproduction (T6). Acceptance: "frontend and backend communicate successfully" is verified in T5 Step 6; "clean setup can be reproduced" in T6 Step 3. Not in Stage 0 by design: worker app, auth, product tables.
- **Placeholder scan:** no TBDs; the only open-ended instructions are "read the `embedded-postgres` README for constructor options" and the `frontend-design` skill, both of which are deliberate lookups.
- **Type consistency:** `ReadinessCheck`/`AppDeps` defined in T3, consumed in T4; `healthReadySchema` defined in T1, consumed in T4 (server) and T5 (client); `migrationStatus` defined in T2, consumed in T4.
- **Proportion:** the plan is a fraction of the code it describes; test cases are listed with exact inputs because those inputs are the decisions.
