# Forge ticket system: the full plan

Status: **draft for the owner to approve.** Nothing here is built. Each phase gets its own detailed
plan (tests first, as for Stage 2 and the board) when it starts.

## Why this document exists

The owner's order of work is: (1) a fully fledged ticket system that lives on the Tickets tab,
(2) a fully fledged repository system, (3) the two woven together with lots of small conveniences,
(4) command-line shortcuts for both. This is the plan for step 1 only. It compares Forge with the
ticket systems people already know, picks what is worth having, puts it in order, and says what
"done" means so we know when to move on to repositories.

## Goals, non-goals and anti-goals

**Goals**

- A team can run its day-to-day work in Forge without wishing for Jira or Linear: capture, triage,
  plan, move, discuss, find and report on work.
- Fast. The common actions are one or two keystrokes away.
- Minimal but useful, as the owner put it for the board. Every feature has to earn its place on
  screen; the Display menu pattern (the person chooses what they see) is the default answer to
  "should this be shown?".
- Built so the repository system and the CLI can use it later without rework (see
  [Seams for the next steps](#seams-for-the-next-steps)).

**Non-goals**

- AI features. The product spec is explicit that Forge is deterministic. Height's AI triage is
  noted below and skipped.
- Resource management, portfolio planning, a plugin marketplace.
- Real-time co-editing of a description.

**Anti-goals (what would make this a failure even if it technically works)**

- Becoming Jira's configuration maze. Jira lets each project choose its own issue types, fields,
  screens, workflow schemes and permission schemes; people hire administrators for it. Forge keeps
  **one workflow per project, one field list per ticket type, no screens, no schemes**.
- A screen with fifteen controls on every card. Anything optional goes behind the Display menu.
- Features that only work with a mouse.

## Where Forge is today

Built and verified (Stage 2 Part A plus the board work): projects with keys, tickets with types,
priorities, statuses grouped in categories with per-project transitions, components, labels,
comments (edit, delete), a history timeline, optimistic-concurrency editing, a filtered, sortable,
paged list, personal and shared saved views, a Kanban board with drag and keyboard moves, per-person
board settings (Display menu), the heat look, roles and permissions on every route, tenant isolation
and an audit trail.

Not built: everything in Part B (custom fields, relationships and subtasks, attachments, editing
statuses, types and priorities, bulk edit, duplicate, archive, subscribe), plus the items below.

## What other systems do

Sources are marked **[S]** where a page in the research backed the point (links at the end) and
**[K]** where it is my general knowledge that the research did not re-check. Treat **[K]** items as
"probably right, verify before relying on them".

**Jira** (the standard for configurable teams)

- Per-project issue types, fields, screens and workflows; a workflow scheme can give bugs a stricter
  path than tasks. [S]
- Transitions carry conditions, validators and post-functions, so a ticket cannot move unless, for
  example, an estimate exists. [S]
- JQL, a query language for exact searches ("my high-priority bugs updated this week"). [S]
- A no-code automation rule builder. [S]
- Scrum and Kanban boards, a ranked backlog, sprints that return unfinished work to the backlog,
  burndown and velocity charts, dashboards of gadgets. [S]
- Roadmaps and timelines across epics and dependencies (a paid add-on). [S]
- Link types: relates to, duplicates, blocks, clones, and more on the cloud version. [S]
- Components, fix versions (releases), watchers, bulk change. [K]

**Linear** (the one people call fast)

- A global command menu; keyboard-first. The sources agree on the idea; exact key bindings were not
  confirmed, so none are copied here. [S]
- Cycles: time-boxed iterations where unfinished work carries over automatically; capacity views. [S]
- Projects (a dated goal that groups issues, with health such as "at risk") and Initiatives (a
  group of projects). [S]
- Triage: an inbox for work arriving from integrations, forms or people outside the team, with
  ordered rules that set team, status, assignee, label, project or priority, and an optional rotating
  triage owner. [S]
- Sub-issues, issue templates and project templates. [S]
- Custom views, saved at workspace or team scope, with Slack or personal notifications when items
  join or finish. [S]
- SLAs from rules (for example 24 hours for Urgent, a week for High), with business-day support. [S]
- A combined board-and-list view. [S]
- "My issues" and an inbox of notifications. [K]

**GitHub Issues and Projects**

- Sub-issues (hierarchies of issues), issue types, and organisation-wide custom issue fields. [S]
- Project views you can filter, group by (including by parent issue) and slice by field value. [S]
- Known gaps people complain about: no easy "only issues without a parent" filter on boards. [S]

**YouTrack**

- A command dialog: type a short phrase to set a state, add a tag or link tickets, and apply it to
  one or many selected tickets at once. [S]
- Saved searches you can reuse inside other searches (`#name`). [S]
- Typed links with automatic reverse links (`depends on`, `duplicates`, `parent for`,
  `subtask of`, `relates to`). [S]
- Time tracking: `add work 1h30m`, parents total their subtasks, an optional timer. [S]
- A knowledge base whose articles link to tickets. [S]

**Plane, Shortcut, Height**

- Plane (open source): cycles, modules, commands and shortcuts. [S]
- Shortcut: documents, sprint planning, objectives and roadmap beside issue tracking. [S]
- Height: automation as the selling point, using AI. Skipped (deterministic by design). [S]

**What I take from them**

| Idea | From | Why it fits Forge |
| --- | --- | --- |
| Command menu and keyboard everywhere | Linear, YouTrack | The owner's "minimal but useful" and the later CLI both want a fast verb-first way to act |
| Quick create inside a column | Jira boards | The owner already asked what is missing from "the Jira board" |
| Bulk edit through one dialog | YouTrack | One implementation serves the list, the board selection and later the CLI |
| Typed links and sub-issues | all four | Core to planning and to the repository integration (blocked-by, duplicates) |
| Epics as a ticket type, with progress | Jira, GitHub | Reuses the parent link instead of a second concept |
| Triage inbox with rules | Linear | Gives intake a home before notifications and forms exist |
| Cycles, optional per project | Linear, Jira | A Kanban team should not be forced into sprints |
| Milestones with health | Linear Projects | Dated goals without a second hierarchy |
| A small query language shared with the filters | Jira (JQL), YouTrack | One parser feeds the filter bar, saved views and the CLI |
| Workflow guards on transitions | Jira validators | Required fields and blockers, without Jira's scheme maze |
| SLA reminders | Linear | Cheap once due dates and rules exist; optional |
| Typed links shown as warnings, not noise | Jira (blocks) | A blocker should be visible on the card and optionally stop completion |

**What I deliberately leave out**: screens and field schemes, per-issue-type workflows, a plugin
system, Gantt resource levelling, AI triage, real-time co-editing.

## The order, and why

Phases are mostly independent; the arrows are real dependencies. The order is a recommendation: speed
and structure first because they change daily use the most, configuration after they exist so the
admin screens have something to configure.

```text
P0 Tickets tab (List | Board)
 └─ P1 Everyday speed
     └─ P2 Structure (sub-issues, links, epics)
         ├─ P3 Rich content and files
         ├─ P4 Configuration (fields, workflow editor)
         └─ P5 Staying informed (watchers, inbox, My work, triage)
             └─ P6 Planning (backlog rank, cycles, milestones, reports)
                 └─ P7 Find and shape (query language, full text, group by, import/export)
                     └─ P8 Automation and extras (rules, SLAs, time, forms)
```

Sizes are in **tasks** of the kind the Stage 2 plan used (a task is a reviewable slice with tests).
They are rough; each phase's own plan will correct them.

### P0: The Tickets tab gets Board and List (about 6 tasks)

- Tab strip on the Tickets page: **Board | List**, remembered per person, address-based like the
  project pages. Room for later tabs (Backlog, Triage, Timeline).
- Workspace board: one column per status **key** (Cold Steel, Warming and so on) holding tickets from
  every project; same filters and saved views as the list; the Display menu settings are shared with
  project boards; which columns are hidden or ordered is stored separately for this board.
- Dragging applies the move in the ticket's own project; a move that project's workflow does not
  allow is refused with a message, as now. Each ticket carries what it needs for that check.
- New API route for the workspace board; the shared board types gain a "which project's statuses"
  idea.
- Unknown until Part B lets projects add statuses: columns for a status key only some projects have.
  For now every project has the same seven keys, and the rule is "group by key, take the name from
  the first project that has it" (my call).

### P1: Everyday speed (about 10 tasks)

- **Quick create**: a "+" at the top of each column (new ticket in that status) and a global create
  shortcut; title first, everything else optional.
- **Inline edit** of status, assignee, priority, labels and due date from list rows and from cards.
- **Bulk edit** (Part B5): select several tickets in the list or on the board and change status,
  assignee, priority, labels or due date in one step. Results are reported per ticket; partial
  success is never hidden.
- **Command menu** (Ctrl+K): jump to a ticket by key or title, create, act on the current ticket
  ("assign to me", "move to Tempering"), go to a project or view, switch tab.
- **Keyboard shortcuts** on the list, board and ticket page, with a "?" help sheet; every shortcut
  also exists as a visible control.
- **Duplicate** a ticket (fields and labels, not comments or history), **archive and unarchive**,
  copy key and link.
- **Ticket templates** (a bug report, a feature request): a prefilled create form.
- Acceptance: any common action takes at most two keystrokes through the command menu, and is also
  possible with a mouse.

### P2: Structure (about 9 tasks, builds Part B2)

- **Sub-issues**: a ticket can have a parent. Depth of up to three levels so that
  epic, ticket and subtask fit (my call; the earlier outline said two, which cannot hold an epic).
  Cycles in the chain are impossible (checked in a transaction).
- **Epics** are a ticket type that uses the same parent link. A parent shows a progress bar rolled up
  from its children's status categories (not started, in progress, completed).
- **Typed links**: blocks and is blocked by, relates to, duplicates and is duplicated by. Stored once
  in one direction and shown with the inverse wording. No self links.
- **Blocked is visible**: a card with an open blocker says so. A project setting, on by default,
  stops a ticket completing while a blocker is open (a workflow guard).
- **Duplicate resolution**: marking a ticket as a duplicate links it and moves it to Scrapped with
  one action.
- The list can show the tree (expand a parent); the board can filter to top-level tickets only
  (the gap GitHub users complain about).
- New filters: parent, epic, "has blocker", linked to.

### P3: Rich content and files (about 10 tasks; includes Part B3)

- **Markdown subset** for descriptions and comments: headings, emphasis, lists, task lists with
  checkboxes, quotes, code, links. Rendered by a fixed allow-list; raw HTML is never accepted and
  nothing user-written reaches the page as markup. This replaces the plain-text rule, so it is an
  owner decision below. Existing plain text still displays correctly (a stray `*` may format).
- **Mentions** of members (`@name`, stored as user ids so renames do not break them) and
  **ticket references** (`WEB-12` becomes a link; the target shows a "mentioned in" line).
- **Attachments** (and paste an image): 10 MB limit, an allow-list of types checked by content
  signature, SVG and HTML refused, served as downloads with `nosniff`, random storage keys, a check on
  every download, a storage driver interface (local disk for now).
- **Reactions** on comments (a small fixed set).
- Task-list checkboxes feed a "3 of 5" count on the card (hidden by default; a Display option).

### P4: Configuration, kept small (about 12 tasks; builds Part B1 and B4)

- **Custom fields**: short text, long text, number, yes/no, single and multi select, date, link,
  person, labels. Applied to chosen ticket types, shown on the ticket, usable as a filter, a sort and
  a card field. Type of a field never changes; deactivating hides but keeps values; deleting is
  refused while any ticket has a value; a select option in use cannot be removed.
- **Workflow editor** per project: add, rename, recolour (by category), reorder and deactivate
  statuses (a status in use asks where its tickets go); a transitions grid; "copy a workflow from
  another project".
- **Transition rules** (Jira's validators, kept small): "needs an assignee", "needs an estimate",
  "needs a comment", "no open blockers". Chosen per transition from a fixed list, no scripting.
- **Types, priorities, labels, components**: add, rename, reorder, deactivate; labels can be merged
  and recoloured; components can have a lead and a default assignee.
- **Project settings** page, including archive.

### P5: Staying informed (about 12 tasks; moves the ticket part of Stage 6 forward)

- **Watch** a ticket (Part B5). You watch what you create, are assigned or mention.
- **Notification inbox**: a bell and a page with assigned to you, mentioned you, comment or status
  change on something you watch, due soon and overdue. Read and unread, mark all as read, a
  per-event on and off switch. In-app first; email waits for a mail setup the project does not have
  yet (owner decision below).
- **My work** page: assigned to me, created by me, watching, grouped by status and due date.
- **Triage**: a queue for tickets that need a decision (made by people outside the team, by forms
  later, and by repository events later), with ordered rules that set project, assignee, labels or
  priority on arrival. An optional rotating triage owner.

### P6: Planning (about 16 tasks, the biggest phase; optional per project)

- **Backlog view** with manual ranking: drag to reorder, stored as a rank so a move changes one
  row, not hundreds. Rank is a sort option everywhere.
- **Estimates**: each project chooses points (a fixed scale) or time. One system per project,
  not both.
- **Cycles** (time-boxed iterations), switched on per project: planned scope, capacity, unfinished
  work carries over, a burndown. A Kanban team leaves them off.
- **Milestones** (Linear's "projects", Jira's fix versions): a dated goal that groups tickets, shows
  progress and a health flag (on track, at risk, off track).
- **Timeline** view of epics and milestones; blocked-by links show as dependencies.
- **Reports**: created versus resolved, cumulative flow, throughput, lead and cycle time, burndown and
  burnup, velocity (when cycles are on), age of tickets in a status.

### P7: Find and shape (about 14 tasks)

- **A small query language** (`status:forging assignee:me label:bug updated:>-7d order:priority`)
  parsed into the same structure the filters already use, so the filter bar, saved views, the
  command menu and the CLI all share one parser. Friendly errors, autocompletion, and saved queries
  are saved views.
- **Full-text search** of titles, descriptions and comments with ranking and highlights, replacing the
  current "key starts with or title contains" rule.
- **Group by** assignee, priority, epic, label or project (swimlanes on the board, groups in the list).
  This is the earlier optional Task 6.
- **Table view** with a column chooser and inline editing.
- **CSV export** of any view and **CSV import** with a mapping step (including a Jira export).
- **Cursor paging** in the API, replacing page numbers.

### P8: Automation and extras (later, decided when we get there)

- **Ticket rules** run by the deterministic workflow engine (the product spec's engine), not a second
  one: "when a ticket is Blocked for 7 days, comment and notify", "new ticket in a component goes to
  its default assignee", recurring tickets. Rules about pull requests wait for the repository system.
- **SLAs** by priority, in business days, with a breached marker.
- **Time tracking** (`1h30m` work logs, roll-ups to parents). Optional; YouTrack-style.
- **Public intake forms** feeding Triage.
- **Dashboards** of saved queries.

## What "done" looks like for the ticket system

We move on to repositories when all of this holds, each backed by a test that was run:

- Every phase P0 to P7 is built, verified and documented. P8 is decided, not necessarily built.
- A scripted "week of a small team" browser test (create, triage, plan a cycle, move, comment with a
  mention, attach a file, block and unblock, bulk edit, find it again, export) passes.
- Every action in the UI is also an authorised, tested API route, so nothing needs the browser.
- Tenant isolation and permission tests cover every new entity.
- The docs (`data-model`, `workflows`, `architecture`, `testing`, `known-limitations`) match the
  code.
- A fresh `npm ci` copy passes typecheck, lint, strict format and `next build`.

## Seams for the next steps

Built into the ticket plan now so that repositories and the CLI do not force rework:

- **Repository integration** will recognise ticket keys (`WEB-12`) in branch names, commit messages and
  pull-request titles, will link them to tickets, and will want to move tickets when a pull request
  opens or merges. So: (a) ticket keys stay stable and unique (they are); (b) status **categories**
  let a rule say "move to the first in-progress status" without naming a project's custom status;
  (c) typed links are a table with a `kind`, so external links (pull request, branch, commit) can be a
  second table later without changing tickets; (d) rule actions run through the same ticket update
  path as people, so history and permissions stay consistent.
- **Security gate (owner's design, 2026-10-23).** A merge into a repository runs a deterministic
  vulnerability scan (no AI). A critical finding **blocks the merge**, creates a ticket for the
  finding, moves the ticket the merge was for to Blocked and links it as "blocked by" the finding
  ticket. This leans on the ticket system in four places, so P2 and P8 must be built with it in mind:
  (a) typed **blocks / is blocked by** links, which P2 builds; (b) "no open blockers" as a rule that
  can stop a **merge** as well as a completion; (c) the system moving a ticket to Blocked and later
  back to **the status it had before**, so the ticket must remember it; (d) system-made changes
  recorded in the ticket's history with the rule that made them. The full rules are in
  [The security gate](#the-security-gate-built-with-the-repository-system).
- **Code in the ticket (owner's idea, restated 2026-10-27).** A ticket shows the code its work
  touches, and that code can be edited directly inside the ticket; the edit becomes real when the
  ticket's work is merged (welded), through the same security gate as any merge. So the ticket page
  keeps its shape (main column on the left for the description and other content, details on the
  right), and the main column must have room for a Code section later.
- **CLI** needs every action as an API route (a rule of this plan), the shared query parser (P7),
  JSON output from stable shapes, and **API access tokens**. The product only has cookie sessions
  today, so a token system is a dependency for step 4. It will be planned with the sign-in method,
  which is still undecided (a gap since Stage 1).

## The security gate (built with the repository system)

The owner's design, agreed on 2026-10-23. It belongs to the repository steps (2 and 3) because it
needs repositories and merges, which do not exist yet; it is written here because it shapes the
ticket system (P2 links, P8 rules).

**Rules (decided by the owner)**

1. Every merge into a repository runs a **deterministic vulnerability scan** (no AI): static rules over
   the code, dependency advisories, secrets and configuration. Forge runs established open-source
   scanners and reads their structured results; it does not invent its own detection.
2. A **critical** finding **blocks the merge**. No matter what, the merge cannot happen until the
   problem is fixed. There is no per-merge override and no "accept the risk".
3. The finding becomes a **ticket**: title, rule, file and lines, the quoted code, severity, the
   advisory or rule text, the fixed version where there is one, and the merge it came from. The text
   comes from a template filled with the scanner's data. Priority comes from a fixed table (for
   example CVSS 9.0 and above is Critical).
4. The ticket the merge belongs to moves to **Blocked** and is linked **blocked by** the finding
   ticket.
5. When someone moves the finding ticket to a completed status, **a new scan runs** to check the fix
   is real.
   - Fixed: the finding ticket stays done, the original ticket returns to the status it had before it
     was blocked, and the merge may go ahead.
   - Not fixed: the finding ticket goes back to in progress with a comment naming the file and line,
     and the merge stays blocked.
6. The merge itself scans the exact code being merged at the moment it happens, so a later commit
   cannot bring the problem back unseen.
7. **False alarms.** Nobody can skip the scan for one merge. A named role (a new permission) may change
   a **scan rule** for the whole workspace: switch a rule off, or exclude a path. The change needs a
   written reason, is recorded in the audit trail, is visible to everyone in the workspace, and applies
   to every later scan, never to one merge only.
8. If the scanner cannot run, the merge waits (fail closed).

**Mechanics (my calls)**

- Each finding has a fingerprint (rule, file, the code around it) so the same problem never makes two
  tickets and moving lines around does not make a new one.
- Every automatic change (ticket created, moved to Blocked, re-opened, unblocked) is written to the
  ticket's history as made by the security gate, naming the scan.
- The ticket stores the status it had before being blocked.
- Findings below critical make tickets but do not block.

9. **Only criticals introduced by the merge block it** (decided by the owner). Criticals already in the
   repository still get tickets but do not stop other people's merges.

**What the ticket system builds now so the gate drops in later** (the owner asked for the ticket
system first, "keeping it in mind so it is easy to implement"): typed blocker links (P2); a ticket
remembers the status it had before Blocked (P2); history entries made by the system, naming what made
them (P2); a guard "no open blockers" that any action can ask, not only completion (P2/P4); a
completed-status hook that rules can listen to (P8); a "source" on tickets so a ticket made by a scan
is marked as such (P2).

## The CLI (step 4 of the overall roadmap)

The owner named the first commands on 2026-10-27 ("let's leave it at this for now"; more will be
added later). The ticket commands can be built once the ticket system is done; the repository ones
(`heat`, `blaze`, `weld`) come with the repository system. Every command calls the same API the
screens use, so permissions, workflows and the security gate apply exactly as they do on the web.

| Command                           | Does                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `forge strike "title"`            | Creates a ticket                                                 |
| `forge catalogue`, `forge cat`    | Lists tickets                                                    |
| `forge inspect <ticket>`          | Opens a ticket                                                   |
| `forge <column> <ticket>`         | Moves a ticket to that column, e.g. `forge warming WEB-1`        |
| `forge scrap <ticket>`            | Moves a ticket to Scrapped (it can come back; nothing is erased) |
| `forge rekindle`, `forge rk`      | Reopens a ticket                                                 |
| `forge claim <ticket>`            | Assigns the ticket to you                                        |
| `forge rate <ticket> <priority>`  | Sets the priority, e.g. `forge rate WEB-1 blaze`                 |
| `forge heat`                      | Stages changes, like `git add`                                   |
| `forge blaze`                     | Commits, like `git commit`                                       |
| `forge weld`                      | Forge's merge, guarded by the security gate                      |

A move made with `forge <column>` follows the ticket's workflow like any other move, so a ticket
held by the security gate cannot be moved past it from the command line either.

Open points, to settle when the CLI is designed:

- **Ticket identifiers.** The owner's example used `ID0001`. Tickets already have a key that is
  unique in the workspace (`WEB-1`); the CLI could use that, or Forge could add a second,
  workspace-wide number.
- **Column words.** Multi-word columns need one word each: proposed `cold` (Cold Steel), `warming`,
  `forging` (In the Forge, since `forge forge` reads badly), `tempering`, `jammed`, `quenched`.
  Scrapped is `scrap`. A column a workspace adds later gets its word from its name; a column word
  can never take the name of a command.
- `blaze` is both the commit command and a priority name; it is unambiguous in use (`forge rate
  WEB-1 blaze` is a priority), but worth checking it does not confuse people.

## How each phase is run

Same as before: a short design when the screens are new, a detailed task plan written test-first,
real-Postgres API tests and browser tests, a mutation check on anything risky, docs updated in the
same phase, an honest report at the end with real counts, and nothing committed until the owner asks.
The visual companion is used for any new screen. No sub-agents unless asked.

## Decisions for the owner

**Accepted on 2026-10-23:** the owner asked to implement the plan, which accepts the recommendation
in each item below (Markdown subset, ranking and milestones with optional cycles, in-app notifications
first, time tracking and SLAs skipped, this order).

1. **Rich text (P3).** Today text is plain by design, so user content can never carry markup. Do you
   want a fixed Markdown subset (headings, lists, checkboxes, code, links, mentions)? I recommend yes.
2. **Planning (P6).** Do you want cycles and a timeline at all, or should Forge stay flow-first
   (Kanban) with backlog ranking and milestones only? I recommend building ranking and milestones,
   with cycles optional per project.
3. **Email (P5).** In-app notifications first, email later when there is a mail setup. OK?
4. **Time tracking and SLAs (P8).** Skip until asked? I recommend yes.
5. **Order.** Is speed, structure, content, configuration, notifications, planning, search, automation
   the right order, or is something above worth moving earlier?

Things I decided myself (change any of them): depth of three levels for sub-issues; one workflow per
project and no per-type workflows; one estimate system per project; rules use the existing
deterministic engine; plain-text history before P3 stays as it is; the workspace board groups by status
key.

## Sources and confidence

The web searches mostly returned third-party reviews and a few vendor pages. Points marked **[S]** rest
on these; everything marked **[K]** is general knowledge that was not re-checked.

- Jira overview and features (third-party reviews): https://www.larksuite.com/en_us/blog/jira-review,
  https://ones.com/blog/jira-issue-tracking-tool-core-features-setup-workflow-explained/
- Jira link types: https://confluence.atlassian.com/adminjiraserver/configuring-issue-linking-938847862.html,
  https://support.atlassian.com/jira-software-cloud/docs/link-issues/
- Linear triage: https://linear.app/docs/triage; concepts: https://linear.app/docs/conceptual-model;
  views: https://linear.app/docs/custom-views; SLAs: https://linear.app/docs/sla
- Linear sub-issues and projects (2019 changelog, may be dated):
  https://linear.app/changelog/2019-07-28-projects
- GitHub: https://github.com/orgs/community/discussions/154148 and
  https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/best-practices-for-projects
- YouTrack commands: https://www.jetbrains.com/help/youtrack/server/apply-commands-to-issues.html;
  search: https://www.jetbrains.com/help/youtrack/server/search-and-command-attributes.html;
  time tracking: https://www.jetbrains.com/help/youtrack/server/add-work-items-to-issue.html
- Plane, Shortcut, Height (comparison pages, not vendor docs): https://toolradar.com/compare/plane-vs-height,
  https://getguru.com/reference/shortcut-vs-height
