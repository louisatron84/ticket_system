# Forge Stage 2 — Ticketing Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People with the right role can create projects, create and edit tickets, move them through a project's workflow on a list or a Kanban board, discuss them, and see a full history — with every rule enforced by the API and every record kept inside its workspace.

**Architecture:** Projects belong to a workspace and own a set of statuses plus explicit allowed transitions. Tickets belong to a project, get a human key (`WEB-12`) from a per-project counter, and carry optimistic-concurrency versions. Types and priorities are per-workspace rows, not constants. Every change appends an event, which makes the history. Composite foreign keys make the database itself refuse cross-workspace and cross-project references. The web app adds Projects and Tickets pages, a filter bar whose state lives in the URL, saved views, a ticket page, and a board.

**Tech Stack:** As Stage 1, plus `@dnd-kit/core` for accessible drag and drop. Postgres `pg_trgm` for title search.

**Spec:** Product spec §5 (ticketing), §14 (permissions), §20 (data model), Part XI Stage 2. Earlier plans: Stage 0 and Stage 1 in this folder.

## Scope: Stage 2 is delivered in two parts

- **Part A (this plan, detailed):** projects, workflow statuses and transitions, tickets, priorities, types, labels, components, comments, history, list with filters and saved views, Kanban board.
- **Part B (outlined at the end, detailed when it starts):** custom fields, relationships and subtasks, attachments, administrator configuration screens, bulk operations, duplicate, archive and subscribe.

Part A is a coherent product you can use on its own, which is why it ships first.

## Decisions made here (the spec leaves them open)

- **Ticket keys are `<PROJECT>-<number>`.** Project keys are 2–10 characters, `A–Z` and digits, starting with a letter, unique per workspace and **immutable** (renaming would break every link and reference). Numbers come from a counter on the project row, incremented in the creating transaction, so concurrent creates never collide. Tickets are addressed by key in URLs and the API.
- **Types and priorities are per-workspace rows**, created with each workspace (and back-filled for existing ones). A priority has a `rank` (higher is more urgent) that defines sort order. Nothing is hard-coded in screens.
- **Statuses and transitions are per-project.** New projects copy a default template. A status belongs to one of three categories (not started, in progress, completed). A move is allowed only if an explicit transition exists. Moving into a completed category sets `completed_at`; moving out clears it.
- **Assignee and reporter must be members of the workspace**, enforced by a composite foreign key as well as in the API.
- **Concurrent edits are detected.** Updates carry the `version` the person was looking at; a mismatch is `409 conflict` and nothing is written.
- **Plain text only** in titles, descriptions and comments for now. Everything is rendered escaped. Rich text is a later, separate decision.
- **List pagination is offset-based** (`page`, `pageSize` up to 100) with a total. Cursor pagination is deferred until volumes justify it.
- **Filters live in the URL**, parsed and validated by one shared schema used by both the API and the web app.
- **Two new permissions:** `projects.manage` (create and configure projects) and `tickets.comment`. Developer and reviewer get `tickets.comment`; developer also needs nothing else new. System roles already stored in databases are corrected by a `syncSystemRoles` step that `db:migrate` runs, because roles keep copies of the permission lists.
- **Search:** title and key matching with a trigram index. Full-text search across everything is Stage 6.

## Global Constraints

- Everything from Stages 0 and 1 still applies (strict TS, shared error shape, 404-not-403 for foreign workspaces, no dead controls, no secrets in logs, loopback binding, no commits unless asked).
- Every ticket-domain query takes the workspace id from `orgAccess`, never from a URL parameter or body. Every id supplied by a client (type, priority, status, assignee, label, component, project) is verified to belong to the same workspace (and project where relevant) **before** use.
- Parameters are always bound, never concatenated into SQL, including filters and sorting. Sort keys are chosen from a fixed allow-list.
- Length limits: project key 2–10, project name 1–80, title 1–200, description ≤ 20,000, comment 1–10,000, label name 1–40, view name 1–80.
- Timestamps UTC; `due_date` is a calendar date, not a timestamp.
- Tenant-isolation tests are added for every new tenant-owned table.

## Review Focus

1. **Client-supplied ids from another workspace or project** (assignee, type, priority, status, label, component) → `422`, nothing written. (Tasks 5–6)
2. **Two simultaneous creates** get distinct numbers; **two simultaneous edits** of one ticket → one `200`, one `409`. (Task 5)
3. **Illegal status moves**: no such transition, a status of another project, an inactive status, same status. (Task 5)
4. **Odd ticket keys** in URLs and the API: `web-12`, `WEB-0`, `WEB-012`, `WEB-99999999999`, `WEB-`, `../x` → clean `404`, never `500`. (Tasks 1, 5)
5. **Hostile filters**: `pageSize=100000`, `page=-1`, unknown `sort`, SQL fragments in `q`, 500 repeated parameters, `assignee=me` for a user with no membership → `422` or empty results, never `500` or injection. (Tasks 1, 7)
6. **Hostile text**: markup in titles and comments (`<img onerror=…>`), 20,001-character descriptions, control characters, emoji and right-to-left text → rejected or stored verbatim and rendered as text. (Tasks 5, 6, 10)
7. **A read-only member on the board** has no drag handles, and a crafted status change returns `403`. (Tasks 5, 11)

---

## File Structure

```
packages/shared/src/tickets.ts          keys, status template, bodies, summary/detail/list/board schemas
packages/shared/src/ticket-filters.ts   filter schema + URL codec (shared by API and web)
packages/shared/src/ticket-events.ts    event schema + describeTicketEvent
packages/db/src/schema.ts               + projects, ticket_types, priorities, project_statuses,
                                          status_transitions, tickets, labels, ticket_labels,
                                          components, ticket_comments, ticket_events, saved_views
packages/db/src/defaults.ts             ensureOrganisationDefaults, createProject, syncSystemRoles
packages/db/src/seed.ts                 + demo projects, labels and tickets
apps/api/src/tickets/                   service.ts (create/update/transition), query.ts (list/board), events.ts
apps/api/src/routes/                    projects.ts, tickets.ts, comments.ts, labels.ts, views.ts
apps/web/src/app/(app)/w/[slug]/        projects/, tickets/ (list, new, [ticketKey])
apps/web/src/components/tickets/        filter-bar, ticket-table, ticket-form, comments, timeline, badges
apps/web/src/components/board/          board, column, card
tests/e2e/                              projects.spec.ts, tickets.spec.ts, board.spec.ts
docs/                                   data-model, workflows (new), architecture, testing, limitations
```

---

# Part A

### Task 1: Shared ticket domain (`@forge/shared`)

**Files:** Create `packages/shared/src/tickets.ts`, `ticket-filters.ts`, `ticket-events.ts`; Modify `permissions.ts`, `index.ts`; Test `tickets.test.ts`, `ticket-filters.test.ts`, `ticket-events.test.ts`, extend `permissions.test.ts`.

**Interfaces — Produces:**
- Permissions: add `projects.manage` and `tickets.comment` to `PERMISSIONS`. Owner and admin hold every permission; developer and reviewer gain `tickets.comment`; read-only is unchanged.
- `PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/`; `formatTicketKey(projectKey: string, number: number): string`; `parseTicketKey(input: string): { projectKey: string; number: number } | null` — case-insensitive, returns the upper-cased key, `null` for a missing or zero number, leading zeros, more than 9 digits, empty parts or any character outside `A–Z0–9-`.
- `STATUS_CATEGORIES = ['not_started','in_progress','completed']`.
- `DEFAULT_TICKET_TYPES`: task, bug, feature, improvement, epic, documentation, support (each `{key,name,sortOrder}`). `DEFAULT_PRIORITIES`: lowest(1), low(2), normal(3), high(4), critical(5) as `{key,name,rank}`.
- `DEFAULT_STATUS_TEMPLATE: { statuses: {key,name,category,initial?:true}[]; transitions: [fromKey,toKey][] }` with Backlog (initial, not started), Open (not started), In Progress, In Review, Blocked (in progress), Done, Cancelled (completed). Transitions: Backlog→Open|Cancelled; Open→In Progress|Blocked|Backlog|Cancelled; In Progress→In Review|Blocked|Open|Done|Cancelled; In Review→In Progress|Done|Blocked|Cancelled; Blocked→Open|In Progress|Cancelled; Done→Open; Cancelled→Backlog|Open.
- `LABEL_COLORS = ['slate','blue','teal','green','amber','orange','red','violet']`.
- Body schemas (all `strictObject`, text trimmed): `createProjectBodySchema {key, name, description?}`, `updateProjectBodySchema {name?, description?, archived?}` (at least one), `createTicketBodySchema {title, description?, typeId, priorityId, assigneeId?: uuid|null, componentId?: uuid|null, labelIds?: uuid[] (≤ 20), dueDate?: 'YYYY-MM-DD'|null, estimateMinutes?: int 0–99999|null}`, `updateTicketBodySchema` = the same fields all optional plus `statusId?` and a **required** `version: int ≥ 1`, with at least one change besides `version`, `commentBodySchema {body}`, `createLabelBodySchema {name, color}`, `saveViewBodySchema {name, scope: 'personal'|'shared', definition: {filters, display: 'list'|'board'}}`.
- Response schemas: `projectSchema`, `statusSchema {id,key,name,category,sortOrder,initial}`, `ticketSummarySchema`, `ticketDetailSchema` (summary + description, reporter, component, estimateMinutes, version, completedAt, archivedAt, `allowedTransitions: Status[]`), `ticketListSchema {items,total,page,pageSize}`, `boardSchema {columns: {status, total, tickets}[]}`, `commentSchema`, `timelineItemSchema`, `ticketConfigSchema {types, priorities, labels, components}`, `savedViewSchema`.
- `ticketFilterSchema` (strict, API side) with: `q` (≤ 100), `project[]` (project keys), `statusKey[]`, `statusCategory[]`, `type[]` (keys), `priority[]` (keys), `assignee[]` (uuid | `me` | `none`), `reporter[]` (uuid | `me`), `label[]` (names), `due` (`overdue|today|week|none`), `archived` (bool), `sort` (`updated|created|priority|due|key`), `dir` (`asc|desc`), `page` (1–10,000), `pageSize` (1–100); each array ≤ 20 items. `parseTicketFilters(input: Record<string, string | string[] | undefined>): { ok: true; filters: TicketFilters } | { ok: false; issues: string[] }` applies defaults (`sort=updated`, `dir=desc`, `page=1`, `pageSize=50`); `ticketFiltersToSearchParams(filters): URLSearchParams` omits defaults and round-trips.
- Events: `TicketEvent` union `{type: 'ticket.created' | 'ticket.updated' | 'ticket.status_changed' | 'comment.added' | 'comment.edited' | 'comment.deleted' | 'labels.changed', data}` with names stored as snapshots; `describeTicketEvent(event, actorName): string` e.g. "Dana moved this from In Progress to In Review".

- [ ] **Step 1: Write failing tests.**
  - `tickets.test.ts`: `parseTicketKey` accepts `WEB-12`, `web-12`, ` WEB-12 ` is rejected (no trimming), and returns `null` for `WEB-0`, `WEB-012`, `WEB-`, `-12`, `WEB`, `WEB-1234567890`, `WEB-1.5`, `W-1-2`, `../x`, `` and a 5,000-character string; `formatTicketKey('WEB', 7)` is `WEB-7`; the default template has exactly one initial status, every transition names existing statuses, no self-transitions and no duplicates, and every status is reachable from the initial status; `createProjectBodySchema` rejects keys `a1`, `A`, `ABCDEFGHIJK`, `1AB`, `AB-C`, `AB C`; `createTicketBodySchema` rejects a 201-character title, a blank title, a 20,001-character description, a non-uuid type, 21 labels, `dueDate: '2026-13-40'` and `'2026-02-30'`, and accepts the longest valid values; `updateTicketBodySchema` rejects a body with only `version`, a missing `version`, `version: 0`, and unknown keys such as `key` and `reporterId`.
  - `ticket-filters.test.ts`: defaults; every field round-trips through `ticketFiltersToSearchParams` → `parseTicketFilters`; repeated parameters (`status=a&status=b`) become arrays; invalid inputs each return `ok: false` with a readable issue: `pageSize=101`, `pageSize=0`, `page=0`, `page=abc`, `sort=password`, `dir=sideways`, `due=yesterday`, `assignee=not-a-uuid`, 21 values, `q` of 101 characters; `q="'; DROP TABLE tickets;--"` is **accepted verbatim** (it is only ever a bound parameter) and survives the round trip; unknown parameters are ignored, not errors; defaults are omitted from the search params.
  - `ticket-events.test.ts`: `describeTicketEvent` for each type, including a status change, a priority change, assignment and unassignment, labels added and removed, and a creation; a name containing `<script>` is returned verbatim (escaping is the renderer's job).
  - `permissions.test.ts`: `projects.manage` held by owner and admin only; `tickets.comment` held by developer and reviewer but not read-only; read-only unchanged at three permissions.
- [ ] **Step 2: Run** `npm test -w @forge/shared`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules; re-export from `index.ts`.
- [ ] **Step 4: Run** `npm test -w @forge/shared`, typecheck. Expected: PASS.

---

### Task 2: Ticketing schema, defaults and role sync

**Files:** Modify `packages/db/src/schema.ts`, `organisations.ts`, `migrate.ts`, `index.ts`; Create `packages/db/src/defaults.ts`, `packages/db/migrations/0002_*.sql` (generated), a `pg_trgm` extension line added to that migration by hand; Test `packages/db/src/tickets-schema.test.ts`, `defaults.test.ts`.

**Interfaces — Produces:** tables (uuid v7 keys, UTC, `ON DELETE RESTRICT`) —
- `projects`: `organisationId`, `key`, `name`, `description`, `nextTicketNumber int default 1`, `archivedAt`, `createdBy`, `createdAt`; unique `(organisationId,key)` and `(organisationId,id)`; check on `key` pattern.
- `ticketTypes`: `organisationId`, `key`, `name`, `sortOrder`, `isActive`; unique `(org,key)`, `(org,id)`. `priorities`: `organisationId`, `key`, `name`, `rank`, `isActive`; unique `(org,key)`, `(org,id)`.
- `projectStatuses`: `organisationId`, `projectId`, `key`, `name`, `category` (check in the three), `sortOrder`, `isInitial`, `isActive`; unique `(project,key)`, `(org,project,id)`; composite FK `(org,project)`→projects; at most one initial per project (partial unique index).
- `statusTransitions`: `organisationId`, `projectId`, `fromStatusId`, `toStatusId`; unique `(project,from,to)`; **composite FKs** `(org,project,from)` and `(org,project,to)` → `projectStatuses(org,project,id)`; check `from <> to`.
- `tickets`: `organisationId`, `projectId`, `number`, `key` (text), `title`, `description`, `typeId`, `statusId`, `priorityId`, `assigneeId?`, `reporterId`, `componentId?`, `dueDate date?`, `estimateMinutes int?`, `version int default 1`, `completedAt?`, `archivedAt?`, `createdAt`, `updatedAt`; unique `(org,key)`, `(project,number)`, `(org,id)`; composite FKs: `(org,project)`→projects, `(org,project,statusId)`→projectStatuses, `(org,typeId)`→ticketTypes, `(org,priorityId)`→priorities, `(org,assigneeId)` and `(org,reporterId)`→`organisationMemberships(organisation_id,user_id)`, `(org,project,componentId)`→components; checks on title length and `version ≥ 1`; indexes on `(org,project,statusId)`, `(org,assigneeId)`, `(org,updatedAt desc)`, `(org,dueDate)`, and a `pg_trgm` GIN index on `lower(title)`.
- `labels`: `organisationId`, `name`, `color` (check in `LABEL_COLORS`); unique `(org, lower(name))`, `(org,id)`. `ticketLabels`: PK `(ticketId,labelId)`, composite FKs `(org,ticketId)` and `(org,labelId)`.
- `components`: `organisationId`, `projectId`, `name`; unique `(project, lower(name))`; unique `(org,project,id)`.
- `ticketComments`: `organisationId`, `ticketId` (composite FK), `authorId`→users, `body`, `createdAt`, `editedAt?`.
- `ticketEvents`: `organisationId`, `ticketId` (composite FK), `actorUserId?`, `source` (`user|system`), `type`, `data jsonb`, `createdAt`; index `(ticketId,createdAt)`.
- `savedViews`: `organisationId`, `ownerUserId`, `name`, `scope` (`personal|shared`), `definition jsonb`, timestamps; unique `(org, owner, lower(name))` for personal views.
- `ensureOrganisationDefaults(executor, organisationId): Promise<void>` inserts any missing default ticket types and priorities (by key; never overwrites). `createProject(executor, input: { organisationId; key; name; description?; createdBy }): Promise<{ projectId: string }>` inserts the project and copies `DEFAULT_STATUS_TEMPLATE` (statuses and transitions) in one go. `syncSystemRoles(db: Db): Promise<number>` sets the permissions of every `is_system` role to the code definition and returns how many rows changed. `createOrganisationWithSystemRoles` additionally calls `ensureOrganisationDefaults`. The `db:migrate` CLI runs `syncSystemRoles` and, for every organisation, `ensureOrganisationDefaults` after applying migrations, and prints what it changed.

- [ ] **Step 1: Write failing tests.**
  - `tickets-schema.test.ts` (real DB; truncate between tests): a ticket whose `statusId` belongs to **another project** is rejected (FK); a ticket whose `typeId`/`priorityId` belongs to another workspace is rejected; an `assigneeId` who is not a member of the workspace is rejected (FK), and a member of another workspace too; a `componentId` from another project is rejected; `ticketLabels` rejects a label from another workspace; a transition whose `to` status is in another project is rejected, as is `from = to`; two initial statuses in one project are rejected; duplicate ticket `number` in a project and duplicate `key` in a workspace are rejected; project key `a1` and `ABCDEFGHIJK` rejected; label names differing only by case are rejected; a label colour outside the list is rejected; title of 0 and 201 characters rejected; deleting a project, user or status in use is refused (`23001`); `uuidv7` defaults.
  - `defaults.test.ts`: `createOrganisationWithSystemRoles` yields 7 types and 5 priorities; `ensureOrganisationDefaults` is idempotent and does **not** overwrite a renamed type; `createProject` yields 7 statuses, exactly one initial (`backlog`), and the template's transitions with the right ids; `syncSystemRoles` fixes a role whose permissions were left stale (set `developer` back to the Stage 1 list, run it, expect `tickets.comment` present) and returns `0` when nothing differs; custom (non-system) roles are untouched.
- [ ] **Step 2: Run** `npm test -w @forge/db`. Expected: FAIL.
- [ ] **Step 3: Implement** schema, helpers; `npm run db:generate`; read the SQL (composite FKs, checks, indexes), add `CREATE EXTENSION IF NOT EXISTS pg_trgm;` at the top; `npm run db:migrate`.
- [ ] **Step 4: Run** `npm test -w @forge/db` and typecheck. Expected: PASS.

---

### Task 3: Demo data

**Files:** Modify `packages/db/src/seed.ts`; Test `packages/db/src/seed.test.ts` (extend).

**Interfaces — Produces:** the seed also creates, for Acme: projects `WEB` ("Web App") and `API` ("Platform API"), labels (`bug`, `frontend`, `backend`, `docs`, `security`, `performance`), components, and 12 + 8 tickets spread across every status, all five priorities and several types, with a mix of assignees (developer, reviewer, admin, unassigned), due dates (some overdue, some upcoming), labels, 5 comments on 3 tickets and the matching history events (created, status changes). For Northwind: project `OPS` with 4 tickets. Reporters are real members. `DEV_IDENTITIES` is unchanged. Ticket creation in the seed goes through the same `createTicketRow` helper the API uses, so counters and events are right. (`createTicketRow(executor, input)` is exported from `@forge/db`.)

- [ ] **Step 1: Extend the seed tests (failing):** after `reseedDevelopmentData`: 3 projects; WEB has 12 tickets numbered `WEB-1..WEB-12` with no gaps and `nextTicketNumber = 13`; every status of WEB has at least one ticket; at least two tickets overdue (`dueDate` before today and category not completed), at least two unassigned; tickets in `Done` have `completedAt` set and others do not; every assignee is a member of that ticket's workspace; no Acme ticket references a Northwind label or user; every ticket has a `ticket.created` event; reseeding twice gives identical counts.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS); then `npm run db:reseed` on the dev database.

---

### Task 4: API — projects and ticket configuration

**Files:** Create `apps/api/src/routes/projects.ts`; Modify `apps/api/src/app.ts`; Test `apps/api/src/routes/projects.test.ts`.

**Interfaces — Produces** (all under `/api/v1/orgs/:orgId`, via `orgAccess`):
- `GET /projects` (`tickets.view`) → `Project[]` (active first, then archived; each with `{id,key,name,description,archived,ticketCount,openCount}`).
- `POST /projects` (`projects.manage`) body `createProjectBodySchema` → `201 Project`; duplicate key → `409 conflict` (message names the key); creates the default statuses and transitions; audit event.
- `GET /projects/:key` (`tickets.view`) → `Project & { statuses: Status[]; transitions: { fromStatusId; toStatusId }[]; components }`; unknown key (any case) → `404`.
- `PATCH /projects/:key` (`projects.manage`) body `updateProjectBodySchema`; the key is not editable (unknown field → `422`); archiving a project hides it from the default list and rejects new tickets in it.
- `GET /ticket-config` (`tickets.view`) → `{ types, priorities, labels, components }` (active ones, ordered).

- [ ] **Step 1: Write failing tests** (real DB, seeded): permission matrix over owner, admin (`200/201`), developer, reviewer, readonly (read `200`, create `403`), restricted (`403`), other-owner (`404`), unauthenticated (`401`); the foreign-workspace 404s are identical to unknown-id 404s; project list contains only that workspace's projects and counts match the seed; creating `OPS2` yields 7 statuses with one initial and the template transitions and an audit row (`project.created`); creating `WEB` again → `409`; `web` (lowercase) key in the body → `422`; `GET /projects/web` finds `WEB` (case-insensitive lookup) while `GET /projects/WEB-1` and `GET /projects/..` → `404`; `PATCH` with `key` in the body → `422`; archiving then creating a ticket in it is covered in Task 5; `GET /ticket-config` returns 7 types, 5 priorities ordered by rank, and only this workspace's labels.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).

---

### Task 5: API — creating, reading and updating tickets

**Files:** Create `apps/api/src/tickets/service.ts`, `apps/api/src/tickets/events.ts`, `apps/api/src/routes/tickets.ts`; Modify `app.ts`; Test `apps/api/src/tickets/service.test.ts`, `apps/api/src/routes/tickets.test.ts`, `apps/api/src/routes/tickets.concurrency.test.ts`.

**Interfaces — Produces:**
- `POST /orgs/:orgId/projects/:key/tickets` (`tickets.create`; also `tickets.assign` if `assigneeId` is set) body `createTicketBodySchema` → `201 TicketDetail`. The reporter is the caller; the status is the project's initial status; the number comes from the counter via `UPDATE projects SET next_ticket_number = next_ticket_number + 1 ... RETURNING` in the same transaction; a `ticket.created` event is written. Any id belonging to another workspace or project (type, priority, assignee not a member, label, component) → `422` naming the field. Archived project → `409`.
- `GET /orgs/:orgId/tickets/:ticketKey` (`tickets.view`) → `TicketDetail` including `allowedTransitions` (from the project's transitions, active statuses only); malformed or unknown key → `404`.
- `PATCH /orgs/:orgId/tickets/:ticketKey` (`tickets.edit`; changing `assigneeId` additionally needs `tickets.assign`) body `updateTicketBodySchema`; in one transaction: lock the ticket row, compare `version` (mismatch → `409 conflict`), validate every supplied id as above, validate a `statusId` change against the transitions table (no transition, inactive status, another project's status, same status → `422` "That move isn't allowed from <from>"), apply, bump `version` and `updatedAt`, set or clear `completedAt` by the new status's category, write one `ticket.updated` event listing changed fields (and a `ticket.status_changed` event for a status move) and one `labels.changed` when labels differ. A no-op patch (same values) changes nothing and writes no event.
- Service functions used by the seed and later stages: `createTicket(executor, input)`, `updateTicket(executor, input)` returning `{ ticket, events }`.

- [ ] **Step 1: Write failing tests.**
  - `service.test.ts`: create → key `WEB-13` after the seed, counter incremented, initial status, reporter is the actor, `ticket.created` event; update diff produces exactly the changed fields with before and after snapshots (priority by name, assignee by display name); moving into Done sets `completedAt`, moving out clears it; a patch that changes nothing writes no event and does not bump `version`.
  - `tickets.test.ts` (real DB, API-level): **matrix** — owner/admin/developer create `201`; reviewer/readonly/restricted create `403`; other-owner `404`; unauthenticated `401`; a developer without `tickets.assign` (use a custom role created in the test) can create unassigned but gets `403` when setting `assigneeId`; reads `200` for owner…readonly, `403` restricted, `404` other-owner. **Cross-tenant ids** (each its own case, each leaves the row count unchanged): a Northwind type, a Northwind priority, Nora as assignee, a Northwind label, a component of project `API` used on a `WEB` ticket → `422` with the offending field name in `details`. **Transitions:** Backlog→Done `422`; Open→In Progress `200`; In Progress→In Review→Done `200`; Done→Open `200` and clears `completedAt`; same status `422`; a status id from project `API` `422`; a deactivated status `422`; unknown status id `422`. **Staleness:** patch with an old `version` → `409` and the row unchanged. **Mass assignment:** body with `key`, `reporterId`, `number`, `projectId`, `organisationId`, `completedAt` → `422`, nothing changed. **Hostile text:** title `<img src=x onerror=alert(1)>` stored verbatim and returned verbatim; 201-character title `422`; 20,001-character description `422`; a title of only whitespace `422`; emoji and right-to-left text round-trip. **Keys:** `web-1` → same ticket as `WEB-1`; `WEB-0`, `WEB-012`, `WEB-99999999999`, `WEB-`, `..%2Fx` → `404`; a ticket key of another workspace → `404` identical to a missing one. **Read-only cannot move a ticket by API** → `403`. Audit/history: each successful update has exactly the expected event types.
  - `tickets.concurrency.test.ts`: 20 simultaneous creates in one project yield 20 distinct consecutive numbers; two simultaneous `PATCH`es with the same `version` → exactly one `200` and one `409`; repeat 10 times.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS). Mutation check: remove the version comparison and confirm the concurrency test fails.

---

### Task 6: API — comments, history, labels and components

**Files:** Create `apps/api/src/routes/comments.ts`, `labels.ts`; Test `comments.test.ts`, `labels.test.ts`.

**Interfaces — Produces:**
- `GET /orgs/:orgId/tickets/:ticketKey/timeline` (`tickets.view`) → `TimelineItem[]` ordered oldest first: system events and comments in one list; comment items include `{id, author, body, createdAt, editedAt}` and carry `kind: 'comment'`; system items carry `kind: 'event'` and the event.
- `POST …/comments` (`tickets.comment`) body `commentBodySchema` → `201`; `PATCH …/comments/:commentId` (author only, and still `tickets.comment`) sets `editedAt`; `DELETE …/comments/:commentId` (author, or `tickets.edit`) → `204`; each writes its event (`comment.added|edited|deleted`).
- `POST /orgs/:orgId/labels` (`tickets.edit`) body `createLabelBodySchema` → `201`, duplicate name (case-insensitive) → `409`; labels are listed by `GET /ticket-config`.
- `POST /orgs/:orgId/projects/:key/components` (`projects.manage`) → `201`.

- [ ] **Step 1: Write failing tests:** matrix for comment create (developer and reviewer `201`, readonly and restricted `403`, other-owner `404`); the timeline shows system and user items distinguished by `kind`, in order, with the seeded events; editing someone else's comment `403`, own comment `200` with `editedAt`; the author and a holder of `tickets.edit` can delete, another reviewer cannot; empty and 10,001-character comment `422`; comment markup returned verbatim; a comment on a foreign workspace's ticket → `404` and no row; comment ids from another ticket in the URL → `404`; label duplicate by case `409`; colour outside the list `422`; a reviewer cannot create labels `403`.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).

---

### Task 7: API — list, filters, board and saved views

**Files:** Create `apps/api/src/tickets/query.ts`, `apps/api/src/routes/views.ts`; Modify `routes/tickets.ts`; Test `apps/api/src/tickets/query.test.ts`, `apps/api/src/routes/ticket-list.test.ts`, `apps/api/src/routes/views.test.ts`.

**Interfaces — Produces:**
- `GET /orgs/:orgId/tickets` (`tickets.view`): query string parsed by `parseTicketFilters`; invalid → `422` with the issues; returns `TicketList`. `assignee=me` resolves to the caller, `assignee=none` to unassigned; `reporter=me` likewise; `label` matches by name (all supplied labels must be present); `due=overdue` = due before today and status category not completed; `statusCategory`/`statusKey`/`project`/`type`/`priority` match by key; `q` matches the key prefix exactly or `lower(title) LIKE %q%` (with `%`, `_` and `\` escaped); archived tickets are excluded unless `archived=true`. Sorting uses a fixed map (`priority` sorts by the priority's rank), always with `id` as a tie-breaker; never builds SQL from the input.
- `GET /orgs/:orgId/projects/:key/board` (`tickets.view`) → `Board`: one column per **active** status in `sortOrder`, each `{ status, total, tickets }` with at most 50 tickets (same filters apply, except status ones).
- `GET/POST/PATCH/DELETE /orgs/:orgId/views` (`tickets.view` to read and to manage your own personal views; creating or editing a **shared** view needs `projects.manage`). Personal views are visible only to their owner; shared ones to everyone with `tickets.view`. A view's `definition` is validated with `ticketFilterSchema`.

- [ ] **Step 1: Write failing tests** (real DB, seeded counts known): each filter alone returns exactly the expected seed tickets (status key, category, type, priority, assignee id, `me`, `none`, reporter, label, two labels, `overdue`, project, `q` by key `web-3` and by title fragment); combinations intersect; each sort in both directions is ordered and stable across pages; `pageSize=5` pagination covers all tickets exactly once with correct `total`; `pageSize=101`, `page=0`, `sort=password`, `dir=x`, `assignee=nope`, 21 repeated labels → `422`, never `500`; **hostile `q`**: `'; DROP TABLE tickets;--`, `%`, `_`, `\`, 100 characters of `%`, a NUL character → results are correct (a lone `%` matches only titles containing a literal `%`) and the `tickets` table is intact; `assignee=me` for a member with no tickets returns an empty list; tickets of other workspaces never appear, whatever filters are used, for every identity (matrix over the seven identities); board: columns equal the project's active statuses in order, totals add up, at most 50 per column, an inactive status has no column, and a filter narrows every column. Views: personal view hidden from others, shared view visible to others but only editable with `projects.manage`, a read-only member can keep personal views, name uniqueness per owner, a view with an invalid definition `422`, another workspace's view id → `404`, deleting someone else's personal view `404`.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS). Also run `EXPLAIN` once by hand on the list query with the seeded data and record that the title search uses the trigram index when the table is large (note in docs, not a test).

---

### Task 8: Web — foundations, projects list and project creation

**Files:** Create `apps/web/src/lib/tickets.ts` (pure display helpers), `apps/web/src/components/tickets/{badges,user-chip,label-chip,empty-state}.tsx`, `apps/web/src/app/(app)/w/[slug]/projects/page.tsx`, `.../projects/[key]/layout.tsx`, `.../projects/[key]/page.tsx` (redirect to board), `apps/web/src/components/projects/create-project-dialog.tsx`; Modify `lib/nav.ts`, `lib/nav.test.ts`; Test `lib/tickets.test.ts`.

**Interfaces — Produces:** nav items **Projects** (`/projects`, requires `tickets.view`) and **Tickets** (`/tickets`, same) become `available`; `breadcrumbsFor` knows projects, a project, tickets and a ticket. `statusTone(category): 'idle'|'active'|'done'`, `priorityIntensity(rank, maxRank)`, `formatDueDate(date, today): { text: string; overdue: boolean }` (today / tomorrow / "in 3 days" / "2 days overdue" / absolute date), `initials(name)`. Badges always show text plus an icon or shape, never colour alone. The projects page lists projects with counts, an empty state that explains how to create one (only for `projects.manage`; others see "No projects yet. Ask an owner or administrator"), and a create dialog (key auto-suggested from the name, uppercased, validated live, API errors shown inline with the message the API gives).

- [ ] **Step 1: Write failing tests:** nav shows Projects and Tickets for `tickets.view` and hides them without it (update the Stage 1 expectations that listed only Overview and Members); breadcrumbs for the new routes; `formatDueDate` for today, tomorrow, +3, −1, −30, a far-future date and a date in another year, all computed against an injected "today"; `statusTone` for each category; key suggestion helper (`"Web App"` → `WA`, `"Platform API"` → `PA`, `"x"` → `XX`, non-letters stripped, never longer than 10).
- [ ] **Step 2–4:** run (FAIL) → implement → run unit tests, typecheck, build (PASS). **Step 5:** browser check as Owner (create a project) and as Read-only (no create button).

---

### Task 9: Web — ticket list, filter bar and saved views

**Files:** Create `apps/web/src/app/(app)/w/[slug]/tickets/page.tsx`, `apps/web/src/components/tickets/{filter-bar,ticket-table,saved-views}.tsx`, `apps/web/src/lib/ticket-query.ts`; Test `lib/ticket-query.test.ts`.

**Interfaces — Produces:** a server-rendered list at `/w/<slug>/tickets` and `/w/<slug>/projects/<key>/list` driven by the **URL** (`parseTicketFilters`): changing a filter navigates (no hidden client state), so the back button, reload and sharing work. The table shows key (mono), title, status, priority, assignee, due, labels; sortable column headers (`aria-sort`); pagination with total; a filter bar for text, status category, priority, type, assignee (including "Me" and "Unassigned"), label and "Overdue"; an active-filter summary with a "Clear" action; empty states for "no tickets yet" and "no tickets match" (different copy). Saved views: a menu listing personal and shared views, "Save current view" (name, personal or, with `projects.manage`, shared), update and delete with confirmation. `ticketQueryFromSearchParams(sp)` falls back to defaults for bad input instead of throwing, and reports that it did so (a banner says "Some filters in the link were ignored").

- [ ] **Step 1: Write failing tests:** URL ↔ filters round trip through the helpers; garbage parameters (`?pageSize=100000&sort=x&status=%00`) yield safe defaults plus an `ignored` flag; toggling a filter resets `page` to 1; clearing removes only filter parameters and keeps `sort`.
- [ ] **Step 2–4:** run (FAIL) → implement → unit tests, typecheck, build (PASS). **Step 5:** browser check with the seeded data: filter by "Overdue", by "Me" as Developer, sort by priority, save and re-open a view, share one as Admin and see it as Reviewer.

---

### Task 10: Web — ticket page, creation, editing, comments and history

**Files:** Create `apps/web/src/app/(app)/w/[slug]/tickets/new/page.tsx`, `.../tickets/[ticketKey]/page.tsx`, `apps/web/src/components/tickets/{ticket-form,ticket-fields,comments,timeline}.tsx`, `apps/web/src/lib/timeline.ts`; Test `lib/timeline.test.ts`, `lib/ticket-form.test.ts`.

**Interfaces — Produces:** the ticket page shows key, title, description (plain text with preserved line breaks, escaped), a fields sidebar (status with only **allowed** next statuses, priority, type, assignee, labels, due date, estimate, component, reporter, created/updated), the timeline with comments and system events visually distinct (comments have an author avatar and body; events are one muted line each, from `describeTicketEvent`), and a comment box. Fields are editable only with `tickets.edit` (assignee also needs `tickets.assign`; the comment box needs `tickets.comment`); other people see values with no controls. Edits save per field on commit (select change or Enter/blur) with the ticket `version`; a `409` shows a banner "This ticket changed. Reload to see the latest" with a Reload button and keeps the person's unsaved input visible; other errors show the API message inline. The creation page (`/tickets/new?project=WEB`) validates as you type, preserves input on error, and redirects to the new ticket. `groupTimeline(items)` merges consecutive events by the same actor within five minutes into one line group.

- [ ] **Step 1: Write failing tests:** `groupTimeline` (merges same actor within five minutes, not different actors, not beyond five minutes, never merges comments), ordering stays oldest-first; form validation helpers (blank title, 201 characters, bad due date, estimate parsing `"90"`, `"1h 30m"`, `"1.5h"`, `"abc"`); allowed-transition options exclude the current status; field editability by permission matrix.
- [ ] **Step 2–4:** run (FAIL) → implement → unit tests, typecheck, build (PASS). **Step 5:** browser check: create, edit each field, move through allowed statuses, comment, see history; open the same ticket in two tabs and trigger the conflict banner.

---

### Task 11: Web — Kanban board

**Files:** Create `apps/web/src/app/(app)/w/[slug]/projects/[key]/board/page.tsx`, `.../projects/[key]/list/page.tsx`, `apps/web/src/components/board/{board,column,card}.tsx`, `apps/web/src/components/projects/project-tabs.tsx`, `apps/web/src/lib/board.ts`; `npm install @dnd-kit/core -w @forge/web`; Test `lib/board.test.ts`.

**Interfaces — Produces:** the project page has Board and List tabs and shares the same filter bar. Columns follow the project's active statuses; each shows a count (and "showing 50 of N" when truncated). Cards show key, title, priority, assignee, due date and labels, and link to the ticket. People with `tickets.edit` can drag a card to another column **or** use the card's "Move to…" menu (keyboard and screen-reader path; dnd-kit's keyboard sensor is enabled too). Columns that the ticket cannot move to under the transition rules are marked as not droppable and say why on hover or focus. A move is optimistic and reverted with a message if the API refuses (`422`, `403`, `409`). People without `tickets.edit` get no drag handles and no menu. `nextBoardState(board, ticketId, toStatusId)` is a pure function used for the optimistic update; `canDrop(allowedTransitions, toStatusId)` decides droppability.

- [ ] **Step 1: Write failing tests:** `nextBoardState` moves a card between columns, updates both counts, leaves other columns untouched, ignores a ticket that is not on the board, and is a no-op for the same column; `canDrop` follows the transitions; a rejected move restores the previous state (reducer test).
- [ ] **Step 2–4:** run (FAIL) → implement → unit tests, typecheck, build (PASS). **Step 5:** browser check: drag with the mouse, move with the keyboard, attempt an illegal move, load the board as Read-only.

---

### Task 12: End-to-end tests, docs and Part A verification

**Files:** Create `tests/e2e/projects.spec.ts`, `tickets.spec.ts`, `board.spec.ts`; extend `helpers.ts`; Create `docs/workflows.md` (statuses, categories, transitions, concurrency, what Stage 5 will add); Modify `docs/data-model.md`, `architecture.md`, `security.md`, `testing.md`, `known-limitations.md`, `development-accounts.md`, `README.md`.

- [ ] **Step 1: Write the browser tests:**
  - `projects.spec.ts`: Owner creates a project (key suggestion, duplicate key error shown inline, success lands on the board); Read-only sees projects but no create control; Restricted sees the no-access page; Nora cannot see Acme projects and `/w/acme/projects/WEB` is the same not-found page as a missing one.
  - `tickets.spec.ts`: Developer creates a ticket and sees `WEB-13`; invalid input keeps what was typed; edits title, priority, assignee (own permission), labels and due date and sees them in the timeline; moves through allowed statuses and only those are offered; comments; Reviewer can comment but has no field controls; Read-only sees no controls or comment box; **crafted API calls**: Read-only `PATCH` → `403`, Restricted `GET` → `403`, Nora `GET /tickets/WEB-1` → `404`; conflict banner when a second tab saved first; hostile markup in title and comment renders as text with no dialog or injected element; list filters ("Me", "Overdue", status, label) show exactly the seeded matches; sorting by priority; saved personal and shared views; URL contains the filters and reload keeps them; no-match empty state.
  - `board.spec.ts`: columns and counts match the seed; drag a card to an allowed column (mouse) and it persists after reload; move with the keyboard menu; an illegal drop is refused with a message and the card returns; Read-only has no drag handles; switching identity never shows the previous identity's tickets on Back.
- [ ] **Step 2:** `npm run test:e2e` — all pass; run it three times.
- [ ] **Step 3:** Docs describe only what exists; `known-limitations.md` lists Part B items and the plain-text and offset-pagination choices.
- [ ] **Step 4: Gate:** `npm run check` (read the exit code); `npm run build -w @forge/web`; fresh `npm ci` in a copy (typecheck, lint, format, build).
- [ ] **Step 5: Part A delivery report.**

---

# Part B (outline; detailed plan written when Part A is done)

| Task | Deliverable | Decisions already made |
| ---- | ----------- | ---------------------- |
| B1 | **Custom fields:** definitions (short text, long text, number, boolean, single-select, multi-select, date, URL, user, labels) per workspace, applicable to chosen ticket types; values in `tickets.custom_fields` jsonb with a GIN index; validation against the definition on every write; filter by field; settings screen (`fields.manage`) | Field type is immutable. Deactivating hides a field but keeps its values. Deleting is refused while any ticket has a value. Removing a select option in use is refused (`409` with the count); renaming changes only the label (values store a stable option key). `required` applies on create and when the field itself is edited, never retroactively. |
| B2 | **Relationships and subtasks:** `blocks / is blocked by / relates to / duplicates / is duplicated by` and parent/child; no self-links; no cycles in parent chains (checked in a transaction); the project setting "block completion while blockers are open" (default on) turns into a transition guard | Stored once in canonical direction; inverse names computed. Subtasks are tickets with `parent_id`; depth limited to 2 levels. |
| B3 | **Attachments:** multipart upload, size limit (10 MB), allow-list of types verified by content signature (not just the name), served with `Content-Disposition: attachment` and `nosniff`, authorisation on every download, storage behind a driver interface (local disk in development), progress and error states | SVG and HTML are not accepted. Files are stored under random keys, never the user's filename. Deleting removes the row and the file; an orphan sweep is documented, not built. |
| B4 | **Administrator configuration:** edit project statuses and transitions (create, rename, reorder, deactivate with migration of tickets), workspace ticket types and priorities (create, rename, deactivate) | A status or type in use cannot be deleted, only deactivated; deactivating a status in use requires choosing where its tickets move. |
| B5 | **Bulk operations, duplicate, archive and unarchive, subscribe** | Bulk results are per ticket (partial success is reported, never hidden). Duplicate copies fields and labels, not comments, attachments or history. Subscriptions are recorded now and used by Stage 6 notifications. |
| B6 | Tests, docs and Stage 2 verification | As Part A. |

---

## Self-Review

- **Spec coverage (§5):** ticket properties — identifier, title, description, type, status, priority, assignee, reporter, project, labels, components, timestamps, due date, estimate (A); custom fields, parent, subtasks, related tickets, attachments (B); linked repository/branch/PR (Stage 3–4); internal notes (not in Stage 2, noted as a limitation). Statuses with categories and per-project workflows (A, editing in B4). Priorities configurable (A data, B4 editing). Views: list, board, detail, filtered results, saved views, project views (A); "personal work queue" arrives with My Work (Stage 6). Operations: create/edit/assign/status/priority/labels/comment/due date (A); upload, link, subtask, duplicate, archive, bulk, subscribe (B). Activity timeline distinguishing comments from system events (A). Optimistic concurrency, tenant isolation, permissions on every route (A).
- **Acceptance (Stage 2):** persistence across restarts (database); real API for every operation; correct filters (Task 7 asserts exact sets); relationships consistent (B2); invalid transitions and field values rejected (Tasks 5, B1); permissions on every operation (matrices in Tasks 4–7, 12).
- **Interface consistency:** `parseTicketFilters` (T1) is the one parser for the API (T7) and the web (T9); `createTicket`/`updateTicket` (T5) and `createTicketRow` (T3) share one implementation; `describeTicketEvent` (T1) feeds the timeline (T10); `allowedTransitions` (T5) feeds both the select (T10) and `canDrop` (T11).
- **Risk called out:** Task 2 changes `createOrganisationWithSystemRoles` and `db:migrate`; every earlier test that builds a workspace is re-run in the same task. Task 5 is the highest-risk task (transactions, locking, transitions); it carries the concurrency tests and a mutation check.
- **Proportion:** inputs and expected results are spelled out because they are the decisions; implementation bodies are left to the implementer.
