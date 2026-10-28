# Tickets Tab Board Implementation Plan (P0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. **This owner runs it inline (executing-plans), no
> sub-agents, and commits only when asked: every "Commit" step below is "leave uncommitted".**

**Goal:** The workspace Tickets page gets **Board | List** tabs; the Board tab is a Kanban board of
every project's tickets, one column per status key, with the same filters, saved views, Display
menu and drag-and-drop rules as a project board.

**Architecture:** A new API route builds the workspace board: columns grouped by status **key**
across projects, plus each project's workflow (statuses and transitions), so the browser can check
a move against the ticket's own project. The web board component stops identifying columns by
status id and uses the status key everywhere; a "workflows" list replaces the single project's
transitions. The project board passes a one-entry list, so both boards share one component.

**Tech Stack:** Fastify 5, zod 4, Drizzle (Postgres), Next.js 16 App Router, React 19, `@dnd-kit/core`,
Vitest, Playwright (Edge).

**Spec:** `docs/superpowers/specs/2026-10-23-ticket-system-roadmap.md` (section P0) and the board
design `docs/superpowers/specs/2026-10-23-board-heat-design.md`.

## Global Constraints

- Columns are grouped by status **key**; a column's name and category come from the first project,
  ordered by project key, that has the key; columns are ordered by the smallest `sortOrder` any
  project gives that key, then by key.
- A move is applied in the ticket's own project: target status = that project's active status with
  the column's key; allowed only if the project's transitions allow it and the project is not
  archived. Otherwise it is refused with `"<KEY> cannot move from <from name> to <column name>."`.
- Each column carries at most 50 tickets (`COLUMN_LIMIT`) and reports its true total.
- Filters are the list's filters; status filters and paging are ignored on the board; the project
  filter **is honoured** on the workspace board (and still ignored on a project board).
- Card fields, density and heat are shared with project boards (`preferences.board`). The workspace
  board's column choice is stored separately under `preferences.ticketsBoardColumns` (`null` resets).
- Addresses: `/w/<slug>/tickets` stays the List; `/w/<slug>/tickets/board` is the Board. Old links
  with filters keep working unchanged.
- Permission: `tickets.view` to see; dragging needs the existing edit permission (`fieldPermissions`).
- Text rules unchanged: tickets render as plain text; no new user-visible strings beyond those named
  here.
- Commit only when the owner asks.

## Review Focus

1. **A status key only some projects have** (possible once Part B allows custom statuses): it gets
   its own column holding only those projects' tickets; a ticket from a project without that key
   cannot be dropped there. Tests: Task 1 (`a status only one project has`), Task 3 (`canMoveTo`).
2. **Same key, different names**: the column takes the first project's name, and a project filter
   makes the filtered project's name win. Test: Task 1 (`names a column after the first project`).
3. **A ticket from an archived project** on the workspace board: no grip, no "Move to". Test: Task 3
   (`isMovable`).
4. **Old bookmarks** `/tickets?assignee=me...` still open the list with those filters, and a saved
   board view that names no project (or several) now opens the workspace board instead of a list.
   Tests: Task 4 (`viewTarget`, existing `tickets.spec.ts` unchanged).
5. **Hiding a column on the Tickets board** does not hide it on any project board, and the reverse.
   Test: Task 4 e2e (`column choices on the Tickets board are its own`).

---

### Task 1: The workspace board in the API

**Files:**
- Modify: `packages/shared/src/tickets.ts` (after `boardSchema`)
- Create: `apps/api/src/tickets/workspace-board.ts`
- Modify: `apps/api/src/routes/tickets.ts` (register the route next to the project board)
- Test: `apps/api/src/routes/workspace-board.test.ts`

**Interfaces:**
- Produces (shared):
  - `workflowSchema` / `Workflow` = `{ projectId: uuid; projectKey: string; archived: boolean;
    statuses: { id; key; name; category }[]; transitions: { fromStatusId; toStatusId }[] }`
    (active statuses only).
  - `workspaceBoardSchema` / `WorkspaceBoard` = `{ columns: { status: { key; name; category;
    sortOrder }; total; tickets: TicketSummary[] }[]; workflows: Workflow[] }`.
- Produces (API): `loadWorkspaceBoard(executor: Executor, actor: QueryActor, filters: TicketFilters):
  Promise<WorkspaceBoard>`; route `GET /api/v1/orgs/:orgId/board` with `orgAccess(db, 'tickets.view')`.

- [ ] **Step 1: Write the failing tests** in `workspace-board.test.ts`, using the same setup as
  `routes/board.test.ts` (`startIntegration`, `reseed`, `addListDataset` which adds project LST next
  to the seeded WEB and API). Tests:
  - `who may see the workspace board`: same matrix as the project board (owner…readonly 200,
    restricted 403, other-owner 404 on Acme's id); unauthenticated 401.
  - `has a column per status key, in workflow order`: keys equal `['backlog','open','in_progress',
    'in_review','blocked','done','cancelled']`; names equal the forge names (`'Cold Steel'` …
    `'Scrapped'`).
  - `each column total matches the list filtered to that status`: for every column, `total` equals
    `GET /tickets?statusKey=<key>&pageSize=1` → `total`; and the tickets span more than one project
    key (`new Set(tickets.map(t => t.project.key)).size > 1` for `backlog`).
  - `honours the project filter`: `?project=LST` → every ticket's `project.key === 'LST'`, totals
    equal `routes/board.test.ts`'s LST totals (`backlog: 3, open: 3, in_progress: 1, in_review: 1,
    blocked: 1, done: 1, cancelled: 1`), and `workflows.map(w => w.projectKey)` equals `['LST']`.
  - `carries every project's workflow`: `workflows` keys `['API','LST','WEB']` (ordered by key);
    LST's `statuses` ids equal `statusIds`; LST's transitions equal the rows of
    `status_transitions` for LST; an archived project (set `archived_at` on LST) has
    `archived: true` and its tickets stay on the board.
  - `names a column after the first project that has the key`: rename API's `open` status to
    `'Ready'` → column `open` is named `'Ready'` (API sorts first); with `?project=WEB` it is
    `'Warming'`.
  - `a status only one project has`: insert an active LST status `{ key: 'qa', name: 'QA', category:
    'in_progress', sortOrder: <in_review's sortOrder> }` and move LST-3 to it → a `qa` column exists,
    placed after `in_review` (same sortOrder, then by key: `in_review` < `qa`) and holding only
    `LST-3`.
  - `ignores status filters and paging; refuses invalid filters with 422` (`sort=password`).
  - `keeps workspaces apart`: Northwind's owner on Northwind's id sees only `OPS-` tickets and one
    workflow (`OPS`).
- [ ] **Step 2: Run** `npm test -w @forge/api -- workspace-board` → FAIL (404 for the route).
- [ ] **Step 3: Implement.** Add the two schemas. `loadWorkspaceBoard`: load the workspace's projects
  (narrowed to `filters.project` when given) ordered by key; their active statuses ordered by
  `sortOrder`; their transitions; group statuses by key per the Global Constraints; for each column
  call `searchTicketIds` with `conditionsFor(filters, actor, { ignoreStatus: true })` plus
  `inArray(tickets.statusId, <ids of that key>)`, `orderFor(filters.sort, filters.dir)`,
  `limit: COLUMN_LIMIT`, `offset: 0`; load summaries with `loadTicketSummaries`. No projects → empty
  `columns` and `workflows`.
- [ ] **Step 4: Run** `npm test -w @forge/api -- workspace-board board` → PASS (project board tests
  still pass).
- [ ] **Step 5:** Leave uncommitted.

### Task 2: A separate column choice for the Tickets board

**Files:**
- Modify: `packages/shared/src/api.ts` (`preferencesSchema`)
- Modify: `apps/api/src/routes/preferences.ts`
- Test: `packages/shared/src/board-display.test.ts`, `apps/api/src/routes/preferences.test.ts`

**Interfaces:**
- Produces: `preferencesSchema.ticketsBoardColumns: boardColumnPrefsSchema.nullable().optional()`;
  `PATCH /api/v1/me/preferences { ticketsBoardColumns: BoardColumnPrefs | null }`.

- [ ] **Step 1: Write the failing tests.**
  - shared: `preferencesSchema` accepts `{ ticketsBoardColumns: { hidden: ['done'], order: [] } }`
    and `{ ticketsBoardColumns: null }`; rejects `{ ticketsBoardColumns: { hidden: ['Bad Key'],
    order: [] } }` and an unknown inner key.
  - API: saving `ticketsBoardColumns` then reading back returns it; a second save replaces it
    whole; `null` removes it (the key is absent from `GET`); it leaves `boardColumns.WEB` and `board`
    untouched and they leave it untouched; first save with `null` stores nothing; invalid value →
    `422`.
- [ ] **Step 2: Run** `npm test -w @forge/shared -- board-display` and
  `npm test -w @forge/api -- preferences` → FAIL.
- [ ] **Step 3: Implement.** Schema field as above. In the route: the first-save object drops a null
  `ticketsBoardColumns`; the merge statement removes the key when the incoming value is JSON null
  (`- CASE WHEN jsonb_typeof(incoming->'ticketsBoardColumns') = 'null' THEN 'ticketsBoardColumns'
  ELSE '' END` applied to the merged result) and otherwise lets plain `||` replace it.
- [ ] **Step 4: Run** both commands → PASS.
- [ ] **Step 5:** Leave uncommitted.

### Task 3: One board component for both boards, keyed by status

**Files:**
- Modify: `apps/web/src/lib/board.ts`, `apps/web/src/lib/board.test.ts`
- Modify: `apps/web/src/components/board/board.tsx`, `column.tsx`, `prefs-provider.tsx`
- Modify: `apps/web/src/app/(app)/w/[slug]/projects/[key]/board/page.tsx`
- Test: `apps/web/src/lib/board.test.ts`; regression: `tests/e2e/board.spec.ts` unchanged

**Interfaces:**
- Consumes: `Workflow`, `WorkspaceBoard` (Task 1).
- Produces (`lib/board.ts`):
  - `type StatusRef = { id: string; key: string; name: string; category: StatusCategory }`
  - `type BoardColumnData = { status: { key: string; name: string; category: StatusCategory;
    sortOrder: number }; total: number; tickets: TicketSummary[] }`; `type BoardData = { columns:
    BoardColumnData[] }` (a project `Board` is assignable to it).
  - `isMovable(workflows: readonly Workflow[], ticket: TicketSummary): boolean` (its project is known
    and not archived)
  - `allowedStatuses(workflows, ticket): StatusRef[]` (in its project's status order)
  - `canMoveTo(workflows, ticket, toKey: string): StatusRef | null`
  - `nextBoardState(board: BoardData, ticketId: string, toKey: string, status: StatusRef): BoardData`
  - `BoardAction` `moved` becomes `{ type: 'moved'; ticketId; toKey; status: StatusRef }`; the others
    are unchanged. `allowedTargets` and `canDrop` are removed.
- Produces (components): `Board` props `{ initial: BoardData; workflows: Workflow[]; organisationId;
  slug; canMove: boolean; today; maxRank; filters; listBase: string; scoped: boolean; dndId: string }`;
  droppable ids are status keys. `BoardPrefsProvider` takes `scope: { kind: 'project'; projectKey:
  string } | { kind: 'tickets' }` instead of `projectKey`.

- [ ] **Step 1: Rewrite the failing unit tests** in `board.test.ts` for the new functions, with two
  workflows (project A: backlog→open allowed, open→backlog allowed; project B: has `qa`, archived
  in one case):
  - `nextBoardState` moves by key, sets the card's status to the given `StatusRef`, updates both
    totals, returns the same object for an unknown ticket, unknown key or same column.
  - `allowedStatuses` returns only the ticket's own project's targets.
  - `canMoveTo` returns the project's status for an allowed key; `null` for a disallowed key, for a
    key the ticket's project lacks (`qa` on an A ticket), and for any key when the project is
    archived.
  - `isMovable` is false for an archived project and for a ticket whose project is not in the list.
  - reducer `moved`/`saved`/`rejected`/`replaced` as before, with the new `moved` shape.
- [ ] **Step 2: Run** `npm test -w @forge/web -- board` → FAIL.
- [ ] **Step 3: Implement** `lib/board.ts`, then the components: `Board` uses `canMoveTo` for drop
  states, drops and the refusal toast (Global Constraints wording), `allowedStatuses` for "Move to",
  `isMovable` (with `canMove`) per card, `seeAllHref = hrefFor(listBase, { ...filters, statusKey:
  [key], statusCategory: [], page: 1 }, { omitProject: scoped })`, and `id={dndId}`. `BoardColumn`
  takes a `BoardColumnData` and uses `status.key` as the droppable id. The provider saves
  `{ boardColumns: { [projectKey]: prefs } }` or `{ ticketsBoardColumns: prefs }` by scope. The
  project page passes `workflows={[{ projectId, projectKey, archived, statuses, transitions }]}`
  built from `project.data`, `listBase` = the project list, `scoped`, `dndId={`board-${key}`}`.
- [ ] **Step 4: Run** `npm test -w @forge/web` → PASS; then `npx playwright test board` → all 26
  pass unchanged (the refactor must not change the project board).
- [ ] **Step 5:** Leave uncommitted.

### Task 4: Board and List tabs on the Tickets page

**Files:**
- Create: `apps/web/src/components/tickets/view-tabs.tsx` (replaces `projects/project-tabs.tsx`)
- Create: `apps/web/src/components/tickets/tickets-header.tsx`
- Create: `apps/web/src/app/(app)/w/[slug]/tickets/board/page.tsx`
- Modify: `apps/web/src/app/(app)/w/[slug]/tickets/page.tsx`, `projects/[key]/layout.tsx`
- Modify: `apps/web/src/lib/saved-views.ts`, `apps/web/src/lib/nav.ts`
- Test: `apps/web/src/lib/saved-views.test.ts`, `apps/web/src/lib/nav.test.ts`,
  `tests/e2e/tickets-board.spec.ts` (new)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `ViewTabs({ label: string; boardHref: string; listHref: string })` (client; carries the
  query string between tabs; current tab `aria-current="page"`); `TicketsHeader({ membership })`
  (server; the existing title, description and New ticket button, then `ViewTabs` with
  `label="Ticket views"`).

- [ ] **Step 1: Write the failing tests.**
  - `saved-views.test.ts`: a board view naming no project opens `/w/acme/tickets/board?…`; naming two
    projects opens `/w/acme/tickets/board?project=API&project=WEB…`; naming one still opens that
    project's board; list views unchanged.
  - `nav.test.ts`: `/w/acme/tickets/board` → `[Acme Robotics, Tickets (link), Board]`.
  - `tickets-board.spec.ts` (viewport 1920×1000, `reseed` before each, signed in as owner unless
    named):
    - `the Tickets page has Board and List tabs, and filters travel between them`: open
      `/w/acme/tickets?priority=high`, click Board → URL `/w/acme/tickets/board?priority=high`, the
      Priority filter still shows high; click List → back with the filter.
    - `the board holds every project's tickets by status`: `Cold Steel, 4 tickets`,
      `Warming, 5 tickets`, `In the Forge, 3 tickets`, `Tempering, 2 tickets`, `Blocked, 2 tickets`,
      `Quenched, 3 tickets`; Warming contains `WEB-` and `API-` cards (`API-4`).
    - `a card from another project moves under its own workflow and stays moved`: drag `API-4`
      (Warming) to In the Forge → reload → it is in In the Forge; its ticket page says In the Forge.
    - `a move its project does not allow is refused with a reason`: drag `API-2` (Quenched) to Cold
      Steel → toast `API-2 cannot move from Quenched to Cold Steel.` and the card stays (use a
      transition the default workflow refuses; confirm against `docs/workflows.md` while writing).
    - `column choices on the Tickets board are its own`: hide Blocked on the Tickets board → WEB's
      board still shows Blocked; hide Tempering on WEB's board → Tickets board still shows it.
    - `a saved board view without a project opens the Tickets board`: save a personal board view on
      the Tickets board with `priority=high`, open it from Views on the list → lands on
      `/w/acme/tickets/board?priority=high`.
    - `a read-only member can look but has nothing to grab`: as `readonly`, no `Pick up` buttons.
- [ ] **Step 2: Run** `npm test -w @forge/web -- saved-views nav` and
  `npx playwright test tickets-board` → FAIL.
- [ ] **Step 3: Implement.** `ViewTabs` from `ProjectTabs` (project layout uses
  `label="Project views"`, so its tests keep passing; delete `project-tabs.tsx`). The Tickets list
  page renders `TicketsHeader` then `TicketListView` (basePath unchanged `/tickets`). The board page
  mirrors the project board page: parse filters (keep `project`), fetch
  `GET /board?…` with `workspaceBoardSchema`, `ticket-config`, `members`, `views`, `projects` (for
  the Project filter options); wrap in `BoardPrefsProvider scope={{ kind: 'tickets' }}` with
  `initialColumns={viewer.preferences.ticketsBoardColumns ?? undefined}`; `FilterBar` not scoped,
  `showStatus={false}`; `SavedViewsMenu display="board"`; `DisplayMenu`; `Board` with
  `workflows`, `listBase` = `/tickets`, `scoped={false}`, `dndId="board-tickets"`,
  `canMove={permissions.canEdit}`. `viewTarget` and the breadcrumb as tested.
- [ ] **Step 4: Run** the Step 2 commands → PASS; then the whole browser suite `npm run test:e2e`
  → all pass.
- [ ] **Step 5:** Leave uncommitted.

### Task 5: Docs and the gate

**Files:** `docs/architecture.md`, `docs/workflows.md`, `docs/testing.md`,
`docs/known-limitations.md`, `README.md`

- [ ] **Step 1:** Document the workspace board (route, grouping by key, naming rule, per-ticket
  workflow check, separate column choice); remove "group by" wording that implies the Tickets page
  has no board; update test counts with the real numbers from Step 2.
- [ ] **Step 2: Gate:** `npm run typecheck`, `npm run lint`, `npx prettier --check --end-of-line auto .`,
  `npm test` (read each exit code), `npm run test:e2e`; fresh copy (LF, `npm ci`, typecheck, lint,
  strict `format:check`, `next build`).
- [ ] **Step 3:** Report to the owner with real counts; leave uncommitted.
