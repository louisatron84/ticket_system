# P5: Staying informed (design)

Phase P5 of the [ticket-system roadmap](2026-10-23-ticket-system-roadmap.md#p5-staying-informed-about-12-tasks-moves-the-ticket-part-of-stage-6-forward):
watching, live in-app notifications, a My work page, and triage with four-eyes approval.
Decisions marked **(owner)** were made by the owner on 2026-10-28; **(my call)** can be overridden.

## Watching

- A ticket's watchers are people. You start watching a ticket when you create it, are assigned
  it, are @mentioned in its text or comments, or comment on it. **(my call)** Watch and Unwatch on
  the ticket page, with the watchers listed. Unwatching sticks: automatic watching does not add
  you back to a ticket you chose to leave. **(my call)**
- Watchers must be members of the workspace (composite foreign key). A member who leaves stops
  being a watcher (cascade, like tokens).

## Notifications

- **Kinds:** `assigned`, `mentioned`, `commented` (on a watched ticket), `moved` (status change on
  a watched ticket), `due_soon` (due tomorrow), `overdue`, `triage_approval` (a proposal waiting
  for you), `triage_outcome` (a decision on a ticket you filed).
- Never for your own action. One notification per person per event; a mention that is also an
  assignment is one notification (the more specific wins: assigned, then mentioned, then the rest).
- Stored per person (`notifications`: recipient, workspace, kind, ticket, actor, a short text
  captured when it happened, read at, created at). Only the recipient can read or mark them.
- Each kind can be switched off per person (stored in preferences). Default all on.
- Due dates are checked by a small in-process job once an hour; each ticket notifies once per day
  per person and kind. **(my call)**
- **Live (owner):** `GET /api/v1/me/events` is a server-sent events stream for the signed-in
  person (session cookie only). It sends `notification` events with the unread count, and a
  heartbeat every 25 seconds. Events go through an in-process hub keyed by user id; only the
  recipient's open streams receive them. The browser reconnects automatically. One process only
  for now; a shared bus (Postgres `LISTEN/NOTIFY`) is the seam for more than one.
- **Screens:** a bell in the top bar with the unread count; a panel with the latest 20; an Inbox
  page (All / Unread, paged); Mark read, Mark all read. Settings on the Profile page.
- **CLI:** `forge inbox [--all] [--json]`, `forge inbox read` marks all read. The API routes it
  uses are workspace-scoped so tokens may use them.

## My work

- `/w/<slug>/my-work`: tabs Assigned to me, Created by me, Watching; each grouped by status
  category, overdue and due-soon first. A sidebar link.
- **Assigned to me (owner):** a one-click toggle beside the search on every board and list
  (`assignee=me`), shortcut **Shift+M** (M already moves the open ticket).

## Triage

- **Intake (owner, A):** a project setting "New tickets go to triage". When on, a ticket created by
  someone who has `tickets.create` but not `tickets.edit` arrives in triage. Anyone with
  `tickets.edit` can also **Send to triage** an open ticket.
- A ticket in triage has `triage_state`: `waiting`, `proposed` or `snoozed` (null when not in
  triage). It keeps its status (the project's initial status) but is left off boards and the
  default list until it leaves triage. **(my call)**
- **Actions (owner):** Accept (into Cold Steel; may set assignee, priority, labels), Accept to
  Warming, Duplicate of (link + scrap), Decline (reason required; Scrapped), Snooze until a date
  (back to waiting then, checked by the same hourly job).
- **Four-eyes (owner, A):** every action except Snooze is a **proposal** (`triage_proposals`:
  ticket, action, details, proposer, created). The ticket shows "Awaiting approval: Accept by Dana".
  Another member with `tickets.edit` **Approves** (the action is applied, as the approver, with
  "proposed by" in the history) or **Rejects** with a note (back to waiting). Nobody approves their
  own proposal; one open proposal per ticket; the first approval or rejection wins (row lock).
- **Arrival rules (owner, A):** per project, ordered; the first match applies. Match on any of:
  type, label, words in the title (case-insensitive, all words), reporter. Set any of: assignee,
  priority, labels to add, triager. Rules only fill in fields; they never decide. Managed on the
  project's Settings tab (`projects.manage`).
- **Rota (owner, A):** an optional ordered list of members per project; the person on duty changes
  every Monday 00:00 UTC (week number modulo length). The rule's triager, else the person on duty,
  else everyone with `tickets.edit` in the project, is notified of an arrival.
- History lines for every step; the reporter is notified of the outcome.

## Not in P5

Email, push to phones, digests; live board updates (the stream is the seam); triage forms for
people outside the workspace; rule conditions beyond the four listed.
