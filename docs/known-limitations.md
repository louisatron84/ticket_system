# Known limitations

Honest status at **Stage 2, Part A** (projects, tickets, comments, the list and the board). If it is
not listed as working in the README, assume it does not exist yet.

## Not built yet

- **Any way to sign in outside development.** Only the development account switcher exists. The
  session layer is built so a real login method can be added, but which one (email and password,
  GitHub OAuth, magic link) is still to be decided and built. Until then the sign-in page says
  "Sign-in isn't configured for this environment yet" wherever development sign-in is off.
- **Stage 2, Part B.** Not started: custom fields, ticket relationships and subtasks, attachments,
  the administrator screens for editing statuses, transitions, ticket types and priorities, and
  subscribing to a ticket. (Bulk edit, duplicate and archive arrived with P1.) A ticket cannot be
  deleted or moved to another project from the screens, and archiving a project exists in the API
  only.
- **GitHub integration, code review, workflows (automation), search, notifications and an audit
  viewer.** The sidebar lists only pages that exist; the rest are `planned` in
  `apps/web/src/lib/nav.ts` and not rendered.
- **Invitations, removing members, creating workspaces, editing roles.** Members and their roles are
  seeded; role changes between existing roles work. Role editing and invitations are Stage 6.
- **Background worker.** There is no `apps/worker` and no job table yet; both arrive with the first
  feature that needs a durable job (GitHub webhooks, Stage 3).
- **Light theme.** Colours are CSS variables so one can be added, but only the dark theme exists.

## Tickets and projects (what Part A deliberately does not do)

- **Board settings are personal, not shared.** The Display menu (card fields, density, heat,
  which columns show and in what order) is stored on each person's account and follows them between
  browsers, but a team cannot set a shared board layout. Hiding a column only hides the view of it.
- **Group by assignee or priority is not built.** The board's columns are always the project's
  statuses. It was designed as an optional last step (see the board design) and is waiting for the
  owner's go-ahead.
- **Settings for a project are limited to 20 statuses.** A project with more than 20 statuses
  (possible only once Part B lets projects add them) cannot save a column choice; the save is
  refused and the change is undone with a message.
- **Touch dragging is untested, and so is a screen reader**, as before; the new Display menu is
  keyboard-operable and its controls are real switches and radios, but it has only been exercised
  with a keyboard and a mouse.
- **Status and priority names changed.** Backlog, Open, In Progress, In Review, Blocked, Done and
  Cancelled are now Cold Steel, Warming, In the Forge, Tempering, Jammed, Quenched and Scrapped.
  Lowest, Low, Normal, High and Critical are now Heatless, Ember, Flame, Blaze and Inferno. History
  lines written before a rename keep the old names; new lines use the new ones. A workspace's own
  rename of a status or priority (when Part B allows it) is never overwritten by the migrations.
- **"Where you are" is steel blue**, not amber, in the focus ring, current tab, current sidebar
  item and drag target, because orange now means a status. Amber remains the brand colour and the
  colour of warnings.
- **Plain text only.** Titles, descriptions and comments have no formatting, no links that become
  clickable, no mentions and no images. Line breaks are kept. This was chosen so user text can never
  carry markup; richer text is a later decision.
- **The workflow is fixed per project.** Each project starts from the default seven statuses and
  their transitions ([workflows](workflows.md)); nothing can edit them until Part B. The board shows
  columns for **active** statuses only, which is every status today; once statuses can be
  deactivated, tickets sitting in one will need handling.
- **Paging is by page number**, not by cursor. Rows added or removed while someone pages can shift
  a ticket onto the neighbouring page. Page size is at most 100.
- **Board columns share the window's width but never get narrower than 14rem (224px).** On a wide
  window all six columns fit; on a laptop around 1366px wide about four fit and the board scrolls
  sideways for the rest. Collapsing the sidebar, hiding a column in the Display menu or choosing
  compact density fits more. The sideways scrollbar sits below the last card, so on a tall board
  it can be off-screen; there is no sticky scrollbar or "more columns" cue yet.
- **Board columns show up to 50 tickets.** A fuller column says how many there really are and links
  to the list. The board does not page inside a column. On the Tickets board the 50 are across all
  projects, so a busy column there fills up sooner.
- **The Tickets board groups by status key.** Today every project has the same seven statuses, so
  the columns are the familiar ones. Once Part B lets projects rename or add statuses, a column takes
  its name from the first project (by key) that has the status, and a status only some projects
  have gets its own column. There is no "group by project" (swimlanes) yet.
- **Bulk edit is on the list only**, one page at a time (up to 100 tickets), not on the boards.
  Due dates cannot be edited inline in the list.
- **A bulk change is not one transaction.** Each ticket is changed on its own, so some can succeed
  while others fail (the bar says which). An unarchive combined with another change can leave the
  ticket unarchived when the other change is refused. If the server fails unexpectedly part-way, the
  tickets already changed stay changed and the answer is an error without the per-ticket list.
- **Ticket templates** were moved to P4 (configuration), because they need a place to manage them.
- **Shortcuts are single keys and are not configurable.** They are listed with `?`; they never fire
  while typing in a field.
- **The Tickets page always opens on the List.** The Board tab is one click away; which tab a person
  used last is not remembered.
- **A ticket's timeline is not paginated.** All comments and history load with the page. Fine for
  tens or hundreds of entries; a ticket with thousands would be slow.
- **Saved views are uncapped** (no limit per person or workspace), and a view's scope (personal or
  shared) cannot be changed after it is created: save a shared copy instead.
- **Search is not full text.** The `q` filter finds tickets whose key _starts with_ the text
  (case-insensitive, so `web-1` also finds `WEB-10`) **or** whose title _contains_ it. It does not
  search descriptions or comments. A trigram index supports the title search, but no `EXPLAIN` was
  run to confirm Postgres uses it on a large table.
- **"Due this week" is a rolling seven days** from today, not a calendar week, and "today" and
  "overdue" use the **UTC** date, not the viewer's time zone. Near midnight a ticket can read as
  overdue a few hours early or late.
- **`archived=true` adds archived tickets to the results** rather than showing only archived ones.
  No screen archives tickets yet, so nothing is archived in practice.
- **Editing a comment is limited to its author**, even for an owner. Deleting is allowed to the
  author or anyone with `tickets.edit`. Comments do not change a ticket's `updatedAt` or `version`,
  so "recently updated" ignores comment activity.
- **An assignee can be picked only by someone who may see the member list** (`members.view`). Anyone
  else sees the current assignee as text and cannot change it, even if they hold `tickets.assign`.
- **Assigning needs both `tickets.edit` and `tickets.assign`.** A custom role with assign but not
  edit cannot assign.
- **A page for a missing project or ticket inside your own workspace returns HTTP 200** with the
  not-found content. The page streams behind a loading skeleton, so the status code is already sent.
  A workspace you are not in is a real `404`. Search engines and monitors that read the status code
  would see a 200.
- **Ticket changes are not in the audit trail.** They are in the ticket's own history. Denied ticket
  attempts are not recorded anywhere.
- **No limits on counts.** Nothing caps projects, labels, components, comments or tickets per
  workspace, and there is no rate limiting (Stage 7).
- **The board's drag and drop was not tested on a touch screen.** The "Move to" menu on each card
  is the touch-friendly route.
- **`GET /favicon.ico` answers 404.** No icon is shipped yet; harmless but visible in the browser
  console and server log.
- **Estimates and due dates** accept values from 0 to 99,999 minutes and any real calendar date;
  there is no business-hours or time-zone handling.

## Security gaps (see also [security](security.md))

- No rate limiting or lockout on any route (Stage 7).
- No security response headers such as CSP or HSTS from the web app (Stage 7).
- Sessions have an absolute lifetime only: no idle timeout, no list of sessions, no "sign out
  everywhere". Expired and revoked sessions stay in the `sessions` table; nothing purges them yet.
- The audit trail is written (workspace rename, role changes including denied attempts, development
  sign-ins, projects, components, labels, shared views) but there is no screen to read it.
- Tenant-isolation tests cover the entities that exist today. Each later entity must add its own.

## Constrained or unverified

- **The database must be UTF-8.** A cluster created on Windows before Stage 2 may be WIN1252, which
  cannot store emoji or non-Latin text; `db:migrate` refuses it and says how to rebuild
  ([setup](setup.md#the-database-must-be-utf-8)). Rebuilding deletes the local data.
- **Docker Compose is untested.** `docker-compose.yml` was written but never run because Docker is
  not installed on the development machine. The `npm run db:start` path is the verified one.
- **Embedded PostgreSQL is development-only.** It is a 100 MB+ binary package intended for local use.
  There is no production database setup, backup or recovery procedure yet (Stage 7).
- **No production build for the API.** Internal packages are consumed as TypeScript source and the
  API runs through `tsx`. The web app does have a working `next build`.
- **No CI.** Checks run locally with `npm run check` and `npm run test:e2e`.
- **Mobile navigation drawer** does not trap focus or restore it on close. Escape and the backdrop
  close it, and it is keyboard operable, but it is not a full modal dialog. The account menu and
  workspace menu close on Escape and outside clicks but are disclosure panels, not full ARIA menus.
  The "New project" dialog is a modal and does trap focus.
- **`db:reseed` and the "Reset demo data" button delete every table's contents** in the development
  database, including any projects and tickets you created by hand. That is the point of them.
- **A development session cookie is shared by every port on `localhost`.** Running two stacks on
  different ports in one browser shows a sign-in page on the stack whose database does not know the
  cookie.
- **A line-ending warning on Windows.** With `core.autocrlf=true`, a checkout has CRLF files and
  `git status` lists many files as modified though their content is unchanged; `prettier --check`
  flags them as well (`--end-of-line auto` shows the real result). A `.gitattributes` file would
  settle it; it has not been added because it changes how every contributor's checkout behaves.
- **Dev-mode Next.js badge** is moved to the bottom-right so it does not cover the sidebar toggle;
  it can still sit over a toast in the corner on very narrow screens.
- **`npm audit`** reports 4 moderate advisories from an old `esbuild` bundled by `drizzle-kit`
  (development-only CLI; the advisory concerns esbuild's dev server, which is never started). The
  automatic fix is a breaking downgrade of `drizzle-kit`, so it is not applied. Revisit when
  `drizzle-kit` publishes a release that drops the dependency.
- **Browsers tested:** Microsoft Edge (Chromium) only.
- **The web and API servers bind to loopback** and are not intended to be exposed.
