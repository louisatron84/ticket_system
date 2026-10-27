# The board, heat colours and forge names: design

Status: approved by the owner on 2026-10-23 (names, colours and per-person settings confirmed;
the rest accepted as written). Date: 2026-10-23. Follows Stage 2 Part A (projects, tickets, board).

## Why

The tickets and the board are the part of Forge the owner cares about most, and right now they look
and feel like a competent default. The owner wants a board people can move cards on that is
**customisable while staying minimal but useful**, and wants Forge to feel like Forge: statuses
that read as metal being worked, from cold to hot to finished.

The owner chose, from throwaway mockups, three things: the **Rich** ticket card, a **single
Display menu** for customising, and the **Heat** look. They also chose the status names below.
Mockups are kept in `.superpowers/brainstorm/` (git-ignored); the final one is `board-combined-v4.html`.

## Goals

1. Statuses are named and coloured as heat: cold steel, warming, in the forge, tempering, and
   finished.
2. The ticket card shows what matters at a glance (the Rich card) and each optional piece can be
   switched off.
3. One **Display** button on the board opens one menu that customises the board for the person
   using it, and the choice is remembered.
4. The heat colour language appears wherever a status appears (board, list, ticket page, filters),
   so a status looks the same everywhere.
5. Everything stays operable by keyboard, and colour is never the only signal.

## Non-goals

- A redesign of the rest of the app (shell, project list, ticket page layout, list layout). They
  pick up the new status colours and names for free, and nothing else. A wider visual pass is a
  separate project.
- A light theme (the "Chalk" swatch was not chosen).
- Editing a project's statuses or workflow (Stage 2 Part B admin screens).
- Per-column menus (rename, work limits, sort), board settings shared by a whole team, swimlanes.
- The Forge-themed command line tool (parked by the owner).

## Anti-goals (a failure even if it technically works)

- A settings screen full of toggles. The Display menu stays one short menu.
- Colour as the only way to tell statuses apart.
- A slower or jumpier board, or drag and drop and keyboard moves that stop working.
- Losing any existing protection: tenant isolation, the workflow rules, version checks.

## Decisions made by the owner

| Topic         | Decision                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Card          | "Rich": key, priority bars, comment count, title, labels, due date, assignee                                    |
| Customising   | One Display menu: group by, which card fields show, density, heat colours on or off, which columns show and in what order |
| Look          | "Heat": each column has a coloured top edge and faint glow that follows how hot the work is                     |
| Status names  | Backlog becomes **Cold Steel**, Open becomes **Warming**, In Progress becomes **In the Forge**, In Review becomes **Tempering**, Blocked stays **Blocked** |

## Calls made without the owner (please check these)

1. **Done becomes "Quenched" and Cancelled becomes "Scrapped".** Confirmed by the owner. Names are
   data, so they are cheap to change later.
2. **Scrapped is hidden on the board by default**, reachable from the Display menu. Cancelled work
   rarely matters on a working board. Its tickets still exist and still appear in the list.
3. **"Where you are" moves from amber to steel blue** in five places: the keyboard focus ring, the
   current project tab, the current sidebar item, the board's drop target while dragging, and the
   accent of the sidebar switch on the profile page. Orange now means In the Forge, so amber cannot
   also mean "you are here". Amber stays where it means the brand or a warning (the logo mark, the
   development-only banners, the "degraded" system status).
4. **Display settings belong to the person, not the project or the workspace** (confirmed by the
   owner). Card fields, density and heat apply on every board they open. Column visibility and order
   are remembered per project, because every project has its own statuses.
5. **A card's comment count is new data.** The API's ticket summary does not carry it today, so it
   is added (and tested), for the list and the board alike.
6. **The type icon is off by default** on cards (the Rich swatch did not show it) and can be turned
   on in the Display menu.
7. **Group by Assignee and Priority is the last step and optional.** It needs a different board
   request and different drop rules (see below). Everything before it stands on its own.
8. **Blocked is a dull red**, the one status not on the cold-to-hot ramp, because it means stalled
   rather than progressing. It gets its own symbol (a ring with a bar), and Cold Steel gets a dashed
   ring, so neither looks like its neighbour when colour is ignored.

## Design

### Names and data

- Status **keys** do not change (`backlog`, `open`, `in_progress`, `in_review`, `blocked`, `done`,
  `cancelled`). Only the display **names** do: in the default template that new projects copy
  (`DEFAULT_STATUS_TEMPLATE`), in the demo seed, and in existing projects.
- Saved views and filters store keys, so they keep working.
- A migration renames existing project statuses, but only a status whose key and current name are
  still the old default, so a name someone changed is never overwritten. (There is no screen to
  rename statuses yet, so today this is every status.)
- A ticket's **history keeps the names as they were when it happened** ("moved this from In Review
  to Blocked"). That is how history already works and is not rewritten.
- Docs, tests and fixtures that mention the old names are updated (about 70 places in 12 files).

### Heat

Heat is a function of a status: the seven defaults have fixed colours, and any status added later
(Part B) takes a colour from its category (not started: cold steel, in progress: orange, completed:
quenched blue). It is applied as a coloured top edge and a faint tint on the board column, and as
the colour of the status symbol everywhere. Symbols keep their shapes and the status keeps its
**name**, so colour is never alone. Today's shapes stay (ring, half ring, tick, struck ring), with
two additions that appear in the mockup: a dashed ring for Cold Steel and a ring with a bar for
Blocked, so that neighbouring statuses never share a shape.

| Status       | Heat starting point | Meaning                      |
| ------------ | ------------------- | ---------------------------- |
| Cold Steel   | `#7f8ea3`           | not touched                  |
| Warming      | `#9db0c6`           | getting ready                |
| In the Forge | `#e8793a`           | glowing, being worked        |
| Tempering    | `#f2c14e`           | white-hot, being checked     |
| Blocked      | `#b5453f`           | stalled                      |
| Quenched     | `#5b86b0`           | cooled and finished          |
| Scrapped     | `#7f8ea3`, dimmed   | dropped                      |

The builder may adjust these values, but every colour used for a symbol or an edge must keep at
least 3:1 contrast against the surface it sits on, and text stays the normal text colour.

### The Rich card

Key, priority bars (with the priority's name available to screen readers), comment count, title
(up to three lines), up to two labels with "+n" for more, due date in words (overdue in red, as
today), and the assignee. Switchable in the Display menu: labels, due date, priority, comments,
type. Key, title and assignee are always shown. The grip and the "Move to" menu stay as they are.

### The Display menu

One button, top right of the board, opening one popover with:

- **Group by**: Status (default). Assignee and Priority arrive in the optional last step.
- **Show on cards**: switches for labels, due date, priority, comment count, type.
- **Density**: comfortable or compact (compact: tighter spacing, one-line titles, no labels).
- **Colour**: heat colours on or off (off gives neutral columns).
- **Columns**: each status with a show/hide switch and move up/down buttons. Reordering uses
  buttons so it works without dragging. Hiding changes only what this person sees: the tickets are
  not touched, the list still shows them, and the card's "Move to" menu still offers hidden statuses.
  A hidden column's ticket count is shown in the menu.
- **Reset to default.**

Changes apply at once and are saved. If saving fails, the change is undone and the person is told.
The board is rendered with the saved settings on the server, so it does not flash the defaults.

### Where the settings live

In the person's existing preferences record (the same place the collapsed sidebar is remembered),
with a strict schema and sizes capped (for example at most 20 statuses and 100 projects remembered).
The builder must make sure a change for one project cannot overwrite another project's saved
columns when two tabs are open (a deep merge or a small table; the builder's choice).

### Group by Assignee and Priority (optional last step)

The board request gains a grouping. Columns become people (only people who have tickets in the
project, plus "Unassigned") or priorities; the 50-ticket cap per column stays. Dropping a card in
another column then changes its assignee (needs `tickets.assign`) or its priority (needs
`tickets.edit`), checked by the server like any other edit and not by the status workflow. Cards
show their status symbol and name, because the column no longer says it. Keyboard moves and the
"Move to" menu follow the same rules.

## Constraints

- Same stack and conventions as the rest of the repo. No new runtime dependency is expected.
- Plain text only; UTF-8 database; permissions enforced by the API, never only by the page.
- The workflow rules and `version` checks are unchanged.
- Motion only in answer to a person's action (opening the menu, a card landing); respect
  reduced-motion settings.

## Verification

- Unit tests: the heat function, the Display settings and their schema, the board's column
  filtering and ordering, the card's fields.
- API tests: comment count on list and board results; the preferences schema (strict, capped,
  merges correctly); the rename migration (default names change, a custom name is left alone).
- Browser tests: names and colours present on the board, list and ticket page; the Display menu
  persists across a reload and is separate for each person; hide and reorder columns; dragging and
  keyboard moves still work; a read-only person still has nothing to grab.
- Screenshots reviewed by eye at desktop and phone width, with the heat on and off.
- The same gate as Part A: typecheck, lint, format, all tests, a clean-copy build.

## Order of work

1. Names: template, seed, migration, tests and docs. The app looks the same, with new words.
2. Heat colours and the move of the "where you are" accent, everywhere a status shows.
3. The Rich card, including the comment count in the API.
4. The Display menu with saved per-person settings (fields, density, heat).
5. Column show, hide and reorder.
6. Group by Assignee and Priority (optional).
7. Docs and the final gate.

## Left to the builder

Exact spacing and type sizes; the compact density details; fine adjustment of the heat values within
the contrast rule; the menu component's construction; how the preferences are merged safely; the
wording of the small messages.
