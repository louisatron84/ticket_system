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

Audit rows never contain tokens or cookies. There is no screen to read them yet (Stage 6).

## Not covered yet

- **No production sign-in method.** Only development sign-in exists. The session layer is ready for
  one; choosing and building it (email and password, GitHub OAuth, or another) is a product
  decision still to be made.
- No rate limiting, lockout or abuse protection on any route (Stage 7).
- No security response headers (CSP, HSTS and so on) from the web app (Stage 7).
- No idle session timeout, session list or "sign out everywhere".
- Tenant-isolation tests cover the entities that exist now (workspaces, members, roles,
  preferences, sessions). Each later entity (tickets, attachments, repository metadata, workflow
  executions, credentials) must add its own cross-tenant tests when it lands.
- Dependency advisories are listed in [known limitations](known-limitations.md).
