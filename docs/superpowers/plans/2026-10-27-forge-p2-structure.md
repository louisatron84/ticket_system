# P2 Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. **The owner commits only when asked: every "Commit" step is
> "leave uncommitted".**

**Goal:** Parents and children (epic, ticket, sub-task), typed links, visible and enforced blockers,
one-action duplicate resolution, and the ticket page, board, list and filters that show them.

**Architecture:** One migration adds the columns and the `ticket_links` table. Two new API modules,
`tickets/structure.ts` (parents, links, mark-as-duplicate) and `tickets/blockers.ts` (the open-blocker
query and the completion guard), are used by the existing ticket service so every way of moving a
ticket (page, board, bulk, command menu) is guarded in one place. The read model adds parent, progress
and blocker fields to summaries and ancestors, children and links to the detail, so screens need no
extra requests.

**Tech Stack:** Fastify 5, zod 4, Drizzle/Postgres, Next.js 16 App Router, React 19, dnd-kit, sonner,
Vitest, Playwright (Edge).

**Spec:** `docs/superpowers/specs/2026-10-27-p2-structure-design.md` (binding, including "Settled after
the builder check") and the roadmap's P2 section.

## Global Constraints

- Depth: top level is 1; `MAX_TICKET_DEPTH = 3`. Epics (type key `epic`) are always top level.
- Parents and links stay inside one workspace; may cross projects.
- Parent and link writes neither check nor bump `version`; they lock both tickets' rows **in id
  order** (`select … for update`) in one transaction, and write history on both tickets.
- No new parent, child, link or duplicate original may be archived or in an archived project:
  `409 { code: 'conflict', message: 'This ticket is archived. Unarchive it to change it.' }` (the
  existing `archivedTicketError()`); a ticket in an archived project gets
  `'<KEY> is in an archived project.'`. Removing an existing child or link is always allowed.
- Open blocker: a ticket with a `blocks` link to this one whose status category is not `completed`
  (archived or not). A ticket that is itself completed is never shown or filtered as blocked.
- Guard: when the **blocked ticket's** project has `blockers_stop_completion = true` (default), a move
  into a `completed` status with `is_cancellation = false` is refused with `422 validation_failed`,
  issue `{ path: 'statusId', message: "<KEY> can't be <status name lower-cased> while <KEYS> <is|are>
  open." }` where KEYS are joined `A`, `A and B`, `A, B and C`. Scrapping is always allowed.
- Exact history copy (actor name first, as today): `set the parent to WEB-20`, `removed the parent
  WEB-20`, `added WEB-22 as a child`, `removed WEB-22 from its children`, `added a link: blocked by
  API-4`, `removed a link: blocked by API-4`, `marked this as a duplicate of WEB-3`.
- Link labels: `blocks` outward "Blocks", inward "Blocked by"; `duplicates` "Duplicates" /
  "Duplicated by"; `relates_to` "Relates to" both ways.
- Progress counts every descendant except those in a cancellation status; buckets: `completed`
  (category completed), `jammed` (status key `blocked`), `inProgress` (other in_progress),
  `notStarted`.
- No new runtime dependency. Plain text only. Commit only when the owner asks.

## Review Focus

1. **Two people make a loop at once** (A under B and B under A, sent together): one succeeds, the
   other is refused; never a cycle. Test: Task 2 (`parent.concurrency.test.ts`).
2. **A blocked ticket moved to done from every path** (ticket page, board drag, bulk edit, command
   menu): refused with the same message each time; scrapping still works. Test: Task 4 (bulk and
   update), Task 7 e2e (drag).
3. **A blocker reopened after being quenched** blocks again; a blocker quenched unblocks without any
   write to the blocked ticket. Test: Task 4 (`a reopened blocker blocks again`).
4. **Moving a subtree** (a ticket with children) under a new parent counts the subtree's height, so a
   fourth level can't sneak in. Test: Task 2 (`refuses a fourth level through the subtree`).
5. **Tree list paging with filters**: a matching child of a non-matching parent appears once, under
   its greyed parent, and the total counts only matches. Test: Task 5 (`tree mode pages by top
   level`).

---

### Task 1: Data model and shared shapes

**Files:**
- Create: `packages/db/migrations/0005_ticket_structure.sql` (generate with `npx drizzle-kit generate
  --name ticket_structure` from `packages/db`, then append the back-fill), `packages/db/src/structure.test.ts`
- Modify: `packages/db/src/schema.ts`, `packages/shared/src/tickets.ts`, `packages/shared/src/ticket-events.ts`,
  `packages/shared/src/ticket-events.test.ts`, `packages/shared/src/tickets.test.ts`, `docs/data-model.md`

**Interfaces:**
- Produces (db): `tickets.parentId` (`parent_id uuid null`, composite FK `(organisation_id, parent_id)
  → tickets(organisation_id, id)` on delete restrict, index), `tickets.statusBeforeJamId` (`uuid
  null`, FK to `project_statuses` scoped like `tickets_status_fk`), `tickets.origin` (`text not null
  default 'person'`, check in `('person','scan')`), `projectStatuses.isCancellation` (`boolean not null
  default false`; back-fill `true` where `key = 'cancelled'`), `projects.blockersStopCompletion`
  (`boolean not null default true`), table `ticketLinks` (`ticket_links`: id, organisation_id,
  source_ticket_id, target_ticket_id, kind text check in `('blocks','relates_to','duplicates')`,
  created_by → users, created_at; composite FKs to tickets; unique `(source_ticket_id,
  target_ticket_id, kind)`; check source ≠ target; indexes on source and target).
- Produces (shared, `tickets.ts`): `MAX_TICKET_DEPTH = 3`; `TICKET_LINK_KINDS = ['blocks',
  'relates_to', 'duplicates'] as const`; `LINK_CHOICES = ['blocks', 'blocked_by', 'relates_to',
  'duplicates', 'duplicated_by'] as const` (what a person picks); `linkLabel(kind, direction:
  'outward' | 'inward'): string`; `ticketRefSchema = { key, title, status: {key, name, category},
  archived: boolean }`; `progressSchema = { completed, inProgress, jammed, notStarted } (ints ≥ 0)`;
  `ticketLinkSchema = { id, kind, direction, label, ticket: ticketRefSchema }`; `childNodeSchema`
  (recursive: `ticketRefSchema.extend({ children: childNode[] })`); summary gains `parentKey: string |
  null`, `progress: Progress | null`, `openBlockerKeys: string[]`; detail gains `ancestors:
  TicketRef[]` (root first), `children: ChildNode[]`, `links: TicketLink[]`, `origin: 'person' |
  'scan'`; `projectSchema` gains `blockersStopCompletion: boolean`; `updateProjectBodySchema` gains
  `blockersStopCompletion: z.boolean().optional()`; bodies `setParentBodySchema = { parentKey: string |
  null }`, `addLinkBodySchema = { choice: LinkChoice, otherKey: string }`, `markDuplicateBodySchema =
  { originalKey: string }`.
- Produces (shared, `ticket-events.ts`): event types `ticket.parent_set` `{ parentKey: string | null,
  previousKey: string | null }`, `ticket.child_added` `{ childKey }`, `ticket.child_removed` `{ childKey
  }`, `link.added` `{ label, otherKey }`, `link.removed` `{ label, otherKey }`,
  `ticket.marked_duplicate` `{ originalKey }`, described with the exact copy in Global Constraints.

- [ ] **Step 1: Write failing tests.** `structure.test.ts` (runs migrations on `TEST_DATABASE_URL`
  like `heat-names.test.ts`): `marks only the cancelled status as a cancellation` (a fresh project:
  `cancelled` true, all others false); `refuses a self link` and `refuses the same link twice` (insert
  violates the check / unique); `refuses a parent in another workspace` (FK violation).
  `ticket-events.test.ts`: one `it.each` asserting each new event's description string exactly as in
  Global Constraints. `tickets.test.ts`: `linkLabel` for all five combinations.
- [ ] **Step 2: Run** `npm test -w packages/db -w packages/shared`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the schema, the generated migration plus `UPDATE "project_statuses" SET
  "is_cancellation" = true WHERE "key" = 'cancelled';`, `createProject` setting `isCancellation` from a
  new template field `cancellation: true` on the `cancelled` status in `DEFAULT_STATUS_TEMPLATE`, the
  shared schemas and descriptions. Add the new tables/columns to `docs/data-model.md`.
- [ ] **Step 4: Run** `npm test -w packages/db -w packages/shared && npm run typecheck`. Expected: PASS
  (API/web compile errors from new required summary fields are fixed in Task 5; if typecheck fails
  only there, make the new summary fields `.default()`-free but fill them with `null`/`[]` in
  `toSummary` now).
- [ ] **Step 5: Leave uncommitted.**

### Task 2: Parents in the API

**Files:**
- Create: `apps/api/src/tickets/structure.ts`, `apps/api/src/routes/ticket-structure.ts`,
  `apps/api/src/routes/ticket-parent.test.ts`, `apps/api/src/routes/parent.concurrency.test.ts`
- Modify: `apps/api/src/app.ts` (or wherever routes register) to register `ticketStructureRoutes`

**Interfaces:**
- Consumes: Task 1 schema and shapes; `TicketContext`, `archivedTicketError`, `addTicketEvent`,
  `loadTicketDetail`.
- Produces: `setParent(db, { context, ticketKey, parentKey: string | null }): Promise<TicketDetail>`;
  `lockInIdOrder(tx, organisationId, keys: string[]): Promise<Map<string, TicketRow>>` (shared by
  Tasks 3 and 4); route `PUT /api/v1/orgs/:orgId/tickets/:ticketKey/parent` (preHandler
  `tickets.edit`) → 200 `TicketDetail` of the child.

- [ ] **Step 1: Write failing tests** in `ticket-parent.test.ts`: `sets, changes and clears a parent`
  (history on child and both parents with the exact copy); `allows a parent in another project`;
  `refuses a ticket as its own parent` and `refuses a loop` (422, `parentKey` issue "WEB-1 is already
  under WEB-2, so it can't be its parent."); `refuses a fourth level` and `refuses a fourth level
  through the subtree` (design's message: "WEB-22 already has sub-tasks, so it can't go under WEB-27;
  that would make four levels"); `refuses a parent for an epic`; `refuses an archived parent` and `a
  parent in an archived project`; `does not change either version`; `needs tickets.edit` (read-only
  403); `404 for an unknown key or another workspace's ticket`. Also in `tickets.test.ts`-style:
  `refuses changing the type to Epic while the ticket has a parent` (via `PATCH`, 422 on `typeId`).
  `parent.concurrency.test.ts` (pattern of `tickets.concurrency.test.ts`): A→B and B→A sent at once,
  exactly one 200, and no cycle in the database.
- [ ] **Step 2: Run** `npm test -w apps/api -- ticket-parent parent.concurrency`. Expected: FAIL.
- [ ] **Step 3: Implement.** Depth and cycle checks run after locking: ancestors by walking
  `parent_id` from the new parent (at most 3 steps), subtree height by a recursive CTE from the child.
  The epic-type check goes in `updateTicket` (`findReferenceIssues` path) too.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Leave uncommitted.**

### Task 3: Links in the API

**Files:**
- Modify: `apps/api/src/tickets/structure.ts`, `apps/api/src/routes/ticket-structure.ts`
- Create: `apps/api/src/routes/ticket-links.test.ts`

**Interfaces:**
- Produces: `addLink(db, { context, ticketKey, choice: LinkChoice, otherKey }): Promise<TicketDetail>`
  (normalises `blocked_by` / `duplicated_by` to the stored direction; stores `relates_to` with the
  lower ticket id as source); `removeLink(db, { context, ticketKey, linkId }): Promise<void>`; routes
  `POST …/tickets/:ticketKey/links` → 201 `TicketDetail`, `DELETE …/tickets/:ticketKey/links/:linkId` →
  204 (404 if the link does not touch that ticket). Both `tickets.edit`.

- [ ] **Step 1: Write failing tests:** `adds each kind and shows it from both sides with the right
  label`; `stores relates-to once whichever side adds it` (adding B relates A after A relates B → 409
  `'These tickets are already linked that way.'`); `refuses a self link`; `refuses A blocks B when B
  blocks A` (422 "API-4 is already blocked by WEB-23, so it can't block it."); `allows two kinds
  between the same pair`; `links across projects`; `refuses an archived ticket on either side`;
  `removes a link even when one side is archived`; `writes history on both tickets`;
  `needs tickets.edit`.
- [ ] **Step 2: Run** `npm test -w apps/api -- ticket-links`. Expected: FAIL.
- [ ] **Step 3: Implement** using `lockInIdOrder`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Leave uncommitted.**

### Task 4: Blocker guard, Jammed memory, project setting and mark-as-duplicate

**Files:**
- Create: `apps/api/src/tickets/blockers.ts`, `apps/api/src/routes/ticket-blockers.test.ts`
- Modify: `apps/api/src/tickets/service.ts` (`updateTicket`), `apps/api/src/tickets/structure.ts`,
  `apps/api/src/routes/ticket-structure.ts`, `apps/api/src/routes/projects.ts`,
  `apps/api/src/routes/projects.test.ts`

**Interfaces:**
- Produces: `openBlockersOf(executor, organisationId, ticketIds: string[]): Promise<Map<string,
  string[]>>` (ticket id → open blocker keys, ordered by key; used by Task 5's read model too);
  `completionRefusal(executor, { organisationId, ticket: { id, key, projectId }, target: { name,
  category, isCancellation } }): Promise<string | null>` (the refusal message, or null);
  `markDuplicate(db, { context, ticketKey, originalKey }): Promise<TicketDetail>`; route `POST
  …/tickets/:ticketKey/mark-duplicate` (`tickets.edit`) → 200.

- [ ] **Step 1: Write failing tests** in `ticket-blockers.test.ts`: `refuses done while a blocker is
  open` (exact message); `lists every open blocker in the message` ("… while API-4 and OPS-2 are
  open."); `allows scrapping a blocked ticket`; `allows done once the blocker is quenched`; `a
  reopened blocker blocks again`; `a scrapped blocker no longer blocks`; `an archived open blocker
  still blocks`; `allows done when the project setting is off` (setting on the blocked ticket's
  project, blocker in another project with it on); `bulk reports the refusal per ticket` (via `POST
  /tickets/bulk`); `remembers the status before Jammed and clears it on leaving` (read
  `status_before_jam_id` from the db); `marks a duplicate: links and scraps in one go` (history
  copy); `refuses marking a quenched ticket as a duplicate` (422, nothing changed, no link);
  `refuses an archived original`. In `projects.test.ts`: `turns the blocker setting off and on`
  (`projects.manage`; a member gets 403; `GET` project shows `blockersStopCompletion`).
- [ ] **Step 2: Run** `npm test -w apps/api -- ticket-blockers projects`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `updateTicket`, when the status changes: call `completionRefusal` and
  push its message as a `statusId` issue; set `statusBeforeJamId` to the old status when the target
  key is `blocked`, null when leaving it. `markDuplicate` reuses the move path inside its transaction
  (find the project's `is_cancellation` status, check the transition, add the `duplicates` link).
- [ ] **Step 4: Run** the same, then the whole API suite `npm test -w apps/api`. Expected: PASS (fix
  existing tests only where the new summary fields appear in exact-equality assertions).
- [ ] **Step 5: Leave uncommitted.**

### Task 5: Read model, filters and tree listing

**Files:**
- Modify: `apps/api/src/tickets/read.ts`, `apps/api/src/tickets/query.ts`,
  `packages/shared/src/ticket-filters.ts`, `packages/shared/src/ticket-filters.test.ts`,
  `packages/db/src/seed-tickets.ts`, `packages/db/src/seed-tickets.test.ts`
- Create: `apps/api/src/tickets/structure-read.ts`, `apps/api/src/routes/ticket-structure-read.test.ts`

**Interfaces:**
- Produces: summaries with `parentKey`, `progress`, `openBlockerKeys` (empty for completed tickets);
  details with `ancestors`, `children` (full subtree, ordered by key), `links` (grouped order: Blocked
  by, Blocks, Relates to, Duplicates, Duplicated by), `origin`. Filters (URL names in brackets):
  `parent` [`parent`] ticket key, `epic` [`epic`] ticket key (any depth), `hasBlocker` [`blocked`]
  boolean optional, `linkedTo` [`linked`] ticket key, `topLevel` [`top`] boolean default false,
  `tree` [`tree`] boolean default false. List response gains `rows?: { ticket: TicketSummary; depth:
  number; context: boolean }[]` when `tree` is on (`context` = greyed ancestor that does not match).
- Demo data: existing seed tickets gain structure **without adding or removing tickets** (existing
  counts and e2e expectations hold): one WEB epic with three children, one child with a sub-task, one
  child in another project, and one open `blocks` link onto a ticket in an in-progress status.

- [ ] **Step 1: Write failing tests:** `summaries carry parent, progress and open blockers`;
  `progress counts all descendants and leaves out scrapped`; `a completed ticket shows no open
  blockers`; `the detail has ancestors, the child tree and grouped links`; one test per filter
  (`parent`, `epic` any depth, `blocked` yes/no, `linked`, `top`); `tree mode pages by top level`
  (pageSize 2, matches spread across trees, a matching child under a greyed non-matching parent,
  `total` counts matches only); `a child whose parent is in another project shows under it on a
  project list`; shared parser round-trip for the new URL names. Seed test: the epic has its children
  and the blocker link exists.
- [ ] **Step 2: Run** `npm test -w apps/api -- ticket-structure-read ticket-list && npm test -w
  packages/shared -w packages/db`. Expected: FAIL.
- [ ] **Step 3: Implement.** Batch the extra reads for a page (one query each for parents, progress
  via a recursive CTE over the page's ids, and `openBlockersOf`), never one per ticket.
- [ ] **Step 4: Run** all API, shared and db tests. Expected: PASS.
- [ ] **Step 5: Leave uncommitted.**

### Task 6: The ticket page

**Files:**
- Create: `apps/web/src/components/tickets/child-tickets.tsx`, `apps/web/src/components/tickets/ticket-links.tsx`,
  `apps/web/src/components/tickets/ticket-progress.tsx`, `apps/web/src/components/tickets/ticket-picker.tsx`,
  `apps/web/src/lib/structure.ts`, `apps/web/src/lib/structure.test.ts`, `tests/e2e/structure.spec.ts`
- Modify: `apps/web/src/app/(app)/w/[slug]/tickets/[ticketKey]/page.tsx`, `apps/web/src/components/tickets/ticket-fields.tsx`,
  `apps/web/src/components/tickets/ticket-actions-menu.tsx`, `apps/web/src/components/board/card-menu.tsx`,
  `apps/web/src/components/command/ticket-commands.tsx`, `apps/web/src/lib/ticket-actions.ts`

**Interfaces:**
- Produces (`lib/ticket-actions.ts`): `setParent(slug-scoped api, ticketKey, parentKey | null)`,
  `addLink(…, ticketKey, choice, otherKey)`, `removeLink(…, ticketKey, linkId)`, `markDuplicate(…,
  ticketKey, originalKey)`, following the existing action functions' shape and error handling.
  (`lib/structure.ts`): `progressSegments(progress): { bucket, count, percent }[]`,
  `blockedLine(keys: string[]): string` ("Blocked by API-4", "Blocked by API-4 and OPS-2").
  `TicketPicker` (search by key or title through the existing search endpoint, hides archived).

- [ ] **Step 1: Write failing tests:** unit tests for `progressSegments` and `blockedLine`. E2E in
  `structure.spec.ts`: `a parent shows its children, progress and breadcrumb` (seed epic);
  `adds a new child and an existing ticket as children, and removes one`; `sets and clears the parent
  from Details`; `links and unlinks a ticket, shown from both sides`; `a blocked ticket says so at the
  top of the bar and can't be quenched` (message in the status control's error); `marks a ticket as a
  duplicate from the actions menu, the card menu and the command menu`; `a read-only account sees no
  add, remove or link controls`.
- [ ] **Step 2: Run** `npm test -w apps/web -- structure && npx playwright test structure`. Expected:
  FAIL.
- [ ] **Step 3: Implement** to layout A: breadcrumb above the title; Child tickets section under the
  description (expandable rows, "+ Add a child ticket", "Add an existing ticket"); right bar order:
  blocked line, Progress, Details (with Parent), Links. Leave the space under the children for the
  later Code section (no placeholder shown).
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Leave uncommitted.**

### Task 7: The board: chips, top level only, project lanes

**Files:**
- Modify: `packages/shared/src/board-display.ts` (+ test), `apps/web/src/components/board/card.tsx`,
  `apps/web/src/components/board/board.tsx`, `apps/web/src/components/board/column.tsx`,
  `apps/web/src/components/board/display-menu.tsx`, `apps/web/src/lib/board.ts` (+ test)
- Create: `apps/web/src/components/board/lane.tsx`, `tests/e2e/board-structure.spec.ts`

**Interfaces:**
- Produces: `boardDisplaySchema` gains `show: 'all' | 'top'` (default `all`) and `lanes: 'none' |
  'project'` (default `none`; only offered on the Tickets board); `lanesOf(board, lanes):
  { project: {key, name}; columns: BoardColumnData[] }[]`; `canMoveTo` refuses a drop whose lane
  project differs from the card's project.

- [ ] **Step 1: Write failing tests:** unit: `lanesOf` groups by project in key order, keeps column
  order and hidden columns; `refuses a drop into another lane`; display prefs round-trip and undo.
  E2E: `a parent card shows progress and a child card its parent`; `a blocked card shows its blocker`;
  `top level only hides child cards and is remembered`; `lanes per project on the Tickets board, with
  counts and collapse`; `dragging a blocked card to Quenched is refused with the message and the card
  returns`; `a card can't be dropped into another project's lane`.
- [ ] **Step 2: Run** `npm test -w packages/shared -w apps/web -- board && npx playwright test
  board-structure`. Expected: FAIL.
- [ ] **Step 3: Implement.** Top level only filters on `parentKey === null` client-side over the
  loaded board and also passes `top=1` to the API so column totals agree.
- [ ] **Step 4: Run** the same plus `npx playwright test board tickets-board`. Expected: PASS.
- [ ] **Step 5: Leave uncommitted.**

### Task 8: The list: tree and new filters

**Files:**
- Modify: `apps/web/src/components/tickets/ticket-table.tsx`, `apps/web/src/components/tickets/ticket-list-view.tsx`,
  `apps/web/src/components/tickets/view-tabs.tsx`, `apps/web/src/components/tickets/filter-bar.tsx`,
  `apps/web/src/components/tickets/filter-popover.tsx`, `apps/web/src/lib/tickets.ts` (+ test),
  `apps/web/src/lib/saved-views.ts` (+ test)
- Create: `tests/e2e/list-structure.spec.ts`

**Interfaces:**
- Consumes: Task 5 `rows` and filter names.
- Produces: a **Tree** switch beside the view tabs (URL `tree=1`); a Parent column in flat mode;
  filter chips "Parent: WEB-20", "Epic: WEB-20", "Has blocker: Yes/No", "Linked to: WEB-3",
  "Top level only".

- [ ] **Step 1: Write failing tests:** unit: chip text for each new filter; saved views keep them.
  E2E: `tree mode nests children and greys context rows`; `expand and collapse a parent`; `each new
  filter narrows the list and survives a reload and a saved view`; `bulk select works in tree mode`;
  `j and k walk rows in tree mode`.
- [ ] **Step 2: Run** `npm test -w apps/web && npx playwright test list-structure`. Expected: FAIL.
- [ ] **Step 3: Implement.** Context rows are not selectable and not inline-editable.
- [ ] **Step 4: Run** the same plus `npx playwright test tickets bulk shortcuts`. Expected: PASS.
- [ ] **Step 5: Leave uncommitted.**

### Task 9: Project Settings tab, docs and the full gate

**Files:**
- Create: `apps/web/src/app/(app)/w/[slug]/projects/[key]/settings/page.tsx`,
  `apps/web/src/components/projects/blocker-setting.tsx`, `tests/e2e/project-settings.spec.ts`
- Modify: `apps/web/src/app/(app)/w/[slug]/projects/[key]/layout.tsx` (Settings tab only with
  `projects.manage`), `docs/architecture.md`, `docs/workflows.md` (parents, links, the guard,
  `is_cancellation`), `docs/security.md` (new routes and permissions), `docs/data-model.md`,
  `docs/testing.md` (new counts), `docs/known-limitations.md`, `README.md`

**Interfaces:**
- Consumes: Task 4 `PATCH projects/:key { blockersStopCompletion }`.

- [ ] **Step 1: Write failing e2e:** `an admin turns the blocker rule off and a blocked ticket can then
  be quenched`; `a member sees no Settings tab and the page answers not found`.
- [ ] **Step 2: Run** `npx playwright test project-settings`. Expected: FAIL.
- [ ] **Step 3: Implement** the tab (switch labelled "Tickets with an open blocker can't be
  completed") and update the docs.
- [ ] **Step 4: Full gate:** `npm run typecheck && npm run lint && npm run format:check && npm test &&
  npm run test:e2e`, then the fresh LF copy check used in earlier phases. Expected: all pass; record
  counts in `docs/testing.md`.
- [ ] **Step 5: Leave uncommitted;** report to the owner, who decides when to commit.
