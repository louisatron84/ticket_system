# Architecture

This describes what exists at Stage 1. Later stages extend it; see `docs/superpowers/plans/` for
the staged plans.

## Shape

A TypeScript monorepo (npm workspaces) containing a modular monolith, not services.

```text
 browser ── same-origin /api proxy ─────────────┐
    │                                           ▼
    └──► apps/web (Next.js, :3000) ──server-side fetch──► apps/api (Fastify, :4000) ──► PostgreSQL (:54329)
                  │                                               │
                  └───────── @forge/shared (zod schemas) ─────────┘   @forge/db (Drizzle, migrations, seed)
```

The browser never talks to the API's own address. Its `/api/v1/*` (and, in development,
`/api/dev/*`) requests go to the web app, which proxies them to the API (`next.config.ts`
rewrites), so the session cookie is first-party and no CORS is needed. Server components call the
API directly and forward the cookie.

| Workspace         | Responsibility                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/api`        | HTTP API: config, errors, request ids, health, sessions, authorisation, org routes                                 |
| `apps/web`        | Application shell and pages; the `/api` proxy                                                                      |
| `packages/shared` | The wire contract: error body, health reports, permissions, roles, role-change rules, request and response schemas |
| `packages/db`     | Schema, migrations, pool and Drizzle client, seed and reset, test-database guard                                   |

Rules that keep the boundaries clean:

- Business logic does not live in presentation components. Display decisions are pure, unit-tested
  functions in `apps/web/src/lib` (navigation, which workspace is current, which roles to offer,
  how to word a status).
- Anything both sides must agree on is a zod schema in `@forge/shared`; the web client validates
  API responses with it rather than trusting their shape.
- Rules that decide what someone may do (`decideRoleChange`) are pure functions in `@forge/shared`.
  The API applies them authoritatively; the web app reuses them only to decide which options to show.
- The API never returns driver errors, stack traces or connection strings.

## Authentication and tenancy

- **Sessions** are server-side. The cookie holds a random token, the database holds its hash. See
  [security](security.md).
- **Tenant** = organisation (a "workspace" in the UI). A user belongs to any number of them, each
  through one role. A role is a set of permission keys defined in code.
- **One guard** (`orgAccess(permission)`) protects every `/api/v1/orgs/:orgId/...` route: `401`
  when not signed in, an identical `404` for a workspace you are not in (whether it exists or not),
  `403` when you lack the permission. Handlers use the organisation id from that guard, never from
  the URL or body.
- **Development sign-in** (account switcher) is a separate, flag-gated set of routes. See
  [development accounts](development-accounts.md).

## Web routes

| Route               | What it is                                                                       |
| ------------------- | -------------------------------------------------------------------------------- |
| `/`                 | A plain HTTP redirect to your default workspace (or sign-in, or `/no-workspace`) |
| `/login`            | Sign-in (development account list, or a "not configured" message)                |
| `/w/<slug>`         | Workspace overview: your role and permissions, plus system status                |
| `/w/<slug>/members` | Members and roles, with role editing for those allowed to                        |
| `/settings/profile` | Your details and preferences                                                     |

Everything except `/` and `/login` renders inside the application shell (`(app)` route group), which
redirects to `/login` when nobody is signed in. A workspace you are not in, and addresses that match
nothing, return a real `404`.

## Decisions

| Decision                                                            | Why                                                                                                     | Cost                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| npm workspaces, no pnpm                                             | Works with the Node install alone                                                                       | Slightly slower installs than pnpm                         |
| Internal packages are consumed as TypeScript source (no build step) | Simplest dev loop; Vitest, tsx and Next all transpile them                                              | The API has no production build yet (Stage 7)              |
| Fastify + zod instead of NestJS                                     | Smaller surface; modules are plain folders with explicit registration                                   | We own the conventions                                     |
| Drizzle ORM with generated SQL migrations                           | Typed queries, explicit reviewable migrations                                                           | Younger than Prisma/TypeORM                                |
| PostgreSQL via `embedded-postgres` for local dev                    | Real Postgres with no Docker; `docker-compose.yml` is the alternative                                   | Dev-only; extra npm package with a large binary            |
| Path-based workspaces (`/w/<slug>`)                                 | Shareable deep links and per-workspace isolation of anything cached; no hidden "active workspace" state | Every workspace page lives under that prefix               |
| Permissions are code, roles are data                                | New permissions need no migration; roles can later be edited per workspace                              | A permission key removed from code silently stops granting |
| Preferences stored on the server                                    | They follow the person and render on first paint                                                        | One small API call per change                              |
| Web and API bind to loopback                                        | A dev server must not be reachable from the LAN                                                         | Use `localhost`/`127.0.0.1` to reach them                  |
| uuid v7 primary keys                                                | Time-ordered, so indexes stay compact                                                                   | Needs PostgreSQL 18 (or an extension on older versions)    |

## Error contract

Every non-2xx response from the API has one shape (`apiErrorSchema` in `@forge/shared`):

```json
{ "error": { "code": "not_found", "message": "Not found.", "requestId": "…", "details": [] } }
```

`code` is one of a fixed list. Expected failures are thrown as `AppError(code, message, status)`;
anything else becomes `500 internal_error` with a generic message and is logged server-side with
the stack. Framework errors (malformed JSON `400`, body over 1 MiB `413`, wrong content type
`415`) are mapped to the same shape with fixed wording, because framework messages can echo
request content. A well-formed JSON body of the wrong shape is `422 validation_failed` with the
offending field paths in `details`.

## Request ids

Each request gets an id that appears in the `x-request-id` response header, in the error body and
in every log line for that request. A client may supply its own, but only if it matches
`[A-Za-z0-9._-]{8,128}`; anything else is replaced with a UUID so a client cannot forge log lines.

## Health

- `GET /health/live`: the process is up. Touches no dependency. Use for liveness probes.
- `GET /health/ready`: runs the database and migrations checks concurrently, each bounded to 2 s.
  `200` when all pass, `503` with `status: "degraded"` otherwise. Failure details are fixed
  strings (`timeout`, `unreachable`, `migrations pending`); raw driver errors are only logged.

The database pool listens for idle-client errors, so a Postgres restart does not crash the API, and
the pool reconnects on its own.

## Logging

Fastify's pino logger, JSON in production, one line per event in development. `authorization` and
`cookie` request headers and `set-cookie` response headers are redacted. When development sign-in
is on, the API logs a warning at startup saying so.

## Data

See [data model](data-model.md). Migrations are SQL files in `packages/db/migrations`, generated by
`npm run db:generate` and applied by `npm run db:migrate`; `/health/ready` compares the number
shipped with the number applied.
