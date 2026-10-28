# Security

What the code does today to protect people and data, and what it does not do yet. See
[known limitations](known-limitations.md) for the gaps in one place.

## Principles

- The server is the boundary. The web app hides what a role cannot use, but every rule is enforced
  by the API and has a test that does not go through the UI.
- Tenant data is scoped by an organisation id taken from the authenticated membership, never from
  the request body.
- Errors never carry stack traces, SQL, connection strings or other internals (see
  [architecture](architecture.md#error-contract)).

## Sessions

- Server-side sessions in Postgres. The browser holds only a random 32-byte token (43 URL-safe
  characters); the database stores its **SHA-256 hash**, so a copy of the database cannot be replayed.
- Cookie `forge_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, `Max-Age`
  equal to the session length (`SESSION_TTL_HOURS`, default 168, allowed 1 to 720).
- A token is rejected, with `401`, when it is malformed, unknown, tampered with, expired or revoked.
  Sign-out revokes the session on the server, so a copied cookie stops working too.
- Every `/api/` response carries `Cache-Control: no-store`, because responses differ per person.
- Sessions have an absolute lifetime only. There is no idle timeout and no "sign out everywhere"
  yet.

## Command-line tokens

The `forge` command (`apps/cli`) signs in with a personal access token, built to the usual
industry standard (the owner's choice; stronger measures are listed in
[known limitations](known-limitations.md#security-gaps-see-also-security)).

- A token is `forge_pat_` and 32 random bytes (base64url), recognisable by secret scanners. It is
  shown **once**; the database keeps only its SHA-256 hash and the first four characters for
  recognition. Audit rows never contain it.
- Every token has **one workspace**, **one scope** (`read`: safe methods only; `write`: read and
  change) and a **required expiry** (1 to 365 days, 30 by default). It can be revoked at once on the
  CLI tokens page; `forge logout` revokes it on the server too.
- A token is honoured only by `orgAccess` (in its own workspace; another workspace is the same
  `404` as for a non-member) and by `/api/v1/cli/*`. Every other route needs a browser session and
  refuses a token with `403`, so a token can never make, list or revoke tokens, change
  preferences, approve another login or sign out a browser.
- A token only ever does **ticket work** (`tickets.view`, `tickets.create`, `tickets.edit`,
  `tickets.assign`, `tickets.comment`). Renaming the workspace, managing members, roles or
  projects, and reading the member list are refused with `403` even for an owner's token, and
  permission checks inside handlers see only those five.
- The owner's membership and role are checked on **every** request: a token is never worth more
  than its owner's role is now.
- A request carrying both a session cookie and a bearer token is refused (`401`).
- `token.created`, `token.first_used` (with the address) and `token.revoked` are audit events.
  Last use (time and address) is recorded at most once a minute.
- **Browser approval** (`forge login`, device-flow style): the command line gets a secret 32-byte
  device code and shows an 8-character user code from an alphabet without look-alikes. Both are
  stored only as hashes and expire after 10 minutes. The approval page needs a browser session,
  shows the code, machine name, address and time, and asks for a workspace and scope before Allow.
  A login is decided once. The token is made only when the command line collects it, exactly once,
  so no token is ever stored waiting. A login started from another address than the approver's is
  flagged on the page and Allow needs an extra "I started this myself" (enforced by the API), since
  that is what a phished link looks like. A role that can only read always gets a read-only token,
  whatever was asked. Saved views cannot be changed with a token. Starting a login is limited to
  10 per address per 10 minutes (and 500 waiting in all),
  polling to 60 a minute (and `slow_down` if faster than every 3 seconds), and code lookups and
  decisions to 5 a minute per person.
- **On the machine**: the config (`~/.forge/config.json`, or `FORGE_CONFIG_DIR`) is written
  owner-only (mode `0600`; on Windows the inherited permissions are removed and only the current
  user is granted access). The command refuses plain `http://` to anything but `localhost` and
  `127.0.0.1`, does not follow redirects, and reads a pasted token without echoing it.

## Notifications and triage

- A notification is written for one recipient and only ever read or marked by them; another
  person's id marks nothing. Nobody is notified about their own change, a person outside the
  workspace never is (an old mention of a removed member notifies nobody), and the live stream
  sends only the signed-in person's own notifications. The stream needs a browser session.
- Notifications are announced with `pg_notify` inside the writing transaction, so a change that
  rolls back never notifies anyone.
- **Four eyes on triage.** Every decision but Snooze is a proposal; the approver must be a
  different person with `tickets.edit`. The API refuses a self-approval and the table has a check
  (`decided_by <> proposed_by`), so even a bug in the code could not let one person both propose
  and approve. One open proposal per ticket (unique index), and decisions take the ticket's row
  lock, so two approvals at once give one success and one `409`. Whatever the proposal names
  (assignee, priority, labels, the original) is checked when it is proposed and again when it is
  approved.

## Cross-site requests

- `SameSite=Lax` stops browsers attaching the cookie to cross-site writes.
- On top of that, any write (`POST`, `PATCH`, and so on) that carries an `Origin` header must name
  one of `WEB_ORIGIN` exactly (default `http://localhost:3000,http://127.0.0.1:3000`); otherwise `403`.
  Requests with no `Origin` are non-browser clients and cannot be forged by a web page (such a
  client could send our `Origin` just as easily, so requiring one would protect nothing). As a
  second line, a write without `Origin` whose `Sec-Fetch-Site` says `cross-site` or `same-site` is
  refused too.
- **No framing.** Every web page sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`, so the
  CLI approval page (or any other) cannot be shown inside another site and clicked by trickery.
  Pages also send `nosniff`, `Referrer-Policy: same-origin`, `Cross-Origin-Opener-Policy`, a
  `Permissions-Policy` and, in production, HSTS. The API sends `default-src 'none'` on every
  answer except the live notification stream, which writes its own headers.
- **The session cookie is `Secure`** in production and whenever every `WEB_ORIGIN` is `https://`;
  production refuses to start with a plain-HTTP origin other than this machine.
- The browser reaches the API only through the web app's same-origin `/api` proxy, so there is no
  CORS configuration to get wrong.

## Authorisation

- Every organisation route goes through one guard, `orgAccess(permission)`:
  - not signed in: `401`
  - not a member, an unknown id or a malformed id: the same `404`, so a workspace that exists but
    is not yours looks exactly like one that does not exist (web and API alike)
  - a member without the permission: `403`
- Permissions are a fixed list in code (`packages/shared/src/permissions.ts`). Roles are rows that
  hold a set of those keys. A key the running code does not know grants nothing.
- Changing someone's role follows these rules (`decideRoleChange`, tested in isolation and again
  through the API):
  - you need `members.manage`
  - nobody changes their own role
  - only an owner can grant or remove the owner role
  - you cannot assign a role with permissions you do not hold
  - the last owner cannot be demoted
- Role changes run in one transaction under a lock on the organisation row, and re-read the
  actor's own role inside it. Two owners demoting each other at the same moment cannot leave a
  workspace without an owner (tested 20 times per run; removing the lock makes the test fail).
- The database backs this up: a membership must use a role of **its own** organisation (composite
  foreign key), and foreign keys never cascade-delete tenant data.

## Tickets and projects

Every route below is under `/api/v1/orgs/:orgId` and goes through `orgAccess`, so all of them
answer `401` when not signed in and the identical `404` for a workspace you are not in.

| Action                                                                                 | Permission needed                                                                   |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| List and read projects, tickets, the boards, the timeline, ticket configuration, views | `tickets.view`                                                                      |
| Create a project, edit or archive a project, add a component                           | `projects.manage`                                                                   |
| Create a ticket                                                                        | `tickets.create` (and `tickets.assign` to set an assignee)                          |
| Edit a ticket, change its status, labels or fields                                     | `tickets.edit` (and `tickets.assign` to change the assignee)                        |
| Create a label                                                                         | `tickets.edit`                                                                      |
| Add a comment                                                                          | `tickets.comment`                                                                   |
| Edit a comment                                                                         | `tickets.comment`, and you must be its **author**                                   |
| Delete a comment                                                                       | its author, or anyone with `tickets.edit`                                           |
| Archive or unarchive a ticket                                                          | `tickets.edit`                                                                      |
| Duplicate a ticket                                                                     | `tickets.create` (the assignee is copied only with `tickets.assign`)                |
| Change many tickets at once (bulk)                                                     | `tickets.edit`, and `tickets.assign` to set an assignee                             |
| Set or clear a ticket's parent; add or remove a link; mark a ticket as a duplicate     | `tickets.edit` (the ticket in the address; the other must be in the same workspace) |
| Add, edit, tick, reorder or remove an acceptance criterion                             | `tickets.edit`                                                                      |
| Upload an attachment                                                                   | `tickets.edit`                                                                      |
| Download an attachment                                                                 | `tickets.view`, checked on every download against the file's own ticket             |
| Remove an attachment                                                                   | its uploader, or anyone with `tickets.edit`                                         |
| React to a comment                                                                     | `tickets.comment`                                                                   |
| Read your inbox, mark notifications read                                               | `tickets.view` in that workspace; only your own notifications                       |
| Watch or stop watching a ticket                                                        | `tickets.view`                                                                      |
| Send to triage, propose, approve or reject, snooze                                     | `tickets.edit`; never approve or reject your own proposal (also a database check)   |
| Change a project's triage settings (switch, rota, rules)                               | `projects.manage`                                                                   |
| Turn a project's blocker rule on or off                                                | `projects.manage` (recorded in the audit log as a project update)                   |
| Create, change or delete a **personal** saved view                                     | `tickets.view`, and it must be your own                                             |
| Create, change or delete a **shared** saved view                                       | `projects.manage`                                                                   |

Other rules the API enforces, each with a test that does not go through the page:

- **Another workspace's data looks absent.** A ticket, project, label, component, view or comment
  of a workspace you are not in is the same `404` as one that does not exist. Inside your own
  workspace, a view that is another person's personal view is also a `404`, not a `403`.
- **References are checked against the workspace and the project.** A status from another project,
  a component from another project, an assignee who is not a member, or a label from elsewhere is a
  `422` naming the field.
- **Mass assignment is refused.** Request bodies are strict: an unknown field (`id`, `reporterId`,
  `organisationId`, `key`) is a `422`, not silently ignored. The reporter is always the signed-in
  person. A new ticket starts in its project's initial status unless its creator holds
  `tickets.edit`: someone who may only create (a reporter) choosing any other status, Quenched
  included, is a `403`.
- **An archived project is frozen.** Editing, moving, archiving, commenting on, ticking criteria
  of, attaching to, linking or triaging any of its tickets is a `409` until it is unarchived.
- **Removing needs the permission that adding does.** Deleting a comment needs `tickets.comment`
  (and being its author, or `tickets.edit`); removing an attachment needs `tickets.edit`. A person
  whose role was lowered keeps nothing they could do before.
- **Blocking loops of any length are refused**, under the workspace's structure lock.
- **Stale edits are refused** with `409` by the `version` check, and two simultaneous edits are
  serialised by a row lock ([workflows](workflows.md#simultaneous-edits)).
- **Bad input is refused before it reaches the database.** Titles are 1 to 200 characters, comments
  up to 10,000, descriptions up to 20,000; NUL and other control characters are rejected
  (tabs and line breaks are allowed in descriptions and comments only), and so are the C1 controls
  (U+0080 to U+009F, which terminals read as escape codes) and the invisible characters that
  reorder or hide text (bidirectional overrides and isolates, zero-width space, word joiner,
  byte-order mark), so a title cannot show `gnp.exe` as `exe.png` in the browser or the `forge`
  command; direction marks and emoji joiners stay allowed; dates must exist; an
  estimate is 0 to 99,999 minutes; a request can carry at most 20 labels; a filter value is
  validated like any other input. An over-long or malformed value is a `422`, never a `500`.
- **Searching cannot be turned into a pattern.** `%`, `_` and `\` in the search text are escaped, so
  `%` finds only a literal `%`. Queries are parameterised.
- **Formatting can never become markup.** Descriptions, goals, criteria and comments may use a small
  Markdown subset (P3). One parser (`packages/shared/src/rich-text.ts`) turns text into a tree of
  known nodes, and the web app draws that tree with React elements; anything the parser does not
  recognise stays the characters it is. No HTML string is ever built and the web app does not use
  `dangerouslySetInnerHTML` anywhere. Only `http:`, `https:` and `mailto:` become links
  (`rel="noopener noreferrer nofollow"`); `javascript:`, `data:` and the rest stay text. Images
  come only from this ticket's own attachments (`attachment:<id>`), never from an outside address.
  Lookahead for brackets is capped, so hostile text cannot make parsing slow (a test parses 20,000
  characters of each pathological pattern in under 250 ms). Browser tests save `<img onerror>`,
  `<script>` and `<svg onload>` markup and a `javascript:` link and check nothing runs.
- **Ticket references and mentions stay inside the workspace.** A key becomes a link only when the
  API finds that ticket in the same workspace; "mentioned in" rows are written only for such
  tickets. A mention stores a user id; it shows the member's current name.
- **Attachments are judged by their content.** The first bytes decide the type (PNG, JPEG, GIF,
  WebP, PDF, ZIP, or UTF-8 text without NUL bytes or a leading HTML/SVG/XML tag for `.txt`, `.md`,
  `.csv`, `.json`, `.log`); the name and the claimed type are ignored, so an SVG or an HTML page
  renamed `.png` is refused. At most 10 MB each and 100 per ticket. Files are stored under a random
  64-hex key (owner-only file mode); the name is metadata only, cut to its last path segment.
  Downloads carry `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox` and `Cache-Control: private, no-store`;
  only raster images may be shown inline, as thumbnails.
- **A person sees only what they may.** The web app hides editing controls from people who lack the
  permission, but the same calls made by hand are refused. The assignee picker shows only to
  people who may also see the member list (`members.view`); everyone else sees the current assignee
  as text.
- **Switching accounts leaves nothing behind.** Pressing Back after switching identity shows the
  not-found page, not the previous person's tickets (browser test).

## Development sign-in

See [development accounts](development-accounts.md#why-it-cannot-reach-production). In short: it
it cannot start in production, the routes do not exist unless enabled, it accepts only seeded
identity keys, it refuses foreign `Host` / `Origin` values, and it answers only connections whose
socket comes from this machine (so an API bound to a network address does not hand sessions to
anyone who sends `Host: localhost`).

It is open to any program on the same machine: that is what makes it a development tool, and why
real sign-in must replace it before Forge is reachable by anyone else. The most destructive part,
**Reset demo data** (wipe every table and reseed, signing everyone out), is a separate switch,
`FORGE_DEV_RESET`, off by default; its route does not exist without it, the button only appears
with it, and it always refuses the main `forge` database. `npm run db:reseed` remains the
deliberate way to start again.

## Audit trail

Written in the same transaction as the change, with actor, action, target, before and after,
request id, source (`user`, `dev` or `system`) and outcome:

- workspace renamed
- member role changed, including **denied** attempts (outcome `denied`, with the reason)
- development session created
- project created and project updated (including archived), component created, label created
- shared saved view created, updated and deleted (personal views are private and not audited)

Audit rows never contain tokens or cookies. There is no screen to read them yet (Stage 6).

Ticket changes (create, edit, move, label, comment) are recorded in the ticket's own history, shown
on its page, and are **not** in the audit trail. See [data model](data-model.md#audit-events-and-ticket-history).
Denied ticket attempts (a `403` or `404`) are not recorded anywhere yet.

## Not covered yet

- **No production sign-in method.** Only development sign-in exists. The session layer is ready for
  one; choosing and building it (email and password, GitHub OAuth, or another) is a product
  decision still to be made.
- Rate limiting only on the CLI sign-in routes; no lockout or abuse protection elsewhere (Stage 7).
- No script policy (`script-src` with nonces) yet; the other security headers are sent (above).
- No idle session timeout, session list or "sign out everywhere".
- Tenant-isolation tests cover the entities that exist now (workspaces, members, roles,
  preferences, sessions, projects, tickets, comments, labels, components, saved views and the
  board). Each later entity (attachments, repository metadata, workflow executions, credentials)
  must add its own cross-tenant tests when it lands.
- No limit on how many projects, labels, components, saved views or comments a workspace can hold,
  and no per-person rate limit on creating them (Stage 7).
- Dependency advisories are listed in [known limitations](known-limitations.md).
