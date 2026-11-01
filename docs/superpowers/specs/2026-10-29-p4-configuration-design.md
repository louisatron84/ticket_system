# P4: Configuration, kept small (design)

Status: owner said "start with all P4 tasks" on 2026-10-29 and skipped the remaining questions, so
everything below not marked **owner** is my call, listed at the end for checking.

## Why

A team should make Forge speak its language without losing what makes Forge Forge. An outside
tester's first wish was renaming statuses and editing the workflow (a QA step, plain names), then
clearer priorities, and `--status Warming` working in the CLI. Configuration stays small: fixed
building blocks, no scripting, no per-team code.

## Decided by the owner

- **New projects keep starting with the heat names** (Cold Steel … Scrapped; Heatless … Inferno).
  Teams can rename them; there is no "plain" starter set (2026-10-29, option A).
- Ticket templates belong to P4 (moved here from P1).

## Goals

1. **Workflow editor** per project: add, rename, reorder, deactivate and reactivate statuses; a
   transitions grid; copy the workflow of another project.
2. **Transition rules** chosen per transition from a fixed list: needs an assignee, needs an
   estimate, needs a comment, no open blockers.
3. **Workspace ticket settings** (`/w/<slug>/settings`, which today is a 404): ticket types and
   priorities (add, rename, reorder, deactivate), labels (rename, recolour, merge, delete),
   custom fields.
4. **Components**: rename, a lead, a default assignee, deactivate.
5. **Custom fields**: short text, long text, number, yes/no, single select, multi select, date,
   link, person. Limited to chosen ticket types; shown and edited on the ticket; usable as a
   filter, a sort and a card field.
6. **Ticket templates** per project, picked when creating a ticket.
7. **CLI**: statuses by the names people see.

## Non-goals and anti-goals

- No scripting, formulas, computed fields or conditional logic. No per-project field schemes.
- No hard deletes of statuses, types, priorities, fields or options that tickets have used:
  history must keep reading true. Deactivate instead.
- A rename never rewrites history lines already written (as today).
- Anti-goal: configuration that can strand tickets (a status nobody can leave, a ticket in an
  inactive status, an initial status that is inactive). Every change that could do that is
  refused or asks where the tickets go.

## The how

### Workflow (per project, permission `workflows.configure`)

- A status has a name (1 to 40 characters, unique per project ignoring case), a category
  (`not_started`, `in_progress`, `completed`), an order and an active flag. Its **key** is made
  from the name when created (`qa`, `qa-2` on a clash) and never changes, because filters, saved
  views, board preferences and CLI words use keys.
- **Colour follows the category.** The seven default keys keep their own heat colours and
  symbols; a new status takes its category's (`not_started` cold, `in_progress` forge,
  `completed` quenched).
- **Exactly one initial status**, active and `not_started`. Choosing another moves the flag.
- **At least one active status per category.** The cancellation flag (Scrapped) stays as seeded;
  a new completed status is a "done" status.
- **Deactivating a status with tickets** needs a destination: an active status of the same
  project. Its tickets move there in the same transaction, each with a history line ("moved
  from QA to Warming when QA was retired"), without workflow or rule checks (it is an
  administrator's act). Transitions to and from it are kept but inactive statuses are never
  offered. Reactivating brings it back as it was.
- **Transitions grid**: rows "from", columns "to", a tick means allowed. Saved as a whole set in
  one request, under a lock on the project, with a `version` so two editors cannot overwrite each
  other (409 on a stale version). A status with no way out (other than completed ones) is
  allowed but warned about.
- **Copy from another project**: brings the source's statuses (matched by key: names, categories,
  order and active flags copied; missing keys added), its transitions and their rules. A status
  the target has but the source lacks is deactivated if empty; if it has tickets, the copy is
  refused naming those statuses. One transaction.
- The blocker rule (project setting "blockers stop completion") stays as it is.

### Transition rules

- Stored on the transition. The list: `needs_assignee`, `needs_estimate`, `needs_comment`,
  `no_open_blockers`.
- Checked by the API on every move (ticket page, list, board, bulk, CLI) after the workflow check,
  with a sentence naming what is missing ("Moving to Tempering needs an assignee.").
- **Needs a comment**: the move request carries `comment`; the comment is added in the same
  transaction. The ticket page asks for it in a small dialog; the board and list ask the same way;
  bulk refuses such tickets (listed per ticket, as today); the CLI takes `-m "text"`.
- Triage acceptance and status-deactivation moves are not subject to rules.

### Workspace ticket settings (permission `fields.manage`)

- **Types**: name, order, active. Keys made from the name, fixed. The last active type cannot be
  deactivated. Inactive types are not offered for new tickets or changes; tickets keep theirs.
- **Priorities**: name, order (rank), active. Same rules; the order is what "higher" means.
- **Labels**: rename, recolour (the eight colours), merge one into another (its tickets get the
  other; then it is removed), delete (removed from tickets, after a confirmation naming the
  count). Labels are names, not history, so these are real changes.
- **Custom fields**: below.
- Every change is in the audit trail.

### Components (per project, permission `projects.manage`)

- Rename, deactivate/reactivate, a **lead** and a **default assignee** (both members who can see
  tickets, or none). A new ticket with a component and no assignee gets the default assignee,
  whoever creates it.

### Custom fields (workspace, permission `fields.manage`)

- Kinds: `text` (up to 500), `long_text` (up to 10,000, the same formatting as descriptions),
  `number`, `boolean`, `select`, `multi_select`, `date`, `url` (http/https only), `person`
  (a member). The kind never changes after creation.
- A field has a name, an optional description, its ticket types (none means all), an order and an
  active flag. At most 50 fields per workspace, 100 options per select field.
- Select options: name, order, active. An option in use cannot be removed, only deactivated.
- A field with any value cannot be deleted, only deactivated (hidden everywhere, values kept). An
  unused field can be deleted.
- **On the ticket**: a "Fields" group under the built-in ones, editable by `tickets.edit`; values
  are part of the ticket's `version`, every change is a history line.
- **Filter**: select and multi-select by option, person by member, yes/no, and "has a value / is
  empty" for every kind. **Sort**: number, date and text. **Card field**: each field can be
  switched on in the board's Display menu (off by default).
- The API returns values on the ticket detail and summaries; the CLI's `inspect` prints them.

### Ticket templates (per project, permission `projects.manage`)

- Name, plus any of: title prefix, type, priority, labels, component, goal, criteria,
  description. At most 20 per project.
- The create form offers them; picking one fills the form, which the person can still change.
  Quick create on the board stays title-only. A template is not remembered on the ticket.

### CLI

- `--status` accepts a status name or key, case-insensitive (`--status Warming`, `--status open`).
- `forge move <KEY> <status>` for any status, including ones added in P4; the seven move words
  stay. `-m "text"` on any move carries a comment (for rules that need one).

## Limits kept honest

- One migration (`0010_configuration`) for every table and column.
- Tenant isolation and permission tests for every new route; refusal sentences tested.
- Docs: `workflows.md`, `data-model.md`, `security.md`, `known-limitations.md`, README.

## My calls (please check)

1. Status keys are fixed at creation and made from the name; only names change.
2. Colour follows the category for new statuses; the seven defaults keep their heat colours.
3. Deactivating a status moves its tickets without rule checks, recorded in each ticket's history.
4. "Needs a comment" means the move itself carries a comment, not "a comment exists somewhere".
5. Labels can be deleted for real (they are tags, not history); statuses, types, priorities,
   fields and used options only deactivate.
6. Custom fields are per workspace, limited by ticket type, not per project.
7. A component's default assignee applies even when the creator may not assign.
8. Permissions: `workflows.configure` for workflows and rules, `fields.manage` for workspace ticket
   settings and fields, `projects.manage` for components and templates (all three already exist;
   owners and admins hold them).
9. Templates are not remembered on the ticket.
