# P1: Everyday speed — design

Part of the ticket-system roadmap (`2026-10-23-ticket-system-roadmap.md`, phase P1), which the owner
approved with "implement it" and continued with "lets do the next". This document fixes the details
the roadmap left open. Every point below marked **(call)** is my decision on the owner's behalf; the
owner can overturn any of them.

## Goal

The common things people do with tickets take one or two keystrokes or clicks, from wherever they
are: create, move, assign, reprioritise, copy, duplicate, archive, find, and change many at once.

## What is in

1. **Archive and unarchive** a ticket (Part B5). An archived ticket is **read-only** until it is
   unarchived: edits and new comments are refused with `409` and a message **(call)**. It drops out
   of the list and boards (as today) unless the "archived" filter is on. Needs `tickets.edit`.
   History lines: "archived this ticket", "unarchived this ticket".
2. **Duplicate** a ticket (Part B5). The copy is "Copy of <title>" (cut to 200 characters), in the
   same project, with the same type, priority, labels, component, due date, estimate and description;
   it starts in the project's initial status; the assignee is copied only when the person may assign
   **(call)**. Comments and history are not copied. Needs `tickets.create`. The copy's history starts
   "created this ticket" then "duplicated this from WEB-3". Opening the copy follows.
3. **Quick create in a column**: a "+" in each board column's header opens a one-line form at the
   top of that column: a title, and on the Tickets board a project select. Enter creates the ticket
   **in that column's status** with the default type (Task) and priority (Normal) **(call: any active
   status may be chosen at creation, like a Jira board; the workflow governs moves, not creation)**.
   Escape closes it. The API's create body gains an optional `statusId`.
4. **Card actions**: the card's menu (today "Move to") becomes the card's actions: Move to, Priority,
   Assign to me / Unassign / a member (when the person may assign and see members), Copy key, Copy
   link, Duplicate, Archive.
5. **Ticket page actions**: an actions menu next to the title with Copy key, Copy link, Duplicate,
   Archive or Unarchive; an archived ticket shows an "Archived" banner with Unarchive.
6. **Inline edits in the list**: the Status, Priority and Assignee cells are buttons that open a small
   menu. Status offers only moves the ticket's workflow allows. Due dates are not edited inline
   **(call)**. The web gets every project's workflow from a new `GET /workflows` route.
7. **Bulk edit from the list**: a checkbox on each row and one in the header (this page); with any
   selected, a bar shows "N selected" and actions: Move to (status by key), Priority, Assign, Add
   label, Remove label, Due date, Archive. One request, `POST /tickets/bulk`, up to 100 tickets. Each
   ticket is changed in its own transaction against its **current** version (bulk means "apply to
   these tickets as they are now") **(call)**; the answer lists each ticket's result, and the bar
   reports "Changed 8 of 10. 2 could not be changed:" with each reason (a status the workflow does
   not allow, an archived ticket, no permission). Partial success is never hidden. Bulk on the board
   is not in P1 **(call)**.
8. **Command menu** (Ctrl+K, or Cmd+K on a Mac), from any workspace page: type to find tickets by key
   or title (up to 8), projects, saved views and pages; on a ticket page it also offers that ticket's
   actions (Assign to me, Unassign, Move to <each allowed status>, Copy key, Copy link, Duplicate,
   Archive or Unarchive), and everywhere "Create ticket". Arrow keys move, Enter runs, Escape
   closes. Built on the project's own popover/dialog patterns; no new dependency **(call)**.
9. **Keyboard shortcuts**, each also reachable with the mouse, ignored while typing in a field:
   - `?` shows the shortcut sheet; `Ctrl/Cmd+K` command menu; `/` focuses the search box;
   - `c` new ticket (the new-ticket page, with the project chosen when on a project's page);
   - `g` then `p` / `t` / `b`: Projects, Tickets list, Tickets board;
   - on the list: `j` / `k` move the row focus, `Enter` opens, `x` selects the focused row;
   - on a ticket page: `a` assigns it to me, `m` opens Move to.
10. **Copy key / Copy link** wherever a ticket's actions are.

## What is out (moved or deferred)

- **Ticket templates** move to P4 (configuration): they need a place to manage them **(call)**.
- Bulk edit on the board; inline due-date editing; remembering the last Tickets tab.

## Rules that hold everywhere

- Every action is an API route with a permission check; the screens only hide what the API refuses.
- A refused action says why, in a toast or next to the control, and changes nothing on screen.
- Every new control works with a keyboard and has an accessible name.
- Plain text only (P3 changes that, not P1).

## Seams kept for later

- Archive and the bulk route go through the same ticket update path, so the security gate's
  automatic changes (later) can reuse it.
- `GET /workflows` is the one source of "where can this ticket go" for list, bulk and command menu.
