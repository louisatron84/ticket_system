# P7 — Find and shape: design

Date: 2026-11-01. Built so far: slice 1 (query language), 2026-11-01.

Phase P7 of the [ticket roadmap](2026-10-23-ticket-system-roadmap.md). The owner said "lets carry
on" after P6, as with P6 skipping the questions, so every choice below not in the roadmap is my
call and marked so.

## Intent

Finding tickets should be as fast as typing a sentence, and any list should be reshaped (grouped,
tabled, exported) without leaving the app. One query language is shared by the filter bar, saved
views and the CLI, so a query learnt in one place works in all of them.

## Goals

1. **Query language** parsed into the filters that already exist.
2. **Full-text search** of titles, descriptions and comments, ranked, with highlights.
3. **Group by** assignee, priority, epic, label or project: board swimlanes and list groups.
4. **Table view** with a column chooser and inline editing.
5. **CSV export** of any view and **CSV import** with a mapping step (Jira's export included).
6. **Cursor paging** in the API in place of page numbers.

## Non-goals

Boolean logic beyond what filters hold (no OR across fields, no brackets, no NOT) — my call: the
filter structure is AND across fields and OR within one, and the query language says exactly that.
Search across other workspaces. Search of attachments' contents.

## Slices

### Slice 1 — Query language

- One parser in `@forge/shared`: `parseTicketQuery(text, context)` gives a filter patch and a list
  of issues, each with the position of the words it is about; `formatTicketQuery(filters, context)`
  writes filters back as text; `suggestQuery(text, cursor, context)` offers completions.
- `context` names what names mean (statuses, types, priorities, people, milestones, cycles,
  projects, labels). The API builds it from the database; the web app fetches it from
  `GET /orgs/:orgId/ticket-query/context` (people only for those who may see members, my call,
  matching the member list).
- Terms (my calls on the exact words):
  - `project:WEB`, `status:` / `type:` / `priority:` by key or name (quotes for spaces:
    `status:"in the forge"`), `assignee:` and `reporter:` as `me`, `none` (assignee only), a
    name or an email; `label:`, `milestone:` and `cycle:` by name or `none`; `due:overdue|today|week|none`;
    `parent:`, `epic:`, `linked:` with a ticket key.
  - `is:open`, `is:done`, `is:started`, `is:blocked`, `is:unblocked`, `is:archived`, `is:watching`,
    `is:top`, `is:triage`.
  - `updated:>-7d`, `created:<2026-10-01`: `>` means on or after, `<` means before; a date is a
    calendar day (UTC) or days/weeks back from now (`-7d`, `-2w`). New filters `updatedFrom`,
    `updatedBefore`, `createdFrom`, `createdBefore` hold them as written, so a saved view stays
    relative.
  - `order:priority`, `order:due-asc`, `order:created-desc`.
  - Several values: `status:warming,done` or the key repeated — either matches, except labels,
    which must all be on the ticket (as the label filter already worked). Different keys must all
    match. Any other words are the text search.
  - A query applies on top of the filters already set: the fields it names change, the rest stay
    (my call, so typing `assignee:me` does not drop chips set from the menus).
  - Unknown keys and values are errors with a suggestion ("Did you mean status?"), never guessed.
- The filter bar gains a query mode: the search box accepts the language, shows errors under it
  and suggests as you type; the chips stay and follow the query. Saved queries are saved views.
- The ticket list API accepts `query=<text>`; an invalid one is a 422 listing the issues. The CLI
  gains `forge catalogue --query "…"` (or the words after `cat`).

### Slice 2 — Full-text search

- A generated `tsvector` on tickets (title weighted above description) plus one over comments,
  GIN-indexed; `q` matches with `websearch_to_tsquery` (English config, my call), key prefixes and
  exact keys still win. Ranked with `ts_rank` when there is a text search and no explicit order;
  results carry a short highlighted extract (`ts_headline`, plain text with marked ranges, never
  HTML).

### Slice 3 — Group by

- `group=assignee|priority|epic|label|project` on list and board. Board: swimlanes, collapsible.
  List: group headers with counts. A ticket with two labels shows under both (my call, said on
  screen).

### Slice 4 — Table view

- A third display beside List and Board: columns chosen from the fields (custom fields included),
  remembered per view; cells edit in place through the existing ticket update (version checked).

### Slice 5 — CSV export and import

- Export the current view (all pages, up to 5,000 rows, my call) as CSV, formula-safe (cells
  starting with `= + - @` are prefixed with `'`).
- Import: upload a CSV, map its columns to fields (Jira's column names recognised), preview with
  per-row errors, then create in one go; limited to 1,000 rows and needs `tickets.create`.

### Slice 6 — Cursor paging

- Ticket list responses carry an opaque `next` cursor (sort value plus id); `page` keeps working
  for one release and is then removed (my call).

## Constraints

Every route is tenant-scoped through `orgAccess`. Query text follows the existing limits (no control
characters). Nothing user-typed reaches SQL except as bound parameters.

## Left to the builder

Exact copy, the look of suggestions, highlight styling within the existing tokens.
