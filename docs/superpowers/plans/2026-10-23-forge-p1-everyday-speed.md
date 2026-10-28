# P1 Everyday Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. **The owner commits only when asked: every "Commit" step is
> "leave uncommitted".**

**Goal:** Archive, duplicate, quick create, card and ticket-page actions, inline list edits, bulk
edit, a command menu and keyboard shortcuts, so common ticket work takes one or two keystrokes.

**Architecture:** New API routes (archive, unarchive, duplicate, bulk, workflows) reuse the existing
ticket service (`createTicket`, `updateTicket`) so permissions, validation, history and version rules
stay in one place. The web adds client components on top of the existing pages; one shared
`ticket-actions` module performs every action (used by the card menu, the ticket page, the command
menu, shortcuts and bulk) so behaviour and messages are identical everywhere.

**Tech Stack:** Fastify 5, zod 4, Drizzle/Postgres, Next.js 16 App Router, React 19, sonner,
lucide-react, Vitest, Playwright (Edge).

**Spec:** `docs/superpowers/specs/2026-10-23-p1-everyday-speed-design.md` (the design; binding) and
`docs/superpowers/specs/2026-10-23-ticket-system-roadmap.md` (P1).

## Global Constraints

- Every action is an API route with a permission check: archive/unarchive `tickets.edit`; duplicate
  `tickets.create`; bulk `tickets.edit` (plus `tickets.assign` when it sets an assignee); create with
  `statusId` `tickets.create`. The screens hide what a role cannot do but the API is the authority.
- Archived tickets are read-only: `PATCH /tickets/:key`, comment add/edit/delete answer `409`
  `{ code: 'conflict', message: 'This ticket is archived. Unarchive it to change it.' }`.
- Exact copy: duplicate title `Copy of <title>` cut to 200 characters; history lines
  `"<actor> archived this ticket"`, `"<actor> unarchived this ticket"`,
  `"<actor> duplicated this from <KEY>"`.
- Bulk: 1 to 100 distinct keys; each ticket in its own transaction against its current version;
  response `{ results: ({ key, ok: true, ticket: TicketSummary } | { key, ok: false, error: { code,
  message } })[] }` in the order of the request; HTTP 200 even when some fail; `422` only for a
  malformed body.
- Bulk result message: `Changed <n> of <m>.` and, when some failed, `<k> could not be changed:`
  followed by `<KEY>: <message>` per failure.
- Default type for quick create: the active type with key `task`, else the first active type;
  default priority: key `normal`, else the middle rank.
- Shortcuts never fire while focus is in an `input`, `textarea`, `select` or `contenteditable`, or with
  Alt/Ctrl/Meta held (except Ctrl/Cmd+K).
- No new runtime dependency. Plain text only. Commit only when the owner asks.

## Review Focus

1. **A bulk change that only some tickets accept** (one archived, one whose workflow refuses the
   status, one in another project with a different status set) — each result is reported, nothing
   is silently skipped. Test: Task 2 (`reports each ticket's own result`), Task 6 e2e.
2. **Editing an archived ticket from a stale page** (another tab archived it) — refused with the
   archived message, never applied. Test: Task 1 (`refuses edits and comments while archived`).
3. **Shortcuts while typing** — pressing `c`, `a`, `/` or `?` inside the comment box or search does
   nothing but type. Test: Task 8 e2e (`shortcuts never fire while typing`).
4. **Quick create on the Tickets board** with a Project filter of one project creates in that
   project; with none, the project select decides. Test: Task 4 e2e.
5. **Duplicate by someone who cannot assign** keeps everything but the assignee. Test: Task 1.

---

### Task 1: Archive, unarchive and duplicate in the API

**Files:**
- Modify: `packages/shared/src/ticket-events.ts` (three event types and their lines)
- Modify: `apps/api/src/tickets/service.ts` (`setArchived`, `duplicateTicket`, archived guard in
  `updateTicket`), `apps/api/src/tickets/comments.ts` (archived guard)
- Modify: `apps/api/src/routes/tickets.ts` (three routes)
- Test: `packages/shared/src/ticket-events.test.ts` (or the existing events test file),
  `apps/api/src/routes/ticket-actions.test.ts` (new)

**Interfaces:**
- Produces (shared): event types `ticket.archived` `{ data: {} }`, `ticket.unarchived` `{ data: {} }`,
  `ticket.duplicated` `{ data: { fromKey: string } }`; `describeTicketEvent` lines as in Global
  Constraints.
- Produces (API): `setArchived(db, { context, ticketKey, archived: boolean }): Promise<TicketDetail>`;
  `duplicateTicket(db, { context, ticketKey }): Promise<TicketDetail>`; routes
  `POST /api/v1/orgs/:orgId/tickets/:ticketKey/archive` (`tickets.edit`),
  `POST …/unarchive` (`tickets.edit`), `POST …/duplicate` (`tickets.create`, answers `201`).
  Archiving an archived ticket (or unarchiving an active one) is a no-op returning the ticket.
  Both bump `version` and `updatedAt` when they change something.

- [ ] **Step 1: Write the failing tests.** Shared: the three lines. API:
  - permission matrix for each route, derived from the system roles' permissions in
    `packages/shared/src/permissions.ts` (a role with the needed permission gets 200, or 201 for
    duplicate; one without gets 403; restricted 403; other-owner 404) and 401 unauthenticated;
  - `archives and unarchives, with history`: archive → `archivedAt` set, `version` +1, list no longer
    shows it, `?archived=true` does; history has "archived this ticket"; unarchive reverses;
  - `refuses edits and comments while archived`: PATCH, comment add, edit and delete → 409 with the
    exact message; unarchive → PATCH works again;
  - `duplicates fields but not comments or history`: copy has `Copy of <title>`, same type,
    priority, labels, component, due date, estimate, description, project; initial status; no
    comments; history = created + "duplicated this from LST-1"; a 200-character title is cut to 200;
  - `a duplicate by someone who cannot assign has no assignee` (custom role with `tickets.create`
    only, or reviewer-equivalent set up in the test);
  - `duplicating into an archived project is refused` (409, existing message);
  - cross-workspace: Nora gets 404 for each route on an Acme ticket.
- [ ] **Step 2: Run** `npm test -w @forge/shared -- ticket-events` and
  `npm test -w @forge/api -- ticket-actions` → FAIL.
- [ ] **Step 3: Implement** as in Interfaces. The guard reads `archived_at` on the locked row.
- [ ] **Step 4: Run** the same commands and `npm test -w @forge/api -- tickets comments` → PASS.
- [ ] **Step 5:** Leave uncommitted.

### Task 2: Create in a status, workflows, and bulk edit in the API

**Files:**
- Modify: `packages/shared/src/tickets.ts` (`createTicketBodySchema.statusId`, bulk schemas)
- Modify: `apps/api/src/tickets/service.ts` (`createTicket` honours `statusId`)
- Create: `apps/api/src/tickets/bulk.ts`; Modify: `apps/api/src/tickets/workspace-board.ts`
  (extract `loadWorkflows`)
- Modify: `apps/api/src/routes/tickets.ts`
- Test: `apps/api/src/routes/ticket-bulk.test.ts` (new), additions to `routes/tickets.test.ts`

**Interfaces:**
- Produces (shared): `createTicketBodySchema.statusId: z.uuid().optional()`;
  `bulkTicketBodySchema = z.strictObject({ keys: z.array(z.string()).min(1).max(100) (distinct),
  changes: z.strictObject({ statusKey?, priorityId?, assigneeId? (nullable), addLabelIds? (max 20),
  removeLabelIds? (max 20), dueDate? (nullable), archived?: boolean }).refine(non-empty) })`;
  `bulkTicketResultSchema` as in Global Constraints; types `BulkTicketBody`, `BulkTicketResult`.
- Produces (API): `loadWorkflows(executor, actor, projectKeys?: string[]): Promise<Workflow[]>`
  (used by `loadWorkspaceBoard`); `GET /api/v1/orgs/:orgId/workflows` (`tickets.view`) →
  `Workflow[]`; `bulkUpdate(db, { context, body }): Promise<BulkTicketResult>`;
  `POST /api/v1/orgs/:orgId/tickets/bulk` (`tickets.edit`).
- Bulk semantics: per key, read the ticket (unknown or other workspace → `{ ok: false, error:
  { code: 'not_found', message: 'Not found.' } }`); `statusKey` → that project's active status of
  that key, else `{ code: 'validation_failed', message: '<KEY>'s project has no status "<key>".' }`;
  call `updateTicket` with the ticket's current version and labels = current ∪ add − remove; then
  `setArchived` if `archived` is set. An `AppError` becomes that ticket's error, with `message` set
  to the first issue's message when the error carries issues (so a refused move reads "That move
  isn't allowed from Quenched.", not the generic validation text), else the error's own message;
  anything else is rethrown.

- [ ] **Step 1: Write the failing tests.**
  - `creates a ticket in the status asked for` (LST `in_review`); `refuses a status of another project
    or an inactive one` (422, path `statusId`); without `statusId` it is the initial status (exists).
  - `GET /workflows`: one per project ordered by key; matrix like the board.
  - bulk: matrix (`developer` 200, `reviewer` 403, …); `changes priority on every ticket` (versions
    +1, history written per ticket); `reports each ticket's own result` (keys: LST-1 open→in_progress
    allowed, LST-4 done→in_progress refused by the workflow, LST-7 archived, WEB-1, NOPE-1 →
    results in request order with ok/error exactly as specified); `adds and removes labels without
    touching others`; `assigning needs tickets.assign` (a role with edit but not assign → 403 for the
    whole request); `refuses more than 100 keys or duplicates` (422); `archives in bulk`; Nora's keys
    are `not_found` from Acme.
- [ ] **Step 2: Run** `npm test -w @forge/api -- ticket-bulk tickets` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -w @forge/api` → PASS (workspace-board tests still pass after the
  `loadWorkflows` extraction).
- [ ] **Step 5:** Leave uncommitted.

### Task 3: Shared ticket actions, and the ticket page's actions menu

**Files:**
- Create: `apps/web/src/lib/ticket-actions.ts` (pure helpers + one client fetch layer),
  `apps/web/src/lib/ticket-actions.test.ts`
- Create: `apps/web/src/components/tickets/ticket-actions-menu.tsx`,
  `apps/web/src/components/tickets/archived-banner.tsx`
- Modify: `apps/web/src/app/(app)/w/[slug]/tickets/[ticketKey]/page.tsx`
- Test: `tests/e2e/ticket-actions.spec.ts` (new)

**Interfaces:**
- Produces: `ticketHref(slug, key): string` (absolute URL built from `window.location.origin` at call
  time in the client); `bulkSummary(results: BulkTicketResult['results']): { text: string;
  failures: string[] }` (exact copy from Global Constraints); `defaultTypeAndPriority(config):
  { typeId; priorityId }`; client functions `archiveTicket(orgId, key)`,
  `unarchiveTicket(orgId, key)`, `duplicateTicket(orgId, key): Promise<TicketDetail>`,
  `copyText(text): Promise<boolean>`; `TicketActionsMenu({ organisationId, slug, ticket:
  { key; title; archived: boolean }, canEdit, canCreate })` (Copy key, Copy link, Duplicate,
  Archive/Unarchive; toasts `Copied <KEY>.`, `Copied the link to <KEY>.`, `Archived <KEY>.`,
  `Unarchived <KEY>.`, `Created <NEW-KEY>, a copy of <KEY>.` then navigates to the copy).
- [ ] **Step 1: Write the failing tests.** Unit: `bulkSummary` for all-ok, some-failed, all-failed;
  `defaultTypeAndPriority` for normal config, no `task`, no `normal`. E2E: archive from the ticket
  page shows the banner, the fields are read-only, the list no longer shows it, Unarchive restores;
  duplicate opens the copy with `Copy of …` and history "duplicated this from WEB-3"; Copy key puts
  `WEB-3` on the clipboard (grant clipboard permissions in the test); readonly sees no menu items
  that change anything (only Copy key and Copy link).
- [ ] **Step 2: Run** `npm test -w @forge/web -- ticket-actions` and
  `npx playwright test ticket-actions` → FAIL.
- [ ] **Step 3: Implement.** Archived tickets: the ticket page renders fields and comment box
  disabled with the banner.
- [ ] **Step 4: Run** both → PASS.
- [ ] **Step 5:** Leave uncommitted.

### Task 4: Card actions and quick create on boards

**Files:**
- Modify: `apps/web/src/components/board/move-menu.tsx` → rename to `card-menu.tsx` (Move to,
  Priority, Assign, Copy key, Copy link, Duplicate, Archive), `card.tsx`, `board.tsx`, `column.tsx`
- Create: `apps/web/src/components/board/quick-create.tsx`
- Modify: both board pages (pass `config`, `members`, `projects`, permissions)
- Test: additions to `tests/e2e/board.spec.ts` and `tests/e2e/tickets-board.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`statusId` on create), Task 3 (`ticket-actions`).
- Produces: `Board` gains props `config: TicketConfig`, `members: Member[] | null`, `canCreate`,
  `canAssign`, `projects: { key; name; archived }[]` (Tickets board only; one entry on a project
  board). `BoardColumn` gains an optional `onQuickCreate` that renders the "+" button named
  `Add a ticket to <Column>`.
- [ ] **Step 1: Write the failing e2e tests.** Project board: "+" on Tempering, type a title, Enter →
  the card appears at the top of Tempering and survives a reload; Escape closes without creating;
  an empty title is not sent. Tickets board: with `?project=API` the new ticket is `API-9`; without
  a filter, choosing API in the select creates an API ticket. Card menu: Priority → High changes the
  card's bars and the ticket's priority; Assign to me shows the avatar; Archive removes the card and
  says `Archived WEB-3.`; readonly sees no "+" and no changing actions.
- [ ] **Step 2: Run** `npx playwright test board tickets-board` → FAIL (new tests only).
- [ ] **Step 3: Implement.** After any change: `router.refresh()`; failures toast the API message.
- [ ] **Step 4: Run** the same → all PASS (old tests unchanged).
- [ ] **Step 5:** Leave uncommitted.

### Task 5: Inline status, priority and assignee in the list

**Files:**
- Create: `apps/web/src/components/tickets/inline-cell-menu.tsx`
- Modify: `apps/web/src/components/tickets/ticket-table.tsx` (client island for the three cells),
  `ticket-list-view.tsx` (fetch `GET /workflows`, pass permissions, members, config)
- Test: additions to `tests/e2e/tickets.spec.ts`

**Interfaces:**
- Consumes: `GET /workflows` (Task 2), `allowedStatuses` from `lib/board.ts`.
- Produces: `InlineCellMenu` with button names `Change status of <KEY>`, `Change priority of <KEY>`,
  `Change assignee of <KEY>`; read-only roles get plain text (no button).
- [ ] **Step 1: Write the failing e2e tests.** Status menu on WEB-3 offers exactly Tempering's allowed
  moves (In the Forge, Blocked, Quenched, Scrapped); choosing Blocked updates the row and history;
  priority and assignee likewise; a stale row (ticket changed in another tab) shows the conflict
  message and refreshes; readonly has no buttons.
- [ ] **Step 2: Run** `npx playwright test tickets` → FAIL (new tests).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5:** Leave uncommitted.

### Task 6: Bulk edit from the list

**Files:**
- Create: `apps/web/src/components/tickets/bulk-bar.tsx`, `apps/web/src/lib/selection.ts` (+ test)
- Modify: `ticket-table.tsx` (checkbox column, header checkbox), `ticket-list-view.tsx`
- Test: `apps/web/src/lib/selection.test.ts`, `tests/e2e/bulk.spec.ts` (new)

**Interfaces:**
- Consumes: `POST /tickets/bulk` (Task 2), `bulkSummary` (Task 3).
- Produces: `selectionReducer` (`toggle`, `toggleAll(keys)`, `clear`, `retain(keys)` when the page's
  rows change); checkbox names `Select <KEY>` and `Select all on this page`; bar region named
  `Bulk actions` with `N selected`, the actions, and `Clear selection`.
- [ ] **Step 1: Write the failing tests.** Unit: the reducer. E2E: select WEB-1, WEB-2, WEB-5 → set
  priority High → all three show High and the bar says `Changed 3 of 3.`; select a Quenched ticket and
  a Warming ticket → Move to In the Forge → `Changed 1 of 2.` and `WEB-<n>: That move isn't allowed
  from Quenched.`; Archive two → they leave the list; readonly sees no checkboxes.
- [ ] **Step 2: Run** `npm test -w @forge/web -- selection` and `npx playwright test bulk` → FAIL.
- [ ] **Step 3: Implement.** The bar's Move to lists the union of status keys across workflows, by
  name of the first project with the key (same rule as the Tickets board).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5:** Leave uncommitted.

### Task 7: The command menu

**Files:**
- Create: `apps/web/src/components/command/command-menu.tsx`,
  `apps/web/src/lib/commands.ts` (+ test)
- Modify: `apps/web/src/app/(app)/w/[slug]/layout.tsx` (mount once per workspace), the ticket page
  (register the current ticket's actions through a small context)
- Test: `apps/web/src/lib/commands.test.ts`, `tests/e2e/command-menu.spec.ts` (new)

**Interfaces:**
- Produces: `rankCommands(query, commands): Command[]` (case-insensitive; key prefix beats title
  word start beats substring; stable order otherwise); `Command = { id; group: 'Tickets' | 'Actions'
  | 'Projects' | 'Views' | 'Pages'; label; hint?; run | href }`; dialog `role="dialog"` named
  `Command menu`, input `role="combobox"`, options `role="option"`, `aria-activedescendant`.
- [ ] **Step 1: Write the failing tests.** Unit: ranking. E2E: Ctrl+K opens; typing `web-3` shows
  WEB-3 first, Enter opens it; on WEB-3's page, `assign` → "Assign to me" assigns it (history shows
  it); "Move to Blocked" works; Escape closes and focus returns; `Create ticket` opens the form;
  readonly sees no changing actions.
- [ ] **Step 2: Run** `npm test -w @forge/web -- commands` and `npx playwright test command-menu` →
  FAIL.
- [ ] **Step 3: Implement.** Ticket search: `GET /tickets?q=<text>&pageSize=8` debounced 150 ms.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5:** Leave uncommitted.

### Task 8: Keyboard shortcuts and the shortcut sheet

**Files:**
- Create: `apps/web/src/lib/shortcuts.ts` (+ test), `apps/web/src/components/command/shortcuts.tsx`
  (global listener + `?` sheet)
- Modify: list (row focus `j`/`k`/`Enter`/`x`), ticket page (`a`, `m`), filter bar (`/` target)
- Test: `apps/web/src/lib/shortcuts.test.ts`, `tests/e2e/shortcuts.spec.ts` (new)

**Interfaces:**
- Produces: `shortcutFor(event: { key; ctrlKey; metaKey; altKey; target }, pending: 'g' | null):
  { action: string } | { pending: 'g' } | null` (pure; `g` waits 1 s for the second key);
  the sheet is a dialog named `Keyboard shortcuts`.
- [ ] **Step 1: Write the failing tests.** Unit: every shortcut in the design; typing targets return
  null; modifiers return null except Ctrl/Meta+K. E2E: `g` `b` opens the Tickets board; `c` opens the
  new-ticket form (with WEB chosen from WEB's board); `/` focuses search; `?` opens the sheet; on the
  list `j` `j` `Enter` opens the second ticket; on WEB-3 `a` assigns to me; `shortcuts never fire while
  typing` (type `c a ? /` in the comment box: the text is there, nothing else happened).
- [ ] **Step 2: Run** `npm test -w @forge/web -- shortcuts` and `npx playwright test shortcuts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5:** Leave uncommitted.

### Task 9: Docs and the gate

**Files:** `docs/architecture.md`, `docs/workflows.md`, `docs/security.md` (route permissions),
`docs/data-model.md` (new event types), `docs/testing.md`, `docs/known-limitations.md`, `README.md`

- [ ] **Step 1:** Document the routes, archived read-only rule, bulk semantics, command menu and
  shortcuts (with the sheet's list), and the deferred items (templates to P4, bulk on the board,
  inline due dates).
- [ ] **Step 2: Gate:** typecheck, lint, `prettier --check --end-of-line auto .`, `npm test`,
  `npm run test:e2e` (read each exit code); fresh LF copy: `npm ci`, typecheck, lint, strict
  `format:check`, `next build`.
- [ ] **Step 3:** Report with real counts; leave uncommitted.
