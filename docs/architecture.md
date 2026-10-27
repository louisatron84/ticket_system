# Architecture

This describes what exists after Stage 2, Part A (projects, tickets, comments, the list and the
board). Later stages extend it; see `docs/superpowers/plans/` for the staged plans.

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

| Workspace         | Responsibility                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`        | HTTP API: config, errors, request ids, health, sessions, authorisation, org routes, tickets (`src/tickets`)                                           |
| `apps/web`        | Application shell and pages; the `/api` proxy                                                                                                         |
| `packages/shared` | The wire contract: error body, health reports, permissions, roles, role-change rules, request and response schemas, ticket rules and the list filters |
| `packages/db`     | Schema, migrations, pool and Drizzle client, seed and reset, test-database guard, ticket creation shared with the seed                                |

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

| Route                            | What it is                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `/`                              | A plain HTTP redirect to your default workspace (or sign-in, or `/no-workspace`) |
| `/login`                         | Sign-in (development account list, or a "not configured" message)                |
| `/w/<slug>`                      | Workspace overview: your role and permissions, plus system status                |
| `/w/<slug>/projects`             | The projects, and a dialog to create one                                         |
| `/w/<slug>/projects/<KEY>/board` | A project's Kanban board (the project's default page)                            |
| `/w/<slug>/projects/<KEY>/list`  | The project's tickets as a filterable list                                       |
| `/w/<slug>/tickets`              | Every ticket you can see, with filters and saved views (the List tab)            |
| `/w/<slug>/tickets/board`        | Every project's tickets on one Kanban board (the Board tab)                      |
| `/w/<slug>/tickets/new`          | The create-ticket form (`?project=KEY` preselects a project)                     |
| `/w/<slug>/tickets/<KEY-n>`      | One ticket: fields, description, comments and history                            |
| `/w/<slug>/members`              | Members and roles, with role editing for those allowed to                        |
| `/settings/profile`              | Your details and preferences                                                     |

Everything except `/` and `/login` renders inside the application shell (`(app)` route group), which
redirects to `/login` when nobody is signed in. A workspace you are not in, and addresses that match
nothing, return a real `404`. A project or ticket that does not exist **inside your own** workspace
shows the same not-found page but with status `200`: the page streams behind the workspace's
loading skeleton, so the status line is already sent. A project or ticket of a workspace you are
not in is a real `404`.

## Tickets

- **API.** Under `/api/v1/orgs/:orgId`: projects (`/projects`, `/projects/:key`,
  `/projects/:key/components`, `/projects/:key/tickets`, `/projects/:key/board`), tickets
  (`/tickets`, `/tickets/:key`, `/tickets/:key/comments`, `/tickets/:key/timeline`), the workspace
  board (`/board`), `/labels`,
  `/ticket-config` (types, priorities, labels, components in one call) and `/views`. Each route
  names its permission in the route table of [security](security.md#tickets-and-projects).
- **One filter definition.** `ticketFilterSchema` and `parseTicketFilters` in `@forge/shared` are
  the only parser of list filters. The API validates a query string with it; the web app reads and
  writes the page URL with it (`ticketFiltersToSearchParams`). The address bar is therefore the
  state of a list: a filtered list can be reloaded, bookmarked and sent to someone, and a saved view
  is just a stored filter set. An invalid filter in a link is reported and ignored by the screen,
  and refused with `422` by the API.
- **One implementation of ticket creation.** `createTicketRow` in `@forge/db` is used by the API's
  `createTicket` and by the demo seed, so demo tickets are numbered, labelled and logged exactly
  like real ones.
- **Allowed moves come from the server.** The ticket detail includes `allowedTransitions` for the
  ticket page's select; a board gets each project's statuses and transitions (a `Workflow`) and
  checks a drop against the ticket's own project (`canMoveTo` in `apps/web/src/lib/board.ts`). The
  API still checks every move.
- **The board** is one request: a column per active status, up to 50 tickets each, with the full
  count per column. It ignores paging and ignores the status filters (the columns are the statuses).
- **The Tickets board** (`GET /api/v1/orgs/:orgId/board`) is every project's board in one: a column
  per status **key**, so a column holds tickets of several projects. A column takes its name and
  category from the first project (by key) that has the key, and its place from the smallest
  position any project gives it, so a status only some projects have gets a column of its own. The
  response carries each project's workflow, and a card moves under its own project's workflow (a
  ticket of an archived project cannot be moved). Unlike a project's board, the project filter
  applies. Columns are identified by status key on both boards, so one `Board` component serves both.
- **Pagination** is by page number and page size (default 50, at most 100), with a total count.
- **Server components fetch, client components edit.** Pages load data on the server with the
  viewer's cookie; the interactive parts (editor, board, filter bar) call `/api` through the
  proxy and refresh the page on success.
- **Drag and drop** uses `@dnd-kit/core`, with pointer-within collision, a keyboard path of its own
  that skips columns that cannot take the card, and a "Move to" menu that needs no dragging.

## Everyday speed

The common actions take one or two keystrokes, and each is also a button. One shared module
(`apps/web/src/lib/ticket-actions.ts` and `components/tickets/use-ticket-actions.ts`) performs them,
so the ticket page, a board card, the list, the command menu and the shortcuts behave and word their
results the same way.

- **API.** `POST /tickets/:key/archive`, `/unarchive` (`tickets.edit`) and `/duplicate`
  (`tickets.create`, answers `201`); `POST /tickets/bulk` (`tickets.edit`, plus `tickets.assign`
  to set an assignee); `GET /workflows` (every project's statuses and transitions); the create body
  takes an optional `statusId` (any active status of the project). They reuse `updateTicket` and
  `createTicket`, so permissions, validation, history and the version rule live in one place.
- **Archived tickets are read-only.** Edits and comments answer `409` ("This ticket is archived.
  Unarchive it to change it.") until the ticket is unarchived. The ticket page shows a banner with
  Unarchive.
- **Bulk changes** take 1 to 100 keys. Each ticket is changed in its own transaction against its
  current version, and the answer lists every ticket's own result in the order asked; partial
  success is never hidden. `archived: false` unarchives before the other changes; `archived: true`
  archives after them.
- **Menus.** `components/tickets/action-menu.tsx` is the one menu shell (button, panel, Escape,
  focus return); `ticket-choices.tsx` holds the status, priority, assignee and label lists that a
  card's menu, the list's cells and the bulk bar all show.
- **Command menu and shortcuts.** `CommandMenuProvider` is mounted once per workspace (in
  `app/(app)/w/[slug]/layout.tsx`) and listens for Ctrl+K / Cmd+K. A page adds its own commands with
  `usePageCommands` (the ticket page adds that ticket's actions, saved through the page's editor).
  `KeyboardShortcuts` handles the single-key shortcuts listed in `lib/shortcuts.ts`; a key typed into
  a field is never a shortcut. `<html data-keyboard="ready">` and `data-page-commands="ready"` tell
  the browser tests the listeners are attached.

## Board settings per person

How a person likes their board (the **Display** menu) belongs to the person, not to the project.

- **Stored** in the person's existing preferences record (`user_preferences`), under two keys
  validated by `@forge/shared` (`board-display.ts`): `board` (which card fields show, density,
  heat on or off; the same on every board) and `boardColumns` (per project key: which status keys
  are hidden and in what order, at most 20 keys each and 100 projects). The Tickets board's column
  choice is a third key, `ticketsBoardColumns`, so hiding a column there hides it on no project's
  board, and the reverse. Statuses are named by key, so renaming a status changes nothing here.
- **Merged safely.** `PATCH /api/v1/me/preferences` merges inside Postgres in one statement: a
  change to one card field keeps the others, a change to one project's columns keeps the other
  projects', and a `null` entry forgets a project (`ticketsBoardColumns: null` forgets the Tickets
  board's choice). Two tabs saving at the same moment lose
  nothing (tested).
- **Rendered on the server.** The board page reads the saved settings with the viewer and renders
  with them, so there is no flash of the defaults. `BoardPrefsProvider` (client) then owns the
  state: a change applies at once and is saved; if the save fails the change is undone and the
  person is told.
- **One place decides what is on screen.** `arrangeColumns` (`apps/web/src/lib/board-columns.ts`)
  turns the project's columns plus the person's saved choice into the columns to show: every
  status exactly once, saved keys that no longer exist ignored, a status added since appended in
  workflow order, and nothing hidden except what the person hid (or Scrapped, when they have chosen
  nothing yet).
- **Hidden is only a view.** The board request still returns every status; hiding changes which
  are drawn. Drag and keyboard moves therefore skip hidden columns, while the card's "Move to" menu
  still lists them.

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
