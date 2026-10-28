# Testing

## Commands

| Command                  | Needs the database | What it runs                                                        |
| ------------------------ | ------------------ | ------------------------------------------------------------------- |
| `npm run check`          | yes                | typecheck, ESLint, Prettier check, then every workspace's tests     |
| `npm test`               | yes                | unit and integration tests only (Vitest)                            |
| `npm test -w @forge/api` | yes                | one workspace; swap in `@forge/web`, `@forge/db`, `@forge/shared`   |
| `npm run test:e2e`       | yes                | Playwright browser tests on an isolated stack that it starts itself |

Start the database first with `npm run db:start`. Integration and browser tests migrate and seed
their own databases, so no manual `db:migrate` is needed for them.

All three databases must be UTF-8 (see [setup](setup.md#the-database-must-be-utf-8)). Tests
store emoji and Arabic text on purpose, and a database in another encoding fails them (and
`db:migrate` refuses it before that).

After P3 (ticket parts, formatting, mentions, attachments, reactions, CLI tokens and the `forge`
command) the suites held roughly: shared 339 tests, database 112, API 916 (including the real `forge`
binary run against a live API in `cli-binary.test.ts`), web logic 424, CLI 5, browser 193. These
numbers drift; the commands print the live ones.

## What is covered

- **Unit tests** are pure and need nothing running: config validation, request-id sanitising, error
  mapping, health route behaviour (with fake checks), the shared schemas, permissions and the
  role-change rules, and the web app's navigation, workspace selection, role-option, API-client and
  status logic.
- **Integration tests** (`*.test.ts` in `apps/api` and `packages/db`) run against the real
  PostgreSQL named by `TEST_DATABASE_URL`:
  - the schema's constraints, including the composite foreign key that stops a membership using
    another organisation's role
  - migrations apply and are idempotent
  - the seed and the full reset
  - sessions: tampered, expired and revoked tokens, hashing at rest, `last seen` throttling
  - the account switcher routes: absent when disabled, key-only sign-in, foreign `Host` and
    `Origin` refused, one live session per switch, audit rows
  - a permission matrix of every identity against every organisation endpoint, plus escalation,
    mass-assignment, cross-tenant role ids, and a concurrency test (two owners demoting each other)
  - **tickets** (Stage 2): the schema's composite foreign keys (cross-workspace and cross-project
    references refused by the database itself), concurrency (20 tickets created at the same moment
    get distinct, consecutive numbers; two simultaneous saves of one ticket let exactly one win,
    ten rounds running; two simultaneous creations of the same label, component or view name let
    exactly one win), the permission matrix for every project, ticket, comment, label, component and view route, field
    validation at its boundaries (lengths, control characters, impossible dates), the workflow
    (allowed, refused, unknown and cross-project statuses; unchanged values are no-ops),
    `version` conflicts and two simultaneous edits, comment rules (author-only edit, who may
    delete), the timeline, every filter and sort against a fixed 12-ticket dataset with the exact
    expected tickets, paging, the search text being escaped, the board's columns, counts and
    50-ticket cap, and saved views (private, shared, cross-workspace)
  - **the Tickets board** (`workspace-board.test.ts`): who may see it, a column per status key with
    each total equal to the list filtered to that status, the project filter, every project's
    workflow (including an archived project's), a column named after the first project that has the
    key (mutation-checked: reversing the order fails it), a status only one project has getting its
    own column, and Northwind seeing only its own
- **Everyday speed (P1)**: archive, unarchive and duplicate (every role, history lines, archived
  tickets refusing edits and comments, a duplicate by someone who may not assign), create in a
  status, `GET /workflows`, and bulk changes (per-ticket results in request order, a move one
  ticket's workflow refuses, an archived ticket, unknown and foreign keys, labels added and removed,
  unarchive before other changes, more than 100 keys, assigning without `tickets.assign`). In the
  web logic: `bulkSummary`, `defaultTypeAndPriority`, `statusesAcross`, the selection reducer,
  command ranking and `shortcutFor` (every shortcut, never while typing, modifiers left alone).
- **Board settings** (the Display menu): the display and column schemas (strict, capped, `null`
  forgets a project); `resolveBoardDisplay`, `applyDisplayChange` and `undoOf`; the preferences
  merge in Postgres (changes made one after another, several at the same moment for ten rounds,
  different projects at the same moment, a bad value is a `422` that stores nothing, a read-only
  member may save their own, nobody sees anyone else's); the rename migration run against rows
  that look the way they did before it (only untouched default names change; running it twice
  changes nothing); and comment counts on the detail, the list and the board.
- **Web logic tests** (`apps/web/src/lib`) cover the pure decisions behind the screens, including
  `heatOf` (each default status, the category fallback, distinct shapes for neighbours, and every
  heat colour at least 3:1 against the surfaces read from `globals.css`) and `arrangeColumns`
  (what a saved choice means when the project's statuses have changed since): status and
  priority tones, due-date wording, relative time, the form's validation and estimate parsing, the
  filter bar's URL handling, saved-view helpers, the timeline's wording, and what the board
  allows a drop to do (checked against the ticket's own project: a status its project lacks, an
  archived project and an unknown project are all refused).
- **End-to-end tests** (`tests/e2e`) drive the real stack in a browser:
  - signing in and out, switching accounts, the back button after sign-out, replaying a cookie
  - what each role sees, and **crafted API calls that bypass the page** (the server must refuse)
  - a foreign workspace being indistinguishable from a missing one, and no data leaking after a
    switch
  - the shell: system status, sidebar (stored on the server, rendered collapsed on first paint),
    keyboard skip link, phone-width drawer, 404 page
  - the switcher refusing a foreign `Host` through the web proxy (DNS rebinding)
  - **projects** (`projects.spec.ts`): creating a project with the suggested key, a taken key
    explained beside the field, mistakes shown while typing, read-only and restricted views, and a
    foreign project being the same not-found page as a missing one
  - **tickets** (`tickets.spec.ts`): creating a ticket, each field saving on its own and appearing in
    the history, only allowed statuses offered, comments (add, edit, delete, plain text), a stale
    edit being refused with the typed text kept, role differences, crafted API calls that bypass the
    page, hostile markup being shown rather than run, and the list: filters from the address,
    "Me", "Overdue" and sorting, the empty state, a link with bad filters, and personal versus
    shared views
  - **the board's Display menu and columns** (`board.spec.ts`): each column carrying its heat; a
    card's comment count and priority; long, Arabic and emoji titles staying inside their card
    (mutation-checked: without the wrapping classes the test fails); turning a field off, saved and
    still off after a reload; settings being separate for each person; a read-only member using the
    menu; compact density present in the very first HTML the server sends; heat off making columns
    neutral; reset; Scrapped hidden by default; hiding, showing and reordering columns, remembered
    after a reload and separate for each project; every column hidden; moving a ticket into a
    hidden status; and drag and keyboard moves with a column hidden
  - **the board** (`board.spec.ts`): the seeded columns and counts, a mouse drag that survives a
    reload, a keyboard-only move (checking the announcements a screen reader would be given), the
    "Move to" menu, a refused move that leaves the card where it was, someone else's change being
    put right instead of overwritten, a read-only member having nothing to grab, filters, and Back
    after switching identity
  - **everyday speed**: the ticket page's actions and archived banner (`ticket-actions.spec.ts`);
    card menus and quick create on both boards, including keyboard focus returning to the right
    place (`board.spec.ts`, `tickets-board.spec.ts`); the list's inline Status, Priority and
    Assignee menus, including a row changed elsewhere (`tickets.spec.ts`); bulk edit with partial
    failure, labels, archive and select-all (`bulk.spec.ts`); the command menu
    (`command-menu.spec.ts`); and the shortcuts, including that none fires while typing
    (mutation-checked: removing the guard fails it) (`shortcuts.spec.ts`)
  - **the Tickets board** (`tickets-board.spec.ts`): Board and List tabs carrying the filters
    between them; every project's tickets by status, with every column on screen; an API ticket
    moved under its own workflow and still there after a reload; a refused move; column choices
    separate from a project's board; a saved board view with no project opening the Tickets board;
    a read-only member having nothing to grab

## Databases and isolation

Three databases, so nothing a test does can touch your development data:

| Database     | Used by                  | Wiped by                                     |
| ------------ | ------------------------ | -------------------------------------------- |
| `forge`      | `npm run dev`            | `npm run db:reseed` only                     |
| `forge_test` | Vitest integration tests | every test file, via `resetDatabaseForTests` |
| `forge_e2e`  | Playwright               | the e2e global setup and the dev-reset route |

`resetDatabaseForTests` **refuses to run** unless the connected database name ends in `_test` or
`_e2e`, and that guard has its own test using a fake connection. Test files that share a database
run one at a time.

## End-to-end specifics

- The browser tests start their own API (port 4100) and web app (port 3100, build folder
  `.next-e2e`) against `forge_e2e`, so they can run while `npm run dev` is up.
- Windows uses the Edge that ships with the OS, so no browser download is needed. On macOS or Linux
  run `npx playwright install chromium` once, or set `E2E_CHANNEL` to an installed channel.
- Tests wait until the page has hydrated before clicking (`hydrated()` in `tests/e2e/helpers.ts`);
  a click that lands earlier is silently lost.
- Set `E2E_SHOTS_DIR` to a folder to have the tests save screenshots there.

## Not covered yet

- React components have no unit tests (there is no jsdom setup); they are exercised by the browser
  tests instead.
- Browsers other than Edge (Chromium).
- **Touch dragging** on the board (the "Move to" menu is the touch-friendly route and is tested).
- **Screen readers.** The text a screen reader is told during a keyboard drag is asserted, but no
  screen reader has been run against the screens.
- **Large data.** Tests use at most a few dozen tickets. The title search has a trigram index, but
  no `EXPLAIN` or timing has been checked on thousands of tickets.
- **Mutation checks** (breaking the code on purpose to see a test fail) were done by hand on the
  riskiest code: the version check, the permission and workspace checks, the query builder, the
  board and saved views. There is no automated mutation tooling.
- A production sign-in flow, because none exists yet.
- Tenant isolation for entities that do not exist yet; each new entity must add its own.
