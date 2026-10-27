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

## Cross-site requests

- `SameSite=Lax` stops browsers attaching the cookie to cross-site writes.
- On top of that, any write (`POST`, `PATCH`, and so on) that carries an `Origin` header must name
  one of `WEB_ORIGIN` exactly (default `http://localhost:3000,http://127.0.0.1:3000`); otherwise `403`.
  Requests with no `Origin` are non-browser clients and cannot be forged by a web page.
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

| Action                                                                                 | Permission needed                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| List and read projects, tickets, the boards, the timeline, ticket configuration, views | `tickets.view`                                                       |
| Create a project, edit or archive a project, add a component                           | `projects.manage`                                                    |
| Create a ticket                                                                        | `tickets.create` (and `tickets.assign` to set an assignee)           |
| Edit a ticket, change its status, labels or fields                                     | `tickets.edit` (and `tickets.assign` to change the assignee)         |
| Create a label                                                                         | `tickets.edit`                                                       |
| Add a comment                                                                          | `tickets.comment`                                                    |
| Edit a comment                                                                         | `tickets.comment`, and you must be its **author**                    |
| Delete a comment                                                                       | its author, or anyone with `tickets.edit`                            |
| Archive or unarchive a ticket                                                          | `tickets.edit`                                                       |
| Duplicate a ticket                                                                     | `tickets.create` (the assignee is copied only with `tickets.assign`) |
| Change many tickets at once (bulk)                                                     | `tickets.edit`, and `tickets.assign` to set an assignee              |
| Create, change or delete a **personal** saved view                                     | `tickets.view`, and it must be your own                              |
| Create, change or delete a **shared** saved view                                       | `projects.manage`                                                    |

Other rules the API enforces, each with a test that does not go through the page:

- **Another workspace's data looks absent.** A ticket, project, label, component, view or comment
  of a workspace you are not in is the same `404` as one that does not exist. Inside your own
  workspace, a view that is another person's personal view is also a `404`, not a `403`.
- **References are checked against the workspace and the project.** A status from another project,
  a component from another project, an assignee who is not a member, or a label from elsewhere is a
  `422` naming the field.
- **Mass assignment is refused.** Request bodies are strict: an unknown field (`id`, `reporterId`,
  `organisationId`, `key`, `statusId` on create) is a `422`, not silently ignored. The reporter is
  always the signed-in person, and a new ticket always starts in its project's initial status.
- **Stale edits are refused** with `409` by the `version` check, and two simultaneous edits are
  serialised by a row lock ([workflows](workflows.md#simultaneous-edits)).
- **Bad input is refused before it reaches the database.** Titles are 1 to 200 characters, comments
  up to 10,000, descriptions up to 20,000; NUL and other control characters are rejected
  (tabs and line breaks are allowed in descriptions and comments only); dates must exist; an
  estimate is 0 to 99,999 minutes; a request can carry at most 20 labels; a filter value is
  validated like any other input. An over-long or malformed value is a `422`, never a `500`.
- **Searching cannot be turned into a pattern.** `%`, `_` and `\` in the search text are escaped, so
  `%` finds only a literal `%`. Queries are parameterised.
- **Text is shown as text.** Titles, descriptions, comments and labels are plain text and React
  escapes them. A browser test saves `<img onerror>`, `<script>` and `<svg onload>` markup as a
  title, a description and a comment and checks it is displayed literally, creates no element and
  runs nothing. There are no links, images or HTML in user text to sanitise, and the web app does
  not use `dangerouslySetInnerHTML` anywhere.
- **A person sees only what they may.** The web app hides editing controls from people who lack the
  permission, but the same calls made by hand are refused. The assignee picker shows only to
  people who may also see the member list (`members.view`); everyone else sees the current assignee
  as text.
- **Switching accounts leaves nothing behind.** Pressing Back after switching identity shows the
  not-found page, not the previous person's tickets (browser test).

## Development sign-in

See [development accounts](development-accounts.md#why-it-cannot-reach-production). In short: it
cannot start in production, the routes do not exist unless enabled, it accepts only seeded
identity keys, and it refuses foreign `Host` / `Origin` values.

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
- No rate limiting, lockout or abuse protection on any route (Stage 7).
- No security response headers (CSP, HSTS and so on) from the web app (Stage 7).
- No idle session timeout, session list or "sign out everywhere".
- Tenant-isolation tests cover the entities that exist now (workspaces, members, roles,
  preferences, sessions, projects, tickets, comments, labels, components, saved views and the
  board). Each later entity (attachments, repository metadata, workflow executions, credentials)
  must add its own cross-tenant tests when it lands.
- No limit on how many projects, labels, components, saved views or comments a workspace can hold,
  and no per-person rate limit on creating them (Stage 7).
- Dependency advisories are listed in [known limitations](known-limitations.md).
