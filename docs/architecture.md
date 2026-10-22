# Architecture

This describes what exists at Stage 0. Later stages extend it; see
`docs/superpowers/plans/` for the staged plan.

## Shape

A TypeScript monorepo (npm workspaces) containing a modular monolith, not services.

```text
 browser ──► apps/web (Next.js, :3000) ──server-side fetch──► apps/api (Fastify, :4000) ──► PostgreSQL (:54329)
                  │                                                │
                  └──────────── @forge/shared (zod schemas) ───────┘   @forge/db (Drizzle, migrations)
```

| Workspace         | Responsibility                                                                          |
| ----------------- | --------------------------------------------------------------------------------------- |
| `apps/api`        | HTTP API: config, error contract, request ids, health checks                            |
| `apps/web`        | Application shell and pages; talks to the API from the server only                      |
| `packages/shared` | The wire contract: error body, health reports, header names. No runtime deps beyond zod |
| `packages/db`     | Schema, migrations, pool and Drizzle client, migration status                           |

Rules that keep the boundaries clean:

- Business logic does not live in presentation components. The web app maps API results to display
  rows in `apps/web/src/lib/status.ts`, which is unit-tested; components only render.
- Anything both sides must agree on is a zod schema in `@forge/shared`, and the web client
  validates API responses with it rather than trusting their shape.
- The API never returns driver errors, stack traces or connection strings. See below.

## Decisions

| Decision                                                            | Why                                                                               | Cost                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| npm workspaces, no pnpm                                             | Works with the Node install alone                                                 | Slightly slower installs than pnpm              |
| Internal packages are consumed as TypeScript source (no build step) | Simplest dev loop; Vitest, tsx and Next all transpile them                        | The API has no production build yet (Stage 7)   |
| Fastify + zod instead of NestJS                                     | Smaller surface; modules are plain folders with explicit registration             | We own the conventions                          |
| Drizzle ORM with generated SQL migrations                           | Typed queries, explicit reviewable migrations                                     | Younger than Prisma/TypeORM                     |
| PostgreSQL via `embedded-postgres` for local dev                    | Real Postgres with no Docker; `docker-compose.yml` is the alternative             | Dev-only; extra npm package with a large binary |
| Web calls the API server-side only                                  | No CORS, no tokens in the browser, and it keeps cookie handling simple in Stage 1 | The browser cannot call the API directly yet    |
| Web and API bind to loopback                                        | A dev server must not be reachable from the LAN                                   | Use `localhost`/`127.0.0.1` to reach them       |

## Error contract

Every non-2xx response from the API has one shape (`apiErrorSchema` in `@forge/shared`):

```json
{ "error": { "code": "not_found", "message": "Not found.", "requestId": "…", "details": [] } }
```

`code` is one of a fixed list. Expected failures are thrown as `AppError(code, message, status)`;
anything else becomes `500 internal_error` with a generic message and is logged server-side with
the stack. Framework errors (bad JSON, body over 1 MiB, wrong content type) are mapped to the same
shape with fixed wording, because framework messages can echo request content.

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

Fastify's pino logger, JSON in production, pretty-printed in development. `authorization` and
`cookie` request headers and `set-cookie` response headers are redacted.

## Data

Only `system_metadata` exists. Product tables arrive from Stage 1. Migrations are SQL files in
`packages/db/migrations`, generated by `npm run db:generate` and applied by `npm run db:migrate`;
`/health/ready` compares the number shipped with the number applied.
