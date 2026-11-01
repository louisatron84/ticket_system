# P6: Planning — design

Date: 2026-10-30. Built so far: all five slices: 1 (backlog, estimates), 2 (milestones), 3 (cycles), 4 (timeline) and 5 (reports), 2026-10-30.
Status: the owner said "go ahead" to building P6 from the roadmap without further
questions (2026-10-30), so every choice below that the roadmap does not already state is **my call**
and is marked as one.

## Why

Teams need to decide what comes next and see whether they will get there: an ordered backlog, sized
work, time boxes for teams that use them, dated goals, and numbers that show how the work is going.
The roadmap (`2026-10-23-ticket-system-roadmap.md`, P6) lists the parts. The board stays the place
for the work in hand; planning lives on its own tabs so a Kanban team never sees it unless it wants
to (the roadmap's "optional per project").

## Goals

1. **Backlog** with manual ranking: drag to reorder, stored as a rank so one move changes one row.
   Rank is a sort option everywhere.
2. **Estimates**: each project uses points (a fixed scale) or time. One system per project.
3. **Milestones**: a dated goal that groups tickets, with progress and a health flag.
4. **Cycles**, switched on per project: planned scope, carry-over of unfinished work, a burndown.
5. **Timeline** of epics and milestones; blocked-by links drawn as dependencies.
6. **Reports**: created vs resolved, cumulative flow, throughput, lead and cycle time, burndown and
   burnup, velocity (with cycles), age in status.

## Non-goals

- Capacity per person, holidays, working-day calendars (my call: capacity is one number per cycle).
- Scenario planning, Gantt editing of dates by drag on the timeline (the timeline is read-only in P6;
  dates are edited on the ticket and the milestone) — my call.
- Portfolio views across workspaces.

## Anti-goals

- Planning screens that appear for a team that has not switched them on.
- A rank change that rewrites hundreds of rows, or that conflicts with someone editing the ticket.

## Slices (built in this order)

### Slice 1 — Backlog ranking and estimates

- **Rank** (`tickets.rank`, text in the `C` collation): a fractional index (base 62, integer head +
  fraction, the well-known "fractional indexing" scheme, written in `@forge/shared` with no new
  dependency — my call). A move computes a key between its two new neighbours, so it updates one row.
  - Existing tickets are backfilled per project: highest priority first, then oldest first (my call).
  - A new ticket goes to the **bottom** of its project's backlog (my call; the project row is already
    locked while the ticket number is claimed, so two creates never get the same rank).
  - Moving: `POST /api/v1/orgs/:orgId/tickets/:key/rank` with `{ after?: key, before?: key }`
    (the neighbours it should sit between; one may be missing for top/bottom). Needs `tickets.edit`.
    Both neighbours must be in the same project. The project row is locked for the move, so
    concurrent moves serialise.
  - A rank change does **not** bump the ticket's version, `updatedAt`, or write history (my call: it
    is ordering, not an edit; it must never cause an edit conflict or reshuffle "recently updated").
    It is audited as `ticket.ranked`.
  - If a computed key would be longer than 64 characters, the project's ranks are rewritten evenly in
    the same transaction (rare; my call).
  - `sort=rank` is added to the shared sorts (ascending = top of the backlog first).
- **Backlog tab** on each project (`/w/<slug>/projects/<KEY>/backlog`): open tickets (status category
  not completed, not archived, not in triage) in rank order; drag to reorder, plus "Move to top",
  "Move up", "Move down", "Move to bottom" from each row's menu and Alt+↑/↓ for the keyboard (my call:
  drag alone is not accessible). Shows each ticket's estimate and the total. Read-only for people who
  cannot edit.
- **Estimates**: `projects.estimation` = `time` (default, today's behaviour) or `points`.
  - Points use the fixed scale 0, 1, 2, 3, 5, 8, 13, 21 (my call) in `tickets.estimate_points`.
  - Switching keeps both stored values; only the project's current system is shown and counted (my
    call: switching back loses nothing).
  - The `needs_estimate` move rule checks the project's current system.
  - Project Settings gets an "Estimates" choice (`projects.manage`).

### Slice 2 — Milestones

- `milestones` table per project: name (1–80), description, target date (optional), health
  (`on_track`, `at_risk`, `off_track`; set by people, not computed — my call), closed at.
- `tickets.milestone_id` (same project, composite FK). Picker on the ticket page and create form;
  `milestone` filter (`milestone=<id>` or `none`).
- **Milestones tab** per project: each milestone with progress (done / total and estimate done /
  total), target date, health, overdue marker; create/edit/close/reopen/delete (delete only when no
  tickets point at it, else close — my call). Managing needs `tickets.edit` (my call: milestones are
  planning, not configuration).
- History records milestone changes on tickets.

### Slice 3 — Cycles

- `projects.cycles_enabled` (default off) and `projects.cycle_length_days` (7–28, default 14).
- `cycles` table: number, name (default "Cycle N"), start date, end date, capacity (estimate units,
  optional), state `planned` / `active` / `completed`. At most one active per project.
- `tickets.cycle_id`. Start a cycle (records the planned scope), complete a cycle (unfinished tickets
  move to the next planned cycle, made if missing, or back to the backlog — the person chooses).
- Every time a ticket joins or leaves a cycle a row goes into `cycle_scope_changes` (cycle, ticket,
  added/removed, when). The burndown is computed from those rows and the tickets' completion times,
  not from daily snapshots, so no background job is needed (my call; this replaces reading history
  text, which only keeps names). It uses each ticket's current estimate and current completion time
  (my call: a ticket reopened after the cycle no longer counts as done).
- Starting records the planned scope (tickets and estimate) on the cycle; completing records what
  was done, which gives velocity. Only one cycle is active per project (a partial unique index).
- Only a planned cycle with no tickets can be deleted (my call). A completed cycle takes no tickets.
  Duplicating a ticket does not copy its cycle (my call).
- Managing cycles needs `tickets.edit`; switching cycles on and the length need `projects.manage`.
- **Cycles tab**, only when on: the active cycle with scope, done, remaining, capacity and a
  burndown chart; planned cycles (start, edit, delete); completed cycles with planned vs done.
  Tickets join a cycle from a picker on each backlog row, the ticket page and the create form.
- `cycle` filter on lists (`cycle=<id>` or `none`).

### Slice 4 — Timeline

- `tickets.start_date` (optional). Timeline tab per project: epics (type `epic`) as bars from start to
  due date and milestones as diamonds on their target date; `blocks` links between shown items as
  arrows. Read-only; months/weeks zoom.

### Slice 5 — Reports

- Reports tab per project, computed from tickets and their history over a chosen range (last 30 / 90
  days): created vs resolved, throughput per week, cumulative flow by status category, lead time
  (created → done) and cycle time (first in-progress → done) medians and 85th percentiles, age of
  open tickets in their current status, and with cycles on: burndown/burnup of the active cycle and
  velocity of the last six cycles. Charts are inline SVG, no chart library (my call).

## Constraints

- Every new route is tenant-scoped through `orgAccess`; ids that cross tables are checked by composite
  foreign keys (same pattern as the rest of the schema).
- Text limits and control-character rules match existing ticket fields.
- Planning tabs appear only where they apply (Cycles only with cycles on).

## Left to the builder

Layout details, empty states, exact copy, chart styling within the existing tokens.
