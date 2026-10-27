# P2: Structure (design)

Phase P2 of the [ticket-system roadmap](2026-10-23-ticket-system-roadmap.md#p2-structure-about-9-tasks-builds-part-b2):
tickets that have parts (sub-issues and epics), typed links between tickets, blockers that are
visible and enforced, one-action duplicate resolution, and the screens and filters that show all of
it. Mockups the owner picked from are in `.superpowers/brainstorm/3113-1793125998/content/`
(`parent-ticket.html` option A, `board-structure.html` option A).

Decisions marked **(owner)** were made by the owner; **(my call)** were made by me and can be
overridden; everything else follows the approved roadmap.

## Why

Real work does not come in one size. A feature is a handful of tickets, and some of those wait on
others. Today Forge can only show a flat pile, so the shape of the work lives in people's heads. P2
lets a big ticket hold its parts, shows how far along it is, and makes "this can't finish until that
does" something Forge knows and enforces.

It is also the groundwork for the security gate (roadmap, "The security gate"): a merge's ticket will
be **blocked by** a finding ticket and cannot be finished, or merged, until the finding is fixed. P2
builds the links, the guard and the small seams the gate needs, so the gate drops in later without
rework.

## Goals

1. A ticket can have a parent, up to three levels: epic, ticket, sub-task.
2. A parent shows its progress, rolled up from its children.
3. Tickets can be linked: blocks / is blocked by, relates to, duplicates / is duplicated by.
4. A ticket with an open blocker shows it everywhere it appears, and cannot be completed as done.
5. "Mark as duplicate of X" links and scraps a ticket in one action.
6. The list can show the tree; the board can hide child tickets; the workspace Tickets board can
   show a swimlane per project.
7. New filters: parent, epic, has blocker, linked to.

## Non-goals (this phase)

- **Code in the ticket** (owner's idea; repo phase). The ticket page keeps room for a Code section
  under the description, but nothing is built.
- **The security gate itself**, scans, findings and merges (repo phase). Only its seams are built.
- **Swimlanes per epic, per assignee or per priority.** Lanes are per project only.
- **Rolling up anything but progress** (no summed estimates, no derived due dates). (my call)
- **Bulk "set parent"** or bulk linking. (my call)
- **CLI commands** for any of this (step 4 of the overall roadmap).
- **Automatic moves.** Adding a blocker does not move a ticket to Jammed, and removing the last one
  does not move it back. A person moves it. The gate will be the first thing that moves tickets by
  itself. (my call)

## The ticket page (owner picked layout A)

The page keeps its present shape: main column on the left, details bar on the right.

**Left, top to bottom:** title; a breadcrumb of its ancestors above the title (`WEB-20 New checkout ›
WEB-22 Wallet buttons`), each a link; description; **Child tickets**; (later) Code; activity.

- **Child tickets** is a list of the direct children, each row showing the status symbol, key, title
  and status name; a child that has children of its own can be expanded in place to show them,
  indented. The heading says "Child tickets · 3 of 7 quenched". A "+ Add a child ticket" row at the
  bottom opens a small form (title only; the child gets the parent's project, the Task type, the
  Flame priority and its project's initial status, like quick create on the board), and an "Add an
  existing ticket" choice picks a ticket by key or title. Each row has a way to remove that child
  from the parent (it becomes top level; nothing is deleted).
- The section is shown only when the ticket has children, or the person can add one.

**Right bar, top to bottom:**

- **Progress** (only for a ticket with children): a segmented bar and counts for Quenched (completed),
  In progress, Jammed and Not started. (my call) It counts **all descendants**, not only direct
  children, so an epic's bar reflects sub-tasks too. Scrapped descendants are left out of both the
  count and the total, so cancelling work does not look like progress or like a gap. Jammed means a
  descendant whose status key is `blocked`; the other buckets are status categories.
- **Details:** as today (status, priority, assignee, and the rest), plus **Parent**, a field that can be
  set, changed or cleared.
- **Links:** grouped by wording ("Blocked by", "Blocks", "Relates to", "Duplicates", "Duplicated by"),
  each entry a key and title linking to that ticket, with its status symbol. An open blocker is shown
  in the Jammed colour. "+ Link a ticket" opens a picker: kind, then ticket. Each entry can be
  removed.
- If the ticket has an open blocker, a line at the top of the bar says so ("Blocked by API-4") so it
  is seen before anything else.

## The board (owner picked A, plus lanes)

- **Every ticket is a card**, children included.
- A **parent card** shows a small progress bar and "3/7" (same counting as the ticket page).
- A **child card** shows its parent's key ("↑ WEB-20"), linking to the parent.
- A **blocked card** shows "⛔ API-4" (the first open blocker, "+1" if more) in the Jammed colour.
- The Display menu gets **Show: All tickets / Top level only**. Top level only hides any ticket that
  has a parent. Stored with the person's other board settings, separately for the project board and
  the Tickets board (they already keep separate settings).
- **Swimlanes per project (owner).** The owner wants lanes per repository; a project is a repository
  (owner: "a forge project is like a github repo"), so lanes are per project and become repository
  lanes when repositories exist. The Display menu on the **workspace Tickets board** gets **Lanes:
  None / Project**. Each lane has a header with the project's key and name and its ticket count, and
  can be collapsed. Columns line up across lanes. A card can be dragged between columns within its
  lane; dropping it into another lane is refused (a ticket cannot change project by dragging). (my
  call) The project board, which shows one project, has no lanes setting.
- Hidden columns and column order apply to every lane the same way.

## The list

- A **Tree** switch next to the view tabs shows parents with their children nested under them,
  expandable, indented, with the same filters applied (a child that matches a filter shows under its
  parent even if the parent itself does not match, with the parent greyed). (my call) Sorting applies
  within each level.
- Off (the default) the list stays flat, as now, with a parent column available.
- Bulk select works in both modes.

## Rules

### Parents

- **(my call)** A parent can be in **any project of the same workspace**, not only the child's
  project, because an epic often spans projects (front end and API). Each ticket still belongs to
  exactly one project.
- At most **three levels**: a ticket's depth (top level is 1) plus the height of its own subtree must
  stay at or below 3. Setting a parent that would break this is refused with a plain message ("WEB-22
  already has sub-tasks, so it can't go under WEB-27; that would make four levels").
- **No cycles.** A ticket cannot be its own ancestor. Checked inside the transaction that sets the
  parent, with the affected rows locked so two people cannot create a loop at once.
- **(my call)** An **Epic** (the existing ticket type `epic`) must be top level: it can have children
  but no parent. Setting an epic's parent, or changing the type of a ticket with a parent to Epic, is
  refused. Any other type can be a parent.
- Archiving or scrapping a parent leaves its children as they are. An archived parent still shows as
  the parent.
- Changing a parent needs `tickets.edit` on the child (versions: see "Settled after the builder
  check"), and is recorded in the child's history ("set the parent to WEB-20") and in
  the parent's ("added WEB-22 as a child").

### Links

- Kinds: `blocks`, `relates_to`, `duplicates`. Each link is **stored once** with a source and a target
  and is shown from the other side with the inverse wording (`blocks` ↔ "is blocked by", `duplicates`
  ↔ "is duplicated by", `relates_to` reads the same both ways).
- For `relates_to`, (my call) the pair is stored in a fixed order so A-relates-B and B-relates-A are
  the same row.
- No self links. No duplicate links (the same pair and kind twice is refused). A pair may have more
  than one kind (A blocks B and A relates to B).
- **(my call)** A blocks B and B blocks A at the same time is refused (it could never be resolved).
  Longer blocking loops are allowed; they are rare and can be undone.
- Links may cross projects in the same workspace, never workspaces.
- Adding or removing a link needs `tickets.edit` on either of the two tickets and view access to both.
  It is recorded in **both** tickets' history.
- Links are a table with a `kind`, so links to pull requests, branches and commits can be a second
  table later without changing this one (roadmap seam).

### Blockers

- An **open blocker** of a ticket is a ticket that blocks it and whose status category is not
  `completed`. A Quenched blocker no longer blocks; neither does a Scrapped one. (my call) An archived
  blocker that is not completed still blocks, because archiving is not fixing.
- **The guard (owner):** while a ticket has an open blocker it **cannot be moved to a completed status
  that means done**. It **can always be scrapped** (owner: "it can be scrapped even if blocked").
- To tell "done" from "scrapped" without relying on a status name, (my call) each project status gets
  a boolean **`is_cancellation`**: true for the default `cancelled` (Scrapped) status, false for the
  rest. The guard applies to moves into a `completed` status where `is_cancellation` is false.
  Workflow configuration (P4) will let people set it on statuses they add.
- The guard is a **project setting**, on by default: "Tickets with an open blocker can't be completed".
  Only people allowed to manage the project can turn it off. (my call) Its UI is a switch on the
  project's settings page; if that page has no room for settings yet, a single switch section is
  added.
- The guard lives in **one function** that any action can ask ("does this ticket have open
  blockers?"), so the gate can later use it to stop a merge too (roadmap seam). Every way of moving a
  ticket goes through it: the ticket page, the board, bulk edit, the command menu and shortcuts.
- A refused move says why and names the blockers: "WEB-23 can't be quenched while API-4 is open."
  Bulk edit reports it per ticket like other refusals.

### Duplicate resolution

- "Mark as duplicate of…" (ticket page actions menu, card menu, command menu) asks for the original
  ticket, then in **one transaction** adds the `duplicates` link and moves the ticket to its project's
  cancellation status. The history says "marked this as a duplicate of WEB-3".
- If the ticket's workflow has no allowed move from its current status to the cancellation status
  (for example a Quenched ticket, whose only move is to reopen), nothing changes and the person is
  told why. It needs `tickets.edit`.

### Small seams for the security gate (roadmap)

Built now, unused by any screen yet:

- When a ticket moves **into** the status with key `blocked`, the ticket remembers the status it came
  from (`status_before_jam_id`); it is cleared when it leaves. The gate will use it to put a ticket
  back where it was.
- Tickets get an **`origin`**, `person` for every ticket made today; the gate will add `scan`.
- History events already carry `source` (`user` or `system`); system-made changes will name the rule
  that made them. Nothing in P2 writes `system` events.

## Filters

Added to the shared filter model, the URL format and saved views, for the list and both boards:

- **Parent**: tickets whose direct parent is a given ticket (by key).
- **Epic**: tickets anywhere under a given epic (any depth), by key.
- **Has blocker**: yes or no (open blockers only).
- **Linked to**: tickets with any link, of any kind, to a given ticket.
- **Top level only** is the board switch above; the list gets it as a filter too, so the two agree.

## Data (outline; the plan sets the details)

- `tickets.parent_id` (nullable), a same-workspace foreign key to `tickets`; an index on it.
- `tickets.status_before_jam_id` (nullable), `tickets.origin` (`person` default, checked).
- `project_statuses.is_cancellation` (boolean, default false; migration sets it true for key
  `cancelled`).
- `projects.blockers_stop_completion` (boolean, default true), or the project's settings store if one
  exists.
- `ticket_links`: id, workspace, source ticket, target ticket, kind, created by, created at; foreign
  keys scoped to the workspace; unique (source, target, kind); a check that source ≠ target.
- New history event types for parent set/cleared, child added/removed, link added/removed and marked
  as duplicate.
- Ticket summaries (list and board) carry what cards need without extra requests: parent key, child
  progress counts, open blocker keys.

## Testing

As in earlier phases: the rules (depth, cycles, epic top level, link validity, the guard and its
exceptions, duplicate resolution) get API tests against real Postgres, including the concurrent
parent case; pure helpers (progress counting, tree building) get unit tests; the screens get browser
tests for the ticket page sections, card chips, the top-level switch, lanes, the tree list, the new
filters, the guard's refusal message on each way of moving, and read-only accounts seeing no edit
controls. A migration test like `heat-names.test.ts` checks `is_cancellation` back-fill.

## Settled after the builder check (all my calls)

1. **Versions.** Parent changes and links are relationship writes, like comments: they **neither
   check nor bump** either ticket's `version`, so nobody with either ticket open gets a 409 because a
   child or link was added. (This replaces "uses the child's version number" above.) Each such write
   locks the two tickets' rows **in id order** in one transaction, then runs its checks (depth,
   cycles, duplicates, archived), so concurrent writes cannot create a loop or deadlock. History is
   still written on both tickets. Setting the parent from the child's Details field goes through the
   same parent route, not the versioned ticket update.
2. **Archived tickets.** A new parent, child, link or duplicate original can never involve an
   archived ticket or a ticket in an archived project; that is refused with the existing archived
   message, and the pickers do not offer such tickets. **Removing** an existing child or link is
   allowed even when one side is archived (it is cleanup), and writes history on both sides.
3. **Tree mode and paging.** A page holds up to 50 **top-level rows**, each shown with its whole
   subtree (at most three levels). A matching child whose ancestors do not match is shown under them,
   with the ancestors greyed; greyed rows do not count toward the total, which counts matching
   tickets. On a project's list, a child whose parent is in another project is shown under that
   parent, greyed, so the tree never lies about where a ticket sits. Flat mode is unchanged.
4. **Blocking a ticket that is already done.** Allowed (the link records a fact). But "blocked"
   only applies to a ticket that is not completed: a completed ticket shows no ⛔ chip, does not count
   for "Has blocker: yes", and the guard only matters if it is reopened.
5. **Whose setting.** The **blocked ticket's** project setting decides, wherever the blocker lives.
   The shared function is "can this ticket be completed as done?" given the ticket; it reads that
   ticket's project setting and its open blockers.
6. **Where the setting lives.** A new **Settings** tab on a project (`/projects/<key>/settings`),
   shown only to people who can manage projects (`projects.manage`), holding this one switch for now.
   The API enforces the same permission.

## Left to the builder

Exact API route shapes, component structure, how progress counts are computed (query or summary
table), lane collapse persistence, the order of tasks, and wording of messages other than those
quoted.
