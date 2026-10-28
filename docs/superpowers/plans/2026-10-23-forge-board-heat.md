# Forge board, heat colours and forge names: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the board forge-themed status names, heat colours, a richer card and a per-person Display menu (card fields, density, heat, column visibility and order), then optionally group by assignee or priority.

**Architecture:** Status keys stay; only names change (template, seed, one data migration). A pure `heatOf(status)` function in the web app is the single source of status colour and symbol shape, used by every place a status is drawn. Display settings are validated in `@forge/shared`, stored in the person's existing preferences record (merged safely by the API), and rendered on the server for the first paint through a small client provider.

**Tech Stack:** Existing: npm workspaces, Fastify 5 + zod 4, Drizzle + Postgres 18, Next.js 16 App Router, React 19, Tailwind 4, `@dnd-kit/core`, Vitest, Playwright (Edge).

**Spec:** `docs/superpowers/specs/2026-10-23-board-heat-design.md` (approved 2026-10-23). Read it first; this plan does not repeat its reasoning.

## Global Constraints

- Work on a new branch `board-heat` created from `stage-2-tickets`. Commit only when the owner asks; each task ends with a checkpoint step, not an automatic commit. Commits use `git -c user.name=louis -c user.email=louisatron84@gmail.com`.
- Status keys never change: `backlog`, `open`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`. Saved views and filters store keys.
- Names, exactly: Backlog → `Cold Steel`; Open → `Warming`; In Progress → `In the Forge`; In Review → `Tempering`; Blocked → `Blocked`; Done → `Quenched`; Cancelled → `Scrapped`.
- Heat starting colours: cold `#7f8ea3`, warming `#9db0c6`, forge `#e8793a`, tempering `#f2c14e`, blocked `#c24d46`, quenched `#5b86b0`, scrapped `#76808f`. Every colour used for a symbol or an edge keeps at least 3:1 contrast against `--bg`, `--panel` and `--raised` from `apps/web/src/app/globals.css`. Text stays the normal text colour.
- Colour is never the only signal: every status keeps its symbol and its name.
- "Where you are" moves from `--ember` to `--active` in exactly five places: the focus outline (`globals.css`), `project-tabs.tsx` (current tab), `sidebar.tsx` (current item), `column.tsx` (drop target) and `sidebar-preference-switch.tsx` (accent). `--ember` stays for `brand-mark.tsx`, `login/page.tsx`, `dev-switcher.tsx` and `system-status.tsx`.
- Card fields: key, title and assignee are always shown. Switchable: labels, dueDate, priority, comments, type. Defaults: labels on, dueDate on, priority on, comments on, type **off**. Density `comfortable` (default) or `compact`. Heat on by default.
- By default the status with key `cancelled` is hidden on a person's board. A person's saved choice for a project replaces that default.
- Limits on saved settings: at most 20 status keys in each of `hidden` and `order`, at most 100 projects remembered.
- Plain text only, UTF-8 database, permissions enforced by the API. Settings are personal: any signed-in person may save their own, including a read-only member.
- Motion only in answer to a person's action; respect `prefers-reduced-motion`.
- Format check on this machine: `npx prettier --check --end-of-line auto .` (CRLF checkout). Run Bash for npm (PowerShell blocks `npm.ps1`). Do not stop or restart the owner's dev servers on 3000/4000/54329; use the e2e stack the Playwright config starts.

## Review Focus

Inputs and conditions the spec implies but does not spell out; each has a test in the task named.

1. A saved column order that names a status the project does not have, or lacks one it has gained: every status still appears exactly once, in a sensible order (Task 5, `arrangeColumns` tests).
2. Every column hidden: the board says so and offers the way back instead of rendering blank (Task 5, browser test).
3. Moving a ticket with "Move to" into a status that is hidden on this person's board: the ticket is not lost and the person is told where it went (Task 5, browser test).
4. Two settings changes racing (two tabs, or two projects): neither overwrites the other (Tasks 4 and 5, API tests).
5. A 200-character title with no spaces, an Arabic title and an emoji title: the card never widens its column or the page (Task 3, browser test).

## File Structure

- `packages/shared/src/tickets.ts`: template names; `commentCount` on the ticket summary.
- `packages/shared/src/board-display.ts` (new): card field keys and defaults, display and column-preference schemas, `resolveBoardDisplay`, `applyDisplayChange`. Pure, shared by the API's validation and the web app.
- `packages/shared/src/api.ts`: `preferencesSchema` gains `board` and `boardColumns`.
- `packages/db/migrations/0003_forge_status_names.sql` (new): data-only rename.
- `apps/api/src/tickets/read.ts`, `board.ts`; `apps/api/src/routes/preferences.ts`, `tickets.ts`: comment counts, safe preference merge, grouping.
- `apps/web/src/lib/heat.ts` (new): colour and symbol shape per status. `apps/web/src/lib/board-columns.ts` (new): column arrangement.
- `apps/web/src/components/tickets/badges.tsx`: `StatusGlyph`. `apps/web/src/components/board/`: `column.tsx`, `card.tsx`, `board.tsx`, new `prefs-provider.tsx`, new `display-menu.tsx`.
- `tests/e2e/board.spec.ts`, `tickets.spec.ts`, `projects.spec.ts`, `shell.spec.ts`: renamed statuses and the new behaviour.
- `docs/`: `workflows.md`, `data-model.md`, `architecture.md`, `testing.md`, `known-limitations.md`, README.

---

### Task 1: Forge status names

**Files:**
- Modify: `packages/shared/src/tickets.ts` (`DEFAULT_STATUS_TEMPLATE` names only)
- Create: `packages/db/migrations/0003_forge_status_names.sql` (generated with `npm run generate -w @forge/db -- --custom --name=forge_status_names`, which also writes the snapshot and journal entry; then fill in the SQL)
- Test: `packages/shared/src/tickets.test.ts`, `packages/db/src/status-names.test.ts` (new)
- Modify (names in expectations): `tests/e2e/{board,tickets,projects,shell}.spec.ts`, `apps/api/src/routes/{tickets,views}.test.ts`, `apps/api/src/test-support/ticket-dataset.ts`, and any component text that spells a status name (check `projects-table.tsx`, `topbar.tsx`, `projects/page.tsx` for status names, not the word "Open" in other senses)

**Interfaces:**
- Consumes: `createProject(executor, input)` from `@forge/db` (creates a project with the template's statuses).
- Produces: the seven names above, in `DEFAULT_STATUS_TEMPLATE.statuses` (same order, same keys), and migration `0003` that every later task's database already has applied.

- [ ] **Step 1: Create the branch.** `git switch -c board-heat` from `stage-2-tickets`. Expected: `git status -sb` shows `## board-heat`.
- [ ] **Step 2: Write the failing shared test** in `tickets.test.ts`: `'names the default statuses after the heat of the work'` asserts `DEFAULT_STATUS_TEMPLATE.statuses.map(s => [s.key, s.name])` equals the seven key/name pairs in order, and that `transitions` is unchanged (still 21 pairs).
- [ ] **Step 3: Write the failing migration test** `status-names.test.ts` using the same pool and reset helpers as `defaults.test.ts`. It reads `0003_forge_status_names.sql`, splits it on `--> statement-breakpoint`, and runs each statement. Tests: (a) after `createProject`, set each status back to its old name (`Backlog`, `Open`, `In Progress`, `In Review`, `Blocked`, `Done`, `Cancelled`), run the SQL, assert the seven new names; (b) a status whose key is `done` renamed by someone to `Shipped` is still `Shipped` afterwards while the others change; (c) running the SQL twice changes nothing more; (d) two workspaces' projects are both renamed.
- [ ] **Step 4: Run both to see them fail.** `npm test -w @forge/shared -- tickets` and `npm test -w @forge/db -- status-names`. Expected: FAIL (old names; migration file empty or missing).
- [ ] **Step 5: Change the template names** in `packages/shared/src/tickets.ts`. Keys, categories and transitions untouched.
- [ ] **Step 6: Write migration `0003`:** seven statements of the form `UPDATE project_statuses SET name = 'Cold Steel' WHERE key = 'backlog' AND name = 'Backlog';` (one per key, old name in the `WHERE`), separated by `--> statement-breakpoint`. Ticket history rows are not touched (they keep the names of their time).
- [ ] **Step 7: Run the two tests again.** Expected: PASS.
- [ ] **Step 8: Fix everything that spelled an old name.** Run `npm test` (all workspaces) and `npm run test:e2e`; for each failure caused by a renamed status, update the expectation (for example the board spec's `column(page, 'In Review')` becomes `'Tempering'`, aria-labels like `Backlog, 2 tickets` become `Cold Steel, 2 tickets`). Do not change unit tests that build their own literal data (for example `timeline.test.ts`, `ticket-events.test.ts`, `board.test.ts`): they are not about the template.
- [ ] **Step 9: Verify.** `npm test` exit 0; `npm run test:e2e` all pass; `npx prettier --check --end-of-line auto .` exit 0; `npm run typecheck` and `npm run lint` exit 0.
- [ ] **Step 10: Checkpoint.** `git diff --stat`. Commit only if the owner has asked: `Rename the default statuses after the heat of the work`.

---

### Task 2: Heat colours, symbols and the accent move

**Files:**
- Create: `apps/web/src/lib/heat.ts`, `apps/web/src/lib/heat.test.ts`
- Modify: `apps/web/src/components/tickets/badges.tsx` (`StatusGlyph`, `StatusBadge`), `apps/web/src/components/board/column.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/components/shell/sidebar.tsx`, `apps/web/src/components/projects/project-tabs.tsx`, `apps/web/src/components/profile/sidebar-preference-switch.tsx`
- Modify: `apps/web/src/lib/tickets.ts` and `tickets.test.ts` only to remove `statusTone`/`StatusTone` if nothing else uses them after this task
- Test: `tests/e2e/board.spec.ts`, `tests/e2e/tickets.spec.ts`

**Interfaces:**
- Produces (in `heat.ts`):
  - `type HeatToken = 'cold' | 'warming' | 'forge' | 'tempering' | 'blocked' | 'quenched' | 'scrapped'`
  - `const HEAT_COLOURS: Record<HeatToken, string>` (the hex values in Global Constraints)
  - `function heatOf(status: { key: string; category: StatusCategory }): HeatToken`: the seven default keys map to their token (`backlog`→cold, `open`→warming, `in_progress`→forge, `in_review`→tempering, `blocked`→blocked, `done`→quenched, `cancelled`→scrapped); any other key falls back by category (`not_started`→cold, `in_progress`→forge, `completed`→quenched).
  - `type GlyphShape = 'dashed-ring' | 'ring' | 'half-ring' | 'barred-ring' | 'tick' | 'struck-ring'` and `function glyphShapeOf(token: HeatToken): GlyphShape` (cold→dashed-ring, warming→ring, forge and tempering→half-ring, blocked→barred-ring, quenched→tick, scrapped→struck-ring).
- Produces (DOM): `StatusGlyph` renders an `svg` with `data-heat="<token>"`; `BoardColumn`'s `section` carries `data-heat="<token>"`. Later tasks and tests rely on these attributes.
- `BoardColumn` gains a prop `heat?: boolean` (default `true`); when `false` it renders the neutral column (no coloured edge or tint) and the glyph colour is unchanged.

- [ ] **Step 1: Write failing unit tests** in `heat.test.ts`: `'maps each default status key to its heat'` (seven assertions); `'falls back by category for a status it does not know'` (key `qa`, each of the three categories); `'gives neighbouring default statuses different shapes'` (cold≠warming, forge≠blocked, warming≠forge); `'keeps every heat colour readable on the surfaces'`, which reads `--bg`, `--panel` and `--raised` out of `globals.css` with `fs`, computes WCAG contrast with a small helper inside the test, and asserts each `HEAT_COLOURS` value is at least 3 against each surface.
- [ ] **Step 2: Run to see them fail.** `npm test -w @forge/web -- heat`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `heat.ts`** with the signatures above.
- [ ] **Step 4: Run again.** Expected: PASS (if a colour fails the contrast test, lighten that colour until it passes; do not lower the threshold).
- [ ] **Step 5: Rebuild `StatusGlyph`** in `badges.tsx` to take its colour from `HEAT_COLOURS[heatOf({ key: statusKey ?? '', category })]` (inline `style={{ color }}`) and its shape from `glyphShapeOf`; draw the six shapes (the existing ring, half ring, tick and struck ring, plus a dashed ring and a ring with a centre bar), set `data-heat`. `StatusBadge` and every caller keep working unchanged.
- [ ] **Step 6: Colour the board column** in `column.tsx`: a 2px top edge in the heat colour and a faint tint fading out over the first 90px (a `linear-gradient` mixing the colour at 14% into `--panel`, as in the approved mockup `board-combined-v4.html`), `data-heat`, and the `heat` prop. The header's glyph already carries the colour.
- [ ] **Step 7: Move the accent** in exactly the five places listed in Global Constraints, from `--ember` to `--active` (`border-active`, `before:bg-active`, `accent-[var(--active)]`, `outline: 2px solid var(--active)`, and the sidebar glow `var(--active)`). Leave the four `--ember` uses that mean brand or warning.
- [ ] **Step 8: Remove `statusTone`** from `tickets.ts` and its tests if `grep` shows no remaining use.
- [ ] **Step 9: Browser tests.** In `board.spec.ts` add `'each column carries the heat of its status'`: the columns Cold Steel, Warming, In the Forge, Tempering, Blocked, Quenched have `data-heat` `cold`, `warming`, `forge`, `tempering`, `blocked`, `quenched`. In `tickets.spec.ts` add `'the ticket page shows the status symbol in its heat'`: open WEB-3 and expect the Status field's `svg[data-heat="tempering"]`.
- [ ] **Step 10: Look at it.** With the e2e stack running, take screenshots of the board, the project list page and a ticket page at 1440px and 390px wide using a throwaway Playwright script kept outside the repo (scratchpad), and check by eye that: the board matches the approved mockup, the six symbols are distinguishable with the colour removed (view one in greyscale), and the focus ring and current tab are blue.
- [ ] **Step 11: Verify.** `npm test -w @forge/web` exit 0; `npm run test:e2e -- tests/e2e/board.spec.ts tests/e2e/tickets.spec.ts` all pass; typecheck, lint, prettier (`--end-of-line auto`) exit 0.
- [ ] **Step 12: Checkpoint.** `git diff --stat`; commit only if asked: `Colour statuses by heat and move the accent to steel blue`.

---

### Task 3: The Rich card and comment counts

**Files:**
- Modify: `packages/shared/src/tickets.ts` (`ticketSummarySchema`), `apps/api/src/tickets/read.ts`
- Create: `packages/shared/src/board-display.ts` (card fields only for now), export it from the package index
- Modify: `apps/web/src/components/board/card.tsx`, `apps/web/src/components/board/board.tsx` (pass default fields)
- Test: `packages/shared/src/tickets.test.ts`, `apps/api/src/routes/tickets.test.ts`, `apps/api/src/routes/board.test.ts`, `tests/e2e/board.spec.ts`

**Interfaces:**
- Produces (shared, `board-display.ts`): `const CARD_FIELD_KEYS = ['labels','dueDate','priority','comments','type'] as const`; `type CardFields = Record<(typeof CARD_FIELD_KEYS)[number], boolean>`; `const DEFAULT_CARD_FIELDS: CardFields` (`type: false`, the rest `true`).
- Produces (API): every `TicketSummary` and `TicketDetail` has `commentCount: number` (non-negative integer; counts only that ticket's comments in that workspace).
- Produces (web): `CardBody` and `DraggableCard`/`CardOverlay` accept `fields: CardFields` (default `DEFAULT_CARD_FIELDS`).

- [ ] **Step 1: Failing schema test.** In `tickets.test.ts`: `'a ticket summary carries a comment count'` parses a summary with `commentCount: 2`, and rejects a summary without it and one with `-1`.
- [ ] **Step 2: Failing API tests.** In `tickets.test.ts` (detail) and the list/board tests: `'counts comments on the ticket, the list and the board'` posts two comments to one ticket through the API and expects `commentCount` 2 on that ticket's detail, list row and board card, and 0 on a ticket with none; `'a deleted comment is no longer counted'`; `'never counts another ticket's or another workspace's comments'` (comment on a ticket of the other workspace, count unchanged).
- [ ] **Step 3: Run to see them fail.** `npm test -w @forge/shared -- tickets` and `npm test -w @forge/api -- tickets board`. Expected: FAIL.
- [ ] **Step 4: Implement.** Add `commentCount: z.number().int().nonnegative()` to `ticketSummarySchema`. In `read.ts` add `commentCountsFor(executor, organisationId, ticketIds): Promise<Map<string, number>>` (one grouped count over `ticketComments`, scoped by workspace, like `labelsFor`) and pass the count into `toSummary(row, labels, commentCount)`; `loadTicketSummaries` and `loadTicketDetail` both supply it.
- [ ] **Step 5: Run again.** Expected: PASS; `npm test -w @forge/api` fully green (fix any fixture that builds a summary by hand).
- [ ] **Step 6: Create `board-display.ts`** with the three exports above.
- [ ] **Step 7: Rebuild the card** in `card.tsx` as the approved Rich card: top row grip, key, priority bars (only if `fields.priority`; the priority's name is present as visually hidden text) and, at the right, the comment count with a speech-bubble icon (only if `fields.comments` and the count is above zero) then the move menu; the title as the link, up to three lines; up to two labels with "+n" (only if `fields.labels`); a bottom row with the due date in words (only if `fields.dueDate` and a date exists) and, if `fields.type`, the type icon, and at the right the assignee. Long or unbroken text must wrap or truncate inside the card.
- [ ] **Step 8: Browser tests** in `board.spec.ts`: `'a card shows its comment count and priority'` (after posting two comments by API to WEB-3, the card contains `2` and the text `High`); `'awkward titles never widen a column or the page'` creates, by API, tickets titled with 200 characters and no spaces, `'مشكلة في صفحة الدفع على الهاتف'` and `'🔥 Fix the forge 🔨'`, opens the board, and asserts each card's `scrollWidth` is at most its `clientWidth`, and `document.documentElement.scrollWidth` is at most `window.innerWidth`.
- [ ] **Step 9: Verify.** shared, api, web suites exit 0; `npm run test:e2e -- tests/e2e/board.spec.ts` passes; screenshot the board and compare with the mockup's cards; typecheck, lint, prettier exit 0.
- [ ] **Step 10: Checkpoint.** `git diff --stat`; commit only if asked: `Show a richer card on the board, with comment counts`.

---

### Task 4: Display settings and the Display menu

**Files:**
- Modify: `packages/shared/src/board-display.ts`, `packages/shared/src/api.ts`, `apps/api/src/routes/preferences.ts`
- Create: `apps/web/src/components/board/prefs-provider.tsx`, `apps/web/src/components/board/display-menu.tsx`
- Modify: `apps/web/src/components/board/{board,card,column}.tsx`, `apps/web/src/app/(app)/w/[slug]/projects/[key]/board/page.tsx`
- Test: `packages/shared/src/board-display.test.ts` (new), `apps/api/src/routes/preferences.test.ts`, `tests/e2e/board.spec.ts`

**Interfaces:**
- Consumes: `CardFields`, `DEFAULT_CARD_FIELDS` (Task 3); `BoardColumn`'s `heat` prop (Task 2); `FilterPopover` (`components/tickets/filter-popover.tsx`), `apiFetch` (`lib/api-client`), `useDismiss`.
- Produces (shared):
  - `const BOARD_DENSITIES = ['comfortable','compact'] as const`
  - `boardDisplaySchema`: `z.strictObject({ fields: z.strictObject({ labels, dueDate, priority, comments, type: z.boolean() }).partial(), density: z.enum(BOARD_DENSITIES), heat: z.boolean() }).partial()`; `type BoardDisplayPrefs`
  - `type BoardDisplay = { fields: CardFields; density: (typeof BOARD_DENSITIES)[number]; heat: boolean }`; `const DEFAULT_BOARD_DISPLAY`
  - `function resolveBoardDisplay(saved: BoardDisplayPrefs | undefined): BoardDisplay` (saved values over defaults, field by field)
  - `function applyDisplayChange(current: BoardDisplay, change: BoardDisplayPrefs): BoardDisplay`
  - `preferencesSchema` gains `board: boardDisplaySchema.optional()`
- Produces (API): `PATCH /api/v1/me/preferences` merges `board` **one level deeper than before**: fields of `board` and of `board.fields` merge, and other stored keys (`sidebarCollapsed`) are untouched.
- Produces (web): `BoardPrefsProvider({ initialDisplay: BoardDisplay; children })` and `useBoardPrefs(): { display: BoardDisplay; updateDisplay(change: BoardDisplayPrefs): void; resetDisplay(): void }`. `updateDisplay` applies at once, sends `PATCH /api/v1/me/preferences` with `{ board: change }`, and on failure restores the previous value and shows the toast `Couldn't save your board settings.` `resetDisplay` sends the full defaults. `DisplayMenu` takes no props in this task.
- Produces (DOM): the board root has `data-density="comfortable|compact"`; the Display button is a button named `Display`.

- [ ] **Step 1: Failing shared tests** in `board-display.test.ts`: `'accepts a partial display'`, `'rejects unknown keys, non-boolean fields and an unknown density'`, `'resolves saved values over the defaults field by field'` (only `fields.labels: false` saved, everything else default), `'applies a change without touching other fields'`.
- [ ] **Step 2: Failing API tests** in `preferences.test.ts`: `'merges board changes made one after another'` (PATCH `{board:{density:'compact'}}`, then `{board:{heat:false}}`: both present); `'merges card fields'` (`{board:{fields:{labels:false}}}` then `{board:{fields:{type:true}}}`: both present); `'leaves the sidebar preference alone'`; `'refuses a bad board setting with 422 and stores nothing'` (unknown key, `heat: 'yes'`, `density: 'huge'`); `'lets a read-only member save their own settings'`; `'never mixes two people's settings'`. Review Focus 4 is the first two.
- [ ] **Step 3: Run to see them fail.** `npm test -w @forge/shared -- board-display`, `npm test -w @forge/api -- preferences`. Expected: FAIL.
- [ ] **Step 4: Implement shared** (`board-display.ts`, `api.ts`).
- [ ] **Step 5: Implement the merge** in `routes/preferences.ts`: replace the single top-level `||` with a merge that also merges `board` and `board.fields` inside Postgres (one statement, so two quick requests cannot lose each other's change). Keep `loadPreferences` as the source of the response.
- [ ] **Step 6: Run again.** Expected: PASS; the existing preferences tests still pass.
- [ ] **Step 7: Build the provider and menu.** `BoardPrefsProvider` as specified. `DisplayMenu` is a `FilterPopover` with the label `Display` containing: **Show on cards** (five switches: `<input type="checkbox" role="switch">` with the visible labels Labels, Due date, Priority, Comment count, Type), **Density** (a two-option radio group: Comfortable, Compact), **Colour** (one switch: "Heat colours on columns"), and a **Reset to default** button. All controls are keyboard-operable and named.
- [ ] **Step 8: Use the settings.** The board page wraps the filter bar and board in `BoardPrefsProvider initialDisplay={resolveBoardDisplay(viewer.preferences.board)}` and puts `DisplayMenu` in the filter bar's `trailing` slot next to the saved-views menu, so the first paint already has the person's settings. `Board` reads `display` from the provider: passes `fields` to every card, `heat` to every column, and renders `data-density` on its root. Compact density: tighter padding, one-line titles, no labels row. Comfortable is the approved mockup.
- [ ] **Step 9: Browser tests** in `board.spec.ts`: `'turning a field off removes it from every card and is remembered'` (open Display, switch off Due date, WEB-3 no longer shows `Tomorrow`, reload, still off); `'settings are per person'` (change as Dana, then `switchTo` Olivia: Olivia still sees the defaults); `'a read-only member can use the Display menu'`; `'compact density is applied on the first paint'` (set compact, then fetch the board page HTML with `page.request.get` and expect `data-density="compact"` in it); `'heat can be turned off'` (columns keep their `data-heat` but have no coloured edge: assert the column's computed `border-top-color` differs between heat on and off); `'Reset to default'` restores the defaults.
- [ ] **Step 10: Verify.** shared, api, web suites exit 0; `npm run test:e2e -- tests/e2e/board.spec.ts` passes; screenshot the open menu at 1440px and 390px (it must not overflow the phone width); typecheck, lint, prettier exit 0.
- [ ] **Step 11: Checkpoint.** `git diff --stat`; commit only if asked: `Add the Display menu with settings saved per person`.

---

### Task 5: Columns: show, hide and reorder

**Files:**
- Modify: `packages/shared/src/board-display.ts`, `packages/shared/src/api.ts`, `apps/api/src/routes/preferences.ts`, `packages/shared/src/tickets.ts` (export the status-key pattern if not already shared)
- Create: `apps/web/src/lib/board-columns.ts`, `apps/web/src/lib/board-columns.test.ts`
- Modify: `apps/web/src/components/board/{prefs-provider,display-menu,board}.tsx`, the board `page.tsx`
- Test: `packages/shared/src/board-display.test.ts`, `apps/api/src/routes/preferences.test.ts`, `tests/e2e/board.spec.ts`

**Interfaces:**
- Consumes: `BoardPrefsProvider`, `DisplayMenu` (Task 4); `Board['columns']` (each has `status: { key, name, sortOrder }`, `total`, `tickets`).
- Produces (shared): `boardColumnPrefsSchema = z.strictObject({ hidden: z.array(statusKey).max(20), order: z.array(statusKey).max(20) })`; `type BoardColumnPrefs`; `const DEFAULT_HIDDEN_STATUS_KEYS = ['cancelled'] as const`; `preferencesSchema` gains `boardColumns: z.record(projectKey, boardColumnPrefsSchema.nullable())` refined to at most 100 keys, where `projectKey` matches `PROJECT_KEY_PATTERN` and `statusKey` matches `^[a-z0-9][a-z0-9_-]{0,39}$`.
- Produces (API): `PATCH` with `{ boardColumns: { WEB: {...} } }` replaces only that project's entry and keeps other projects' entries; `{ boardColumns: { WEB: null } }` removes it (back to the default).
- Produces (web, `board-columns.ts`), generic over `T extends { status: { key: string; sortOrder: number } }`:
  - `arrangeColumns<T>(columns: T[], saved: BoardColumnPrefs | undefined): { layout: { column: T; shown: boolean }[]; shown: T[] }`: order is the saved `order` keys that exist, then every remaining column by `sortOrder`; hidden is `saved.hidden`, or `DEFAULT_HIDDEN_STATUS_KEYS` when nothing is saved; keys that name no column are ignored; each column appears exactly once.
  - `prefsFromLayout(layout: { column: { status: { key: string } }; shown: boolean }[]): BoardColumnPrefs`
  - `moveColumn(order: string[], key: string, by: -1 | 1): string[]` (no change at either end or for an unknown key)
- Produces (web): `useBoardPrefs()` also returns `columnPrefs: BoardColumnPrefs | undefined`, `setColumnPrefs(prefs: BoardColumnPrefs | null)` (optimistic, same failure behaviour as `updateDisplay`, PATCHes `{ boardColumns: { [projectKey]: prefs } }`); `BoardPrefsProvider` gains `projectKey: string` and `initialColumns: BoardColumnPrefs | undefined`; `DisplayMenu` gains `columns: { key: string; name: string; total: number }[]` (all statuses of the project, in workflow order, from the page's fresh server data).

- [ ] **Step 1: Failing lib tests** in `board-columns.test.ts`: `'hides Scrapped by default and shows the rest in workflow order'`; `'follows a saved order and a saved hidden list'`; `'puts a status the saved order has never seen after the saved ones, by workflow order'` and `'ignores saved keys for statuses the project no longer has'` and `'shows every status exactly once whatever is saved'` (Review Focus 1); `'a saved empty hidden list shows everything, including Scrapped'`; `moveColumn` at the ends and for an unknown key; `prefsFromLayout` round-trips with `arrangeColumns`.
- [ ] **Step 2: Failing shared and API tests.** Shared: schema accepts a valid entry and `null`, rejects 21 keys, a lower-case project key, an unknown field. API: `'keeps another project's columns when one project changes'` (WEB then API: both stored), `'removes a project's entry with null'`, `'refuses more than 100 projects'` (Review Focus 4).
- [ ] **Step 3: Run to see them fail.** `npm test -w @forge/web -- board-columns`, `npm test -w @forge/shared -- board-display`, `npm test -w @forge/api -- preferences`. Expected: FAIL.
- [ ] **Step 4: Implement** shared schemas, the API merge for `boardColumns` (per-project replace inside Postgres, `null` deletes the key), and `board-columns.ts`.
- [ ] **Step 5: Run again.** Expected: PASS.
- [ ] **Step 6: Wire the board.** `Board` renders only `shown` columns from `arrangeColumns(state.board.columns, columnPrefs)`. The dnd columns, the keyboard jump and the announcements keep working with fewer columns. `targetsFor` and `statusName` still search **all** columns, so "Move to" lists hidden statuses. When `shown` is empty the board renders a message, "Every column is hidden. Open Display to show some." (Review Focus 2). After a "Move to" into a status that is not shown, show the toast `<KEY> moved to <status name>, which is hidden on your board.` (Review Focus 3).
- [ ] **Step 7: The Columns section of the menu**: one row per status in current display order: a show/hide switch named `Show <status name>`, the ticket count, and two buttons named `Move <status name> up` and `Move <status name> down` (disabled at the ends). Changes call `setColumnPrefs(prefsFromLayout(...))`. **Reset to default** also calls `setColumnPrefs(null)`.
- [ ] **Step 8: Browser tests** in `board.spec.ts` (update the existing "a column for every status" test: the board now shows six columns and Scrapped is hidden until switched on): `'Scrapped is hidden by default and can be shown'`; `'hiding a column removes it and is remembered after a reload'`; `'a column can be moved with the buttons and keeps its place after a reload'`; `'column choices are separate for each project'` (hide a column on WEB, API still shows it); `'every column hidden says so and the way back works'`; `'moving a ticket into a hidden status tells the person where it went'` (hide Blocked, "Move to" Blocked on WEB-2, toast text as in Step 6, ticket absent from the board, present in the list); `'drag and keyboard moves still work with a column hidden'`.
- [ ] **Step 9: Verify.** All unit and integration suites exit 0; `npm run test:e2e` all pass (full run, once); screenshot the menu's Columns section; typecheck, lint, prettier exit 0.
- [ ] **Step 10: Checkpoint.** `git diff --stat`; commit only if asked: `Let people show, hide and reorder board columns`.

---

### Task 6: Group by assignee or priority (optional; build only if the owner still wants it after Task 5)

**Files:**
- Modify: `packages/shared/src/tickets.ts` (`boardSchema`), `packages/shared/src/board-display.ts`, `apps/api/src/tickets/board.ts`, `apps/api/src/routes/tickets.ts`, `apps/web/src/lib/board.ts`, `apps/web/src/components/board/{board,column,card,display-menu}.tsx`, the board `page.tsx`
- Test: `apps/api/src/routes/board.test.ts`, `apps/web/src/lib/board.test.ts`, `packages/shared/src/tickets.test.ts`, `tests/e2e/board.spec.ts`

**Interfaces:**
- Consumes: Task 5's board and preferences; `PATCH /tickets/:key` with `assigneeId` or `priorityId` and `version` (unchanged).
- Produces (shared): `boardSchema` becomes a discriminated union on `groupBy`: `{ groupBy: 'status', columns: [existing shape] }` or `{ groupBy: 'assignee' | 'priority', columns: { id: string; name: string; total: number; tickets: TicketSummary[] }[] }`. For `assignee`, `id` is a user id, or the literal `'unassigned'`; for `priority`, a priority id. `BOARD_GROUPS = ['status','assignee','priority'] as const`; `boardDisplaySchema` gains `groupBy: z.enum(BOARD_GROUPS)` (default `'status'`).
- Produces (API): `GET /projects/:projectKey/board?groupBy=assignee|priority` (absent means `status`; any other value is a `422`). Assignee columns are the people with at least one matching ticket in the project, ordered by name ignoring case, then `Unassigned` last; priority columns are all active priorities, highest rank first. The 50-ticket cap and `total` per column stay, and every filter still applies.
- Behaviour: dropping a card in another column changes its assignee (needs `tickets.assign`) or priority (needs `tickets.edit`) through the existing `PATCH`, with the version check; the status workflow is not involved. Cards show their status symbol and name while grouped by assignee or priority. Heat does not apply (neutral columns). The Columns section of the menu is hidden when not grouped by status.

- [ ] **Step 1: Write down the shapes first.** Before any code, add the final `boardSchema` and `groupBy` shapes to the spec's "Group by" section of `docs/superpowers/specs/2026-10-23-board-heat-design.md` in two or three lines, and show them to the owner. Proceed only on their yes.
- [ ] **Step 2: Failing API tests** in `board.test.ts`: `'groups by assignee: people with tickets, then Unassigned'` (exact column ids and totals against the demo data); `'groups by priority from highest to lowest, including empty priorities'`; `'groupBy applies the same filters and the 50-ticket cap'`; `'rejects an unknown groupBy with 422'`; `'is scoped to the workspace'` (another workspace's people never appear).
- [ ] **Step 3: Failing web tests** in `board.test.ts`: the reducer for a grouped move (`nextGroupedBoardState`): moves the card to the target column, adjusts both totals, returns the same board for the same column or an unknown column.
- [ ] **Step 4: Run to see them fail.** `npm test -w @forge/api -- board`, `npm test -w @forge/web -- board`. Expected: FAIL.
- [ ] **Step 5: Implement** the schema union, `loadBoard(..., groupBy)` (status grouping unchanged apart from adding `groupBy: 'status'` to its result; update every existing test and fixture that builds a board), the route's query handling, and `nextGroupedBoardState`.
- [ ] **Step 6: Web.** A **Group by** radio group at the top of the Display menu (Status, Assignee, Priority, saved per person like density); the board page requests `?groupBy=` from the saved setting. `Board` handles the grouped shape: drop sends `{ version, assigneeId }` (null for `unassigned`) or `{ version, priorityId }`; a refused drop (403, 409) reverts with the existing toast behaviour; announcements say "over Dana Developer" or "over High". A person without the needed permission has no grips (as for status moves).
- [ ] **Step 7: Browser tests** in `board.spec.ts`: `'grouping by assignee shows people and Unassigned'`; `'dragging a card to another person assigns it, and the history says so'`; `'grouping by priority and dropping changes the priority'`; `'a reviewer cannot re-assign by dragging'` (no grips: reviewers lack `tickets.edit`); `'the grouping is remembered per person'`.
- [ ] **Step 8: Verify** as in Task 5 (all suites, full browser run once, typecheck, lint, prettier).
- [ ] **Step 9: Checkpoint.** `git diff --stat`; commit only if asked: `Group the board by assignee or priority`.

---

### Task 7: Docs and the final gate

**Files:**
- Modify: `docs/workflows.md` (names, heat, the table of statuses), `docs/data-model.md` (migration 0003, preferences keys `board` and `boardColumns`), `docs/architecture.md` (Display settings and first-paint rendering), `docs/testing.md` (new tests and counts), `docs/known-limitations.md` (below), `README.md`
- Create: nothing new

**Interfaces:** consumes the finished behaviour of Tasks 1 to 6 (or 1 to 5 if Task 6 was not built).

- [ ] **Step 1: Update the docs** so they describe only what exists. In `workflows.md`, replace the status names in the tables and add a short "Heat" section (token, colour, symbol per status; fallback by category). In `known-limitations.md` list: Display settings are stored on the person's account, so they follow them between browsers, but they are **not shared with a team**; hiding a column hides it only for that person; custom statuses (Part B) take their colour from their category; ticket history keeps the old status names written before the rename; `Group by` status (and Task 6 if built); amber/blue accent change.
- [ ] **Step 2: Run the full gate.** `npm run typecheck`, `npm run lint`, `npx prettier --check --end-of-line auto .`, `npm test`, `npm run test:e2e` (three consecutive full runs, all green). Record the counts.
- [ ] **Step 3: Fresh-copy gate.** Copy the tracked and new files to a scratch directory, convert text files to LF, `npm ci`, then `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build -w @forge/web`: all exit 0.
- [ ] **Step 4: Final screenshots** of the board (heat on, heat off, compact, with a hidden column, grouped if built), the list and the ticket page, desktop and phone width; read them as the owner would and note anything that looks wrong.
- [ ] **Step 5: Report** to the owner, as for Part A: what is built, which tests were run and their results, what is not covered, and the one action they must take on their own database (`db:stop`, `db:reset`, `db:start`, `db:migrate`, `db:seed`, which deletes local data and also applies migration 0003 and the new names).
- [ ] **Step 6: Checkpoint.** `git diff --stat`; commit only if asked: `Document the board, heat colours and forge names`.

---

## Self-Review

**Spec coverage.** Names and migration (Task 1); heat colours, symbols, contrast rule and accent move (Task 2); Rich card, comment count, type off by default (Task 3); Display menu with card fields, density, heat, reset, first-paint rendering, per-person storage with safe merge (Task 4); column show/hide/reorder, Scrapped hidden by default, hidden statuses still reachable by "Move to", caps (Task 5); group by, optional and last, with the owner's check of the shapes (Task 6); docs, gate, fresh copy and report (Task 7). Non-goals are untouched: no light theme, no rest-of-app redesign, no per-column menus, no shared board settings, no CLI.

**Type consistency.** `CardFields`/`DEFAULT_CARD_FIELDS` (Task 3) are what `BoardDisplay.fields` (Task 4) uses; `BoardColumn`'s `heat` prop (Task 2) is the one `display.heat` feeds (Task 4); `BoardColumnPrefs`, `arrangeColumns`, `prefsFromLayout`, `moveColumn` (Task 5) are named identically everywhere they appear; `groupBy` is added to `boardDisplaySchema` only in Task 6.

**Proportion.** Tasks carry signatures, test names and the spec's values; bodies are left to the implementer.
