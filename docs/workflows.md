# Ticket workflows

This page covers how a ticket moves between statuses, how simultaneous edits are kept from
overwriting each other, and what the history records. It describes what exists after Stage 2
(Part A). The workflow _automation_ engine (rules that react to events) is Stage 5 and does not
exist yet; see [the last section](#what-stage-5-will-add).

## Statuses and categories

Every project has its own list of statuses. Each status belongs to one of three **categories**, which
is what the rest of the product reasons about, so a project can rename or add statuses without
changing what "done" means:

| Category      | Meaning                           | Used for                                                                                               |
| ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `not_started` | Nobody has begun                  | The "Not started" filter; counted as open on the projects list                                         |
| `in_progress` | Work is under way (or is stuck)   | The "In progress" filter; counted as open                                                              |
| `completed`   | Finished, successfully or dropped | The "Finished" filter; not counted as open; sets `completedAt`; its due date is never shown as overdue |

Exactly one status per project is **initial**: a new ticket always starts there. The API has no way
to create a ticket in any other status (the create body has no status field), and a unique index
keeps a project from having two initial statuses.

## The default workflow

A new project gets its own copy of this template (`DEFAULT_STATUS_TEMPLATE` in
`packages/shared/src/tickets.ts`). The copy is the point: once projects can edit their workflows
(Part B), changing one will not touch another.

The statuses are named after the heat of the work, from cold steel to finished. Each has a key (the
stable identifier that filters, saved views and the API use) and a name (what people read). Only
the names were changed from the original plain ones; the keys are as they were.

| Status       | Key           | Category      | Initial |
| ------------ | ------------- | ------------- | ------- |
| Cold Steel   | `backlog`     | `not_started` | yes     |
| Warming      | `open`        | `not_started` |         |
| In the Forge | `in_progress` | `in_progress` |         |
| Tempering    | `in_review`   | `in_progress` |         |
| Jammed       | `blocked`     | `in_progress` |         |
| Quenched     | `done`        | `completed`   |         |
| Scrapped     | `cancelled`   | `completed`   |         |

A ticket can move only along a listed transition. Anything not listed is refused, including a jump
straight from Tempering back to Cold Steel.

| From         | Can move to                                    |
| ------------ | ---------------------------------------------- |
| Cold Steel   | Warming, Scrapped                              |
| Warming      | Cold Steel, In the Forge, Jammed, Scrapped     |
| In the Forge | Warming, Tempering, Jammed, Quenched, Scrapped |
| Tempering    | In the Forge, Jammed, Quenched, Scrapped       |
| Jammed       | Warming, In the Forge, Scrapped                |
| Quenched     | Warming (reopen)                               |
| Scrapped     | Cold Steel, Warming (reopen)                   |

Transitions are rows (`status_transitions`), not code, and both ends must be statuses of the same
project (composite foreign keys), so a transition cannot point into another project's workflow.

## Heat

A status's colour and the shape of its symbol come from its **heat**, one function (`heatOf` in
`apps/web/src/lib/heat.ts`) used wherever a status is drawn: the board, the list, the ticket page
and the filters.

| Status       | Heat      | Colour    | Symbol              |
| ------------ | --------- | --------- | ------------------- |
| Cold Steel   | cold      | `#7f8ea3` | dashed ring         |
| Warming      | warming   | `#9db0c6` | ring                |
| In the Forge | forge     | `#e8793a` | half-filled ring    |
| Tempering    | tempering | `#f2c14e` | half-filled ring    |
| Jammed       | blocked   | `#c24d46` | ring with a bar     |
| Quenched     | quenched  | `#5b86b0` | tick in a disc      |
| Scrapped     | scrapped  | `#76808f` | struck-through ring |

The seven default keys have their own heat. Any other status (Part B will let projects add them)
takes the heat of its category: not started is cold, in progress is the forge, completed is
quenched. Every colour keeps at least 3:1 contrast against the app's surfaces (a test reads the
surfaces from the stylesheet). The name and the symbol always accompany the colour, so a status is
never told apart by colour alone. Where someone is (the focus ring, the current tab, the current
sidebar item, the drop target while dragging) is steel blue, never one of the heat colours.

## How a move is checked

The API (`updateTicket`) decides; the screens only avoid offering what it would refuse. In order,
inside one transaction:

1. The ticket row is **locked** (`SELECT … FOR UPDATE`), so a second simultaneous edit waits.
2. The `version` the client sent must equal the ticket's current version, otherwise `409`.
3. Fields that already have the sent value are dropped. If nothing is left, the ticket is returned
   unchanged: no version bump, no history entry, no error. This includes sending the status the
   ticket is already in.
4. The target status must belong to **this ticket's project** and be active, otherwise `422` with
   "Unknown status." A status from another project or workspace is indistinguishable from a missing one.
5. A transition row from the current status to the target must exist, otherwise `422` with
   "That move isn't allowed from <current status>."
6. `completedAt` is set when the ticket enters a `completed`-category status and cleared when it
   leaves one.

Changing the status needs `tickets.edit`. Changing the assignee also needs `tickets.assign`.

## Moving a ticket in the screens

- **Ticket page:** the Status field is a select. It lists the current status and, under "Move to",
  only the statuses the workflow allows from here.
- **Board:** drag a card by its grip to another column, or press Space on the grip, use the arrow
  keys to pick a column, and press Space again. Columns that cannot take the card are marked and
  skipped by the keyboard. A drop on one anyway is refused with a message
  ("WEB-3 cannot move from Tempering to Cold Steel.") and the card stays where it was.
- **"Move to" menu** on each card does the same without dragging, offering the same allowed statuses.
- **The Tickets board** (the Board tab on the Tickets page) holds every project's tickets, a column
  per status. A ticket still moves under **its own project's** workflow: dropping an API ticket on
  a column checks API's transitions, and a column whose status the ticket's project does not have
  refuses it. Tickets of an archived project have no grip and no menu.
- A person without `tickets.edit` sees no grip, no menu and no select.

- **List:** the Status, Priority and Assignee cells are menus for people who may change them;
  Status offers only the moves the workflow allows. Tick rows to change many at once from the bulk
  bar: each ticket is checked against its own workflow, and the bar says which could not move and why.
- **Quick create:** the "+" on a board column makes a ticket straight into that column's status.
  Creating may use any active status; the workflow governs moves, not creation.
- **Archived tickets** cannot be moved or edited until they are unarchived.

### The board is each person's own to arrange

The **Display** menu on the board changes how the board looks for the person using it. It is saved
to their account, drawn correctly on the first load, and never changes what anyone else sees (see
[architecture](architecture.md#board-settings-per-person)).

- Which card fields show (labels, due date, priority, comment count, type), the density
  (comfortable or compact) and whether columns carry their heat colour are the same on every board
  the person opens.
- Which columns show, and in what order, is remembered for each project, and separately for the
  Tickets board. **Scrapped is hidden by default**; everything else shows. Hiding a column only hides the view of it: its tickets are
  untouched and still appear in the list, and a card's "Move to" menu still offers the hidden status
  (the person is told where a ticket went when they move one into a hidden status).
- When every column is hidden the board says so, and the Display menu brings one back.

## Simultaneous edits

Every ticket has a `version`, starting at 1 and increased by one on each change. An edit must say
which version it started from.

- If the ticket has moved on, the API answers `409 conflict` and changes nothing.
- The ticket page then shows a banner ("This ticket changed while you were looking at it"), keeps
  what the person typed, and offers a Reload button for the latest.
- The board puts the card back where the server says it is and tells the person, instead of
  overwriting somebody else's move.

Comments do not change a ticket's version or its `updatedAt`: the version guards the ticket's
fields, and comments are separate rows.

## History

Each ticket has a history in `ticket_events`. Rows are only ever added. The ticket page merges them
with the comments into one timeline, oldest first.

| Event                   | Written when                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ticket.created`        | The ticket is created (with the title)                                                                                                                                                                                          |
| `ticket.updated`        | Title, description, type, priority, assignee, component, due date or estimate changed. One event lists every field changed by that edit, with the old and new display values; a description change records only that it changed |
| `ticket.status_changed` | The status moved, with both names                                                                                                                                                                                               |
| `labels.changed`        | Labels were added or removed, by name                                                                                                                                                                                           |
| `comment.deleted`       | A comment was deleted (its text is gone; this is the only trace)                                                                                                                                                                |

`comment.added` and `comment.edited` events are written too, but the timeline shows a comment once,
as the comment itself, so they are not listed a second time. Names are stored as they were when the
change happened, so the history stays readable after something is renamed. When the statuses were
renamed to the forge names, lines written earlier kept the old words ("moved this from In Review to
Blocked"); only new history uses the new ones.

Events carry a `source` (`user` or `system`). Only `user` is written today; `system` is reserved for
changes made by automation.

## Parents, links and blockers

A ticket can sit under a parent, up to three levels: epic, ticket, sub-task. An epic (type `epic`)
is always top level. Tickets can be linked: blocks / is blocked by, relates to, duplicates / is
duplicated by. Parents and links can cross projects of a workspace, never workspaces.

An **open blocker** is a ticket that blocks this one and is not completed (archived or not). While a
ticket has one, it **cannot be moved to a completed status that means done**: "WEB-1 can't be
quenched while API-4 is open." It **can always be scrapped**. Which completed status means "won't
do" is the status flag `is_cancellation` (true for Scrapped), not its name. The rule is a project
setting, on by default, decided by the blocked ticket's own project.

Adding a blocker does not move a ticket to Jammed, and removing the last one does not move it back:
a person decides. When a ticket does move to Jammed, it remembers the status it came from
(`status_before_jam_id`) so the security gate can later put it back.

"Mark as duplicate" links the ticket to the original and moves it to Scrapped in one step, following
the workflow (a Quenched ticket must be reopened first).

## What cannot be changed yet

Part B of Stage 2 adds the screens for editing a project's statuses and transitions and for
deactivating a status in use (with a choice of where its tickets go). Until then:

- The workflow of a project is the default template, and no screen or API changes it.
- The board shows columns for **active** statuses only. Nothing can deactivate a status yet, so
  every ticket is on the board. When deactivation arrives, tickets in a deactivated status will
  need a decision, which is part of that work.
- Ticket types and priorities are the workspace defaults; there is no screen to rename them.

## What Stage 5 will add

The deterministic workflow engine (Stage 5) builds on what is above: rules such as "when a pull
request is merged, move the ticket to Quenched" will be evaluated against the same transitions and
recorded in the same history, with `source: system`. Nothing of that exists in Stage 2: there are no
triggers, conditions, actions, versions of a rule, or editors. The transitions table described here
is only the set of moves a person (or later a rule) is allowed to make.
